use std::path::PathBuf;

use tauri::{AppHandle, Emitter, State};

use super::error::GraphError;
use super::model::{BlastRadius, Change, GraphSnapshot};
use super::state::GraphState;

pub const GRAPH_CHANGED_EVENT: &str = "graph:changed";

fn alters_the_graph(change: Change) -> bool {
    change != Change::Unchanged
}

pub fn notify_if_changed(app: &AppHandle, change: Change) -> Result<(), GraphError> {
    if !alters_the_graph(change) {
        return Ok(());
    }
    app.emit(GRAPH_CHANGED_EVENT, ())
        .map_err(|error| GraphError::Task(error.to_string()))
}

async fn run_blocking<T, F>(job: F) -> Result<T, GraphError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, GraphError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| GraphError::Task(error.to_string()))?
}

#[tauri::command]
pub async fn graph_build(
    state: State<'_, GraphState>,
    root: String,
) -> Result<GraphSnapshot, GraphError> {
    let state = state.inner().clone();
    run_blocking(move || state.build(&PathBuf::from(root))).await
}

#[tauri::command]
pub async fn graph_snapshot(state: State<'_, GraphState>) -> Result<GraphSnapshot, GraphError> {
    let state = state.inner().clone();
    run_blocking(move || state.snapshot()).await
}

#[tauri::command]
pub async fn graph_blast_radius(
    state: State<'_, GraphState>,
    path: String,
) -> Result<BlastRadius, GraphError> {
    let state = state.inner().clone();
    run_blocking(move || state.blast_radius(&path)).await
}

#[tauri::command]
pub async fn graph_update_file(
    app: AppHandle,
    state: State<'_, GraphState>,
    path: String,
) -> Result<Change, GraphError> {
    let state = state.inner().clone();
    let change = run_blocking(move || state.update_file(&path)).await?;
    notify_if_changed(&app, change)?;
    Ok(change)
}

#[tauri::command]
pub async fn graph_remove_file(
    app: AppHandle,
    state: State<'_, GraphState>,
    path: String,
) -> Result<Change, GraphError> {
    let state = state.inner().clone();
    let change = run_blocking(move || state.remove_file(&path)).await?;
    notify_if_changed(&app, change)?;
    Ok(change)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_structural_changes_notify_the_frontend() {
        assert!(!alters_the_graph(Change::Unchanged));
        for change in [
            Change::Added,
            Change::Updated,
            Change::Removed,
            Change::Rebuilt,
        ] {
            assert!(alters_the_graph(change), "{change:?}");
        }
    }

    #[test]
    fn the_event_name_is_valid_for_tauri() {
        assert!(GRAPH_CHANGED_EVENT
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '/' | ':' | '_')));
    }
}
