use tauri::State;

use super::error::VcsError;
use super::model::{
    BranchRequest, CommitRequest, CommitResult, DeleteBranchRequest, FileDiff, FileDiffRequest,
    MessageContext, PathsRequest, PrContext, PrContextRequest, PrCreateRequest, PrCreated, PrInfo,
    RootRequest, VcsBranch, VcsStatus,
};
use super::state::VcsState;

/// Git can take seconds (a push can take minutes), so every command leaves the async runtime alone.
async fn blocking<T, F>(task: F) -> Result<T, VcsError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, VcsError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| VcsError::Task(error.to_string()))?
}

#[tauri::command]
pub async fn vcs_status(
    state: State<'_, VcsState>,
    request: RootRequest,
) -> Result<VcsStatus, VcsError> {
    let state = state.inner().clone();
    blocking(move || state.status(request)).await
}

#[tauri::command]
pub async fn vcs_file_diff(
    state: State<'_, VcsState>,
    request: FileDiffRequest,
) -> Result<FileDiff, VcsError> {
    let state = state.inner().clone();
    blocking(move || state.file_diff(request)).await
}

#[tauri::command]
pub async fn vcs_stage(
    state: State<'_, VcsState>,
    request: PathsRequest,
) -> Result<VcsStatus, VcsError> {
    let state = state.inner().clone();
    blocking(move || state.stage(request)).await
}

#[tauri::command]
pub async fn vcs_unstage(
    state: State<'_, VcsState>,
    request: PathsRequest,
) -> Result<VcsStatus, VcsError> {
    let state = state.inner().clone();
    blocking(move || state.unstage(request)).await
}

#[tauri::command]
pub async fn vcs_discard(
    state: State<'_, VcsState>,
    request: PathsRequest,
) -> Result<VcsStatus, VcsError> {
    let state = state.inner().clone();
    blocking(move || state.discard(request)).await
}

#[tauri::command]
pub async fn vcs_commit(
    state: State<'_, VcsState>,
    request: CommitRequest,
) -> Result<CommitResult, VcsError> {
    let state = state.inner().clone();
    blocking(move || state.commit(request)).await
}

#[tauri::command]
pub async fn vcs_branches(
    state: State<'_, VcsState>,
    request: RootRequest,
) -> Result<Vec<VcsBranch>, VcsError> {
    let state = state.inner().clone();
    blocking(move || state.branches(request)).await
}

#[tauri::command]
pub async fn vcs_branch_create(
    state: State<'_, VcsState>,
    request: BranchRequest,
) -> Result<VcsStatus, VcsError> {
    let state = state.inner().clone();
    blocking(move || state.branch_create(request)).await
}

#[tauri::command]
pub async fn vcs_switch(
    state: State<'_, VcsState>,
    request: BranchRequest,
) -> Result<VcsStatus, VcsError> {
    let state = state.inner().clone();
    blocking(move || state.switch(request)).await
}

#[tauri::command]
pub async fn vcs_branch_delete(
    state: State<'_, VcsState>,
    request: DeleteBranchRequest,
) -> Result<VcsStatus, VcsError> {
    let state = state.inner().clone();
    blocking(move || state.branch_delete(request)).await
}

#[tauri::command]
pub async fn vcs_fetch(
    state: State<'_, VcsState>,
    request: RootRequest,
) -> Result<VcsStatus, VcsError> {
    let state = state.inner().clone();
    blocking(move || state.fetch(request)).await
}

#[tauri::command]
pub async fn vcs_pull(
    state: State<'_, VcsState>,
    request: RootRequest,
) -> Result<VcsStatus, VcsError> {
    let state = state.inner().clone();
    blocking(move || state.pull(request)).await
}

#[tauri::command]
pub async fn vcs_push(
    state: State<'_, VcsState>,
    request: RootRequest,
) -> Result<VcsStatus, VcsError> {
    let state = state.inner().clone();
    blocking(move || state.push(request)).await
}

#[tauri::command]
pub async fn vcs_message_context(
    state: State<'_, VcsState>,
    request: RootRequest,
) -> Result<MessageContext, VcsError> {
    let state = state.inner().clone();
    blocking(move || state.message_context(request)).await
}

#[tauri::command]
pub async fn vcs_pr_info(
    state: State<'_, VcsState>,
    request: RootRequest,
) -> Result<PrInfo, VcsError> {
    let state = state.inner().clone();
    blocking(move || state.pr_info(request)).await
}

#[tauri::command]
pub async fn vcs_pr_context(
    state: State<'_, VcsState>,
    request: PrContextRequest,
) -> Result<PrContext, VcsError> {
    let state = state.inner().clone();
    blocking(move || state.pr_context(request)).await
}

#[tauri::command]
pub async fn vcs_pr_create(
    state: State<'_, VcsState>,
    request: PrCreateRequest,
) -> Result<PrCreated, VcsError> {
    let state = state.inner().clone();
    blocking(move || state.pr_create(request)).await
}
