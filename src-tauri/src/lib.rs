mod bridge;

use tauri::{Manager, RunEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(bridge::BridgeState::default())
        .invoke_handler(tauri::generate_handler![
            bridge::bridge_start,
            bridge::bridge_send
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Flare")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<bridge::BridgeState>().kill();
            }
        });
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
