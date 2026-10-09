mod bridge;
mod checkpoints;
pub mod fs;
mod git_cli;
mod graph;
mod proctree;
mod pty;
mod vcs;

use tauri::{AppHandle, Manager, RunEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(bridge::BridgeState::default())
        .manage(fs::FsState::default())
        .manage(graph::GraphState::default())
        .manage(pty::PtyState::default())
        .manage(vcs::VcsState::default())
        .invoke_handler(tauri::generate_handler![
            bridge::bridge_start,
            bridge::bridge_send,
            checkpoints::commands::checkpoint_create,
            checkpoints::commands::checkpoint_list,
            checkpoints::commands::checkpoint_diff,
            checkpoints::commands::checkpoint_plan,
            checkpoints::commands::checkpoint_restore,
            checkpoints::commands::checkpoint_prune,
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
            pty::commands::pty_profiles,
            pty::commands::pty_spawn,
            pty::commands::pty_write,
            pty::commands::pty_resize,
            pty::commands::pty_kill,
            pty::commands::pty_kill_all,
            vcs::commands::vcs_status,
            vcs::commands::vcs_file_diff,
            vcs::commands::vcs_stage,
            vcs::commands::vcs_unstage,
            vcs::commands::vcs_discard,
            vcs::commands::vcs_commit,
            vcs::commands::vcs_branches,
            vcs::commands::vcs_branch_create,
            vcs::commands::vcs_switch,
            vcs::commands::vcs_branch_delete,
            vcs::commands::vcs_fetch,
            vcs::commands::vcs_pull,
            vcs::commands::vcs_push,
            vcs::commands::vcs_message_context,
            vcs::commands::vcs_pr_info,
            vcs::commands::vcs_pr_context,
            vcs::commands::vcs_pr_create,
        ])
        .setup(|app| {
            graph::watch::spawn(app.handle().clone());
            let checkpoints = checkpoints::CheckpointState::new(&app.path().app_data_dir()?);
            app.manage(checkpoints.clone());
            checkpoints::spawn_startup_sweep(checkpoints)?;
            Ok(())
        })
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
