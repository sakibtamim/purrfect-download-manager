use tauri_plugin_shell::ShellExt;
use tauri::{Manager, Emitter, menu::{Menu, MenuItem}, tray::TrayIconBuilder, WindowEvent};
use std::thread;
use tiny_http::{Server, Response};
use std::io::Read;
use serde_json::Value;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_fs::init())
    .on_window_event(|window, event| match event {
      WindowEvent::CloseRequested { api, .. } => {
        window.hide().unwrap();
        api.prevent_close();
      }
      _ => {}
    })
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      
      let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&quit_i])?;
      
      let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(|app, event| {
            if event.id.as_ref() == "quit" {
                app.exit(0);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { .. } = event {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    window.show().unwrap();
                    window.set_focus().unwrap();
                }
            }
        })
        .build(app)?;

      let download_dir = app.handle().path().download_dir().unwrap_or_default();
      let dir_arg = format!("--dir={}", download_dir.to_string_lossy());

      let sidecar_command = app.shell().sidecar("aria2c").unwrap()
        .args([
            "--enable-rpc", 
            "--rpc-listen-all=false", 
            "--rpc-listen-port=6800", 
            "--rpc-allow-origin-all",
            "--check-certificate=false",
            &dir_arg,
            "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ]);
        
      let (mut rx, mut _child) = sidecar_command.spawn().expect("Failed to spawn aria2c");
      
      tauri::async_runtime::spawn(async move {
        let _child_keep_alive = _child;
        while let Some(event) = rx.recv().await {
            // println!("aria2c event: {:?}", event);
        }
      });
      
      let app_handle = app.handle().clone();
      thread::spawn(move || {
          let server = Server::http("127.0.0.1:6801").unwrap();
          for mut request in server.incoming_requests() {
              if request.method().as_str() == "POST" && request.url() == "/download" {
                  let mut content = String::new();
                  request.as_reader().read_to_string(&mut content).unwrap_or_default();
                  
                  if let Ok(json) = serde_json::from_str::<Value>(&content) {
                      let _ = app_handle.emit("browser-download", json);
                  }
                  
                  let _ = request.respond(Response::from_string("OK"));
              } else {
                  let _ = request.respond(Response::from_string("Not Found").with_status_code(404));
              }
          }
      });
      
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
