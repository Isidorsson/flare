mod bridge;
pub mod fs;
mod graph;
mod pty;

use tauri::{AppHandle, Manager, RunEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(bridge::BridgeState::default())
        .manage(fs::FsState::default())
        .manage(graph::GraphState::default())
        .manage(pty::PtyState::default())
        .invoke_handler(tauri::generate_handler![
            bridge::bridge_start,
            bridge::bridge_send,
            fs::commands::fs_open_workspace,
            fs::commands::fs_close_workspace,
            fs::commands::fs_list_dir,
            fs::commands::fs_read_file,
            fs::commands::fs_write_file,
            fs::commands::fs_subscribe,
            fs::commands::fs_unsubscribe,
            graph::commands::graph_build,
            graph::commands::graph_snapshot,
            graph::commands::graph_blast_radius,
            graph::commands::graph_update_file,
            graph::commands::graph_remove_file,
            pty::commands::pty_spawn,
            pty::commands::pty_write,
            pty::commands::pty_resize,
            pty::commands::pty_kill,
        ])
        .on_page_load(pty::on_page_load)
        .build(tauri::generate_context!())
        .expect("failed to build Flare")
        .run(on_run_event);
}

fn on_run_event(app: &AppHandle, event: RunEvent) {
    pty::on_run_event(app, &event);
    if let RunEvent::Exit = event {
        app.state::<bridge::BridgeState>().kill();
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn main_window_is_configured_for_the_shell() {
        let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        let windows = &context.config().app.windows;

        assert_eq!(windows.len(), 1, "the shell is a single-window app");
        let main = &windows[0];
        assert_eq!(main.label, "main");
        assert_eq!(main.title, "Flare");
        assert_eq!(main.min_width, Some(960.0));
        assert_eq!(main.min_height, Some(600.0));
    }
}
