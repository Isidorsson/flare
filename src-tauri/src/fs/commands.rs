use std::thread;

use tauri::ipc::Channel;
use tauri::State;

use super::error::FsError;
use super::hub::{SubscriptionId, WatchBatch};
use super::io::FileRead;
use super::state::FsState;
use super::tree::DirListing;

async fn blocking<T, F>(task: F) -> Result<T, FsError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, FsError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| FsError::Task(e.to_string()))?
}

#[tauri::command]
pub async fn fs_open_workspace(state: State<'_, FsState>, root: String) -> Result<String, FsError> {
    let state = state.inner().clone();
    blocking(move || state.open_workspace(&root)).await
}

#[tauri::command]
pub fn fs_close_workspace(state: State<'_, FsState>) {
    state.close_workspace();
}

#[tauri::command]
pub async fn fs_list_dir(state: State<'_, FsState>, path: String) -> Result<DirListing, FsError> {
    let state = state.inner().clone();
    blocking(move || state.list_dir(&path)).await
}

#[tauri::command]
pub async fn fs_read_file(state: State<'_, FsState>, path: String) -> Result<FileRead, FsError> {
    let state = state.inner().clone();
    blocking(move || state.read_file(&path)).await
}

#[tauri::command]
pub async fn fs_write_file(
    state: State<'_, FsState>,
    path: String,
    content: String,
) -> Result<(), FsError> {
    let state = state.inner().clone();
    blocking(move || state.write_file(&path, &content)).await
}

#[tauri::command]
pub fn fs_subscribe(
    state: State<'_, FsState>,
    on_event: Channel<WatchBatch>,
) -> Result<SubscriptionId, FsError> {
    let hub = state.hub();
    let (id, receiver) = hub.subscribe();
    let forwarder_hub = hub.clone();
    let spawned = thread::Builder::new()
        .name("flare-fs-forward".to_owned())
        .spawn(move || {
            for batch in receiver {
                if on_event.send((*batch).clone()).is_err() {
                    break;
                }
            }
            forwarder_hub.unsubscribe(id);
        });
    if let Err(error) = spawned {
        hub.unsubscribe(id);
        return Err(FsError::Task(error.to_string()));
    }
    Ok(id)
}

#[tauri::command]
pub fn fs_unsubscribe(state: State<'_, FsState>, id: SubscriptionId) {
    state.hub().unsubscribe(id);
}
