use std::thread;

use tauri::State;

use super::error::CheckpointError;
use super::model::{
    CheckpointList, CreateRequest, DiffQuery, PlanQuery, PruneQuery, PruneReport, RestoreCommand,
    RestorePlan, RestoreResult, SessionQuery, Snapshot, TurnDiff,
};
use super::state::CheckpointState;

/// Git can take seconds on a large repository, so every command leaves the async runtime alone.
async fn blocking<T, F>(task: F) -> Result<T, CheckpointError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, CheckpointError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| CheckpointError::Task(error.to_string()))?
}

#[tauri::command]
pub async fn checkpoint_create(
    state: State<'_, CheckpointState>,
    request: CreateRequest,
) -> Result<Snapshot, CheckpointError> {
    let state = state.inner().clone();
    blocking(move || state.create(request)).await
}

#[tauri::command]
pub async fn checkpoint_list(
    state: State<'_, CheckpointState>,
    query: SessionQuery,
) -> Result<CheckpointList, CheckpointError> {
    let state = state.inner().clone();
    blocking(move || state.list(query)).await
}

#[tauri::command]
pub async fn checkpoint_diff(
    state: State<'_, CheckpointState>,
    query: DiffQuery,
) -> Result<TurnDiff, CheckpointError> {
    let state = state.inner().clone();
    blocking(move || state.diff(query)).await
}

#[tauri::command]
pub async fn checkpoint_plan(
    state: State<'_, CheckpointState>,
    query: PlanQuery,
) -> Result<RestorePlan, CheckpointError> {
    let state = state.inner().clone();
    blocking(move || state.plan(query)).await
}

#[tauri::command]
pub async fn checkpoint_restore(
    state: State<'_, CheckpointState>,
    command: RestoreCommand,
) -> Result<RestoreResult, CheckpointError> {
    let state = state.inner().clone();
    blocking(move || state.restore(command)).await
}

#[tauri::command]
pub async fn checkpoint_prune(
    state: State<'_, CheckpointState>,
    query: PruneQuery,
) -> Result<PruneReport, CheckpointError> {
    let state = state.inner().clone();
    blocking(move || state.prune(query)).await
}

/// Clears old sessions out of Flare's private repositories without delaying startup.
pub fn spawn_startup_sweep(state: CheckpointState) -> Result<(), CheckpointError> {
    thread::Builder::new()
        .name("flare-checkpoint-sweep".to_owned())
        .spawn(move || {
            if let Err(error) = state.sweep_private_repos() {
                eprintln!("flare: could not clean up old checkpoints: {error}");
            }
        })
        .map(drop)
        .map_err(|error| CheckpointError::Task(error.to_string()))
}
