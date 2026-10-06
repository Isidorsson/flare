mod coalesce;
pub mod commands;
mod error;
mod pump;
mod registry;
mod session;
mod shell;
mod state;

#[cfg(test)]
mod roundtrip_tests;

use tauri::webview::{PageLoadEvent, PageLoadPayload};
use tauri::{AppHandle, Manager, RunEvent, Webview};

pub use state::PtyState;

pub fn on_run_event(app: &AppHandle, event: &RunEvent) {
    if matches!(event, RunEvent::Exit) {
        app.state::<PtyState>().shutdown_all();
    }
}

/// A new page load discards every terminal the previous page owned, so shells
/// are not orphaned by a reload.
pub fn on_page_load(webview: &Webview, payload: &PageLoadPayload<'_>) {
    if payload.event() == PageLoadEvent::Started {
        webview.state::<PtyState>().kill_all();
    }
}
