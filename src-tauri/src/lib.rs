use serde_json::Value;
use std::fs;
use std::io::Read;
use std::thread;
use tauri::{
    menu::{Menu, MenuItem, CheckMenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_shell::ShellExt;
use tiny_http::{Response, Server};

#[tauri::command]
fn delete_downloaded_file(path: String) -> Result<(), String> {
    // Basic safety check to ensure it's an absolute path and exists before deleting
    let p = std::path::Path::new(&path);
    if p.exists() && p.is_file() {
        std::fs::remove_file(p).map_err(|e| e.to_string())
    } else {
        Err("File not found or is a directory".to_string())
    }
}

#[tauri::command]
fn check_downloaded_file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
    .plugin(tauri_plugin_autostart::Builder::new().build())
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_dialog::init())
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
      
      let show_i = MenuItem::with_id(app, "show", "Open Dashboard", true, None::<&str>)?;
      let new_download_i = MenuItem::with_id(app, "new-download", "New Download", true, None::<&str>)?;
      let pause_all_i = MenuItem::with_id(app, "pause-all", "Pause All", true, None::<&str>)?;
      let resume_all_i = MenuItem::with_id(app, "resume-all", "Resume All", true, None::<&str>)?;
      let open_downloads_i = MenuItem::with_id(app, "open-downloads", "Open Downloads Folder", true, None::<&str>)?;
      
      let autostart_manager = app.autolaunch();
      let is_autostart = autostart_manager.is_enabled().unwrap_or(false);
      let start_on_boot_i = CheckMenuItem::with_id(app, "start-on-boot", "Start on Boot", true, is_autostart, None::<&str>)?;
      
      let quit_i = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
      
      let separator = PredefinedMenuItem::separator(app)?;
      
      let menu = Menu::with_items(app, &[
          &show_i, 
          &separator, 
          &new_download_i, 
          &separator, 
          &pause_all_i, 
          &resume_all_i, 
          &separator, 
          &open_downloads_i, 
          &start_on_boot_i, 
          &separator, 
          &quit_i
      ])?;
      
      let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event({
            let start_on_boot_i = start_on_boot_i.clone();
            move |app, event| {
                match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "new-download" => {
                        let _ = app.emit("tray-new-download", ());
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "pause-all" => { let _ = app.emit("tray-pause-all", ()); }
                    "resume-all" => { let _ = app.emit("tray-resume-all", ()); }
                    "open-downloads" => {
                        if let Ok(download_dir) = app.path().download_dir() {
                            #[allow(deprecated)]
                            let _ = app.shell().open(download_dir.to_string_lossy().to_string(), None);
                        }
                    }
                    "start-on-boot" => {
                        let autostart_manager = app.autolaunch();
                        let current = autostart_manager.is_enabled().unwrap_or(false);
                        let success = if current {
                            autostart_manager.disable().is_ok()
                        } else {
                            autostart_manager.enable().is_ok()
                        };
                        if success {
                            let _ = start_on_boot_i.set_checked(!current);
                        }
                    }
                    _ => {}
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let is_visible = window.is_visible().unwrap_or(false);
                    if is_visible {
                        let _ = window.hide();
                    } else {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

      let download_dir = app.handle().path().download_dir().unwrap_or_default();
      let dir_arg = format!("--dir={}", download_dir.to_string_lossy());

      let app_local_data_dir = app.handle().path().app_local_data_dir().unwrap();
      if !app_local_data_dir.exists() {
          fs::create_dir_all(&app_local_data_dir).unwrap();
      }
      
      let session_file = app_local_data_dir.join("session.txt");
      if !session_file.exists() {
          fs::File::create(&session_file).unwrap();
      }
      let session_arg = format!("--save-session={}", session_file.to_string_lossy());
      let input_file_arg = format!("--input-file={}", session_file.to_string_lossy());

      let sidecar_command = app.shell().sidecar("pdm-aria2c").unwrap()
        .args([
            "--enable-rpc", 
            "--rpc-listen-all=false", 
            "--rpc-listen-port=6800", 
            "--rpc-allow-origin-all",
            "--check-certificate=false",
            "--save-session-interval=10",
            "--continue=true",
            &session_arg,
            &input_file_arg,
            &dir_arg,
            "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ]);
        
      let (mut rx, mut _child) = sidecar_command.spawn().expect("Failed to spawn aria2c");
      
      tauri::async_runtime::spawn(async move {
        let _child_keep_alive = _child;
        while let Some(_event) = rx.recv().await {
            // println!("aria2c event: {:?}", _event);
        }
      });
      
      let app_handle = app.handle().clone();
      thread::spawn(move || {
          let mut server_opt = None;
          for port in 6801..=6810 {
              if let Ok(s) = Server::http(format!("127.0.0.1:{}", port)) {
                  server_opt = Some(s);
                  break;
              }
          }
          
          let server = match server_opt {
              Some(s) => s,
              None => {
                  eprintln!("Failed to bind to any port in range 6801-6810");
                  return;
              }
          };

          for mut request in server.incoming_requests() {
              // Handle harmless read-only endpoints without Origin check
              if request.method().as_str() == "GET" && request.url() == "/health" {
                  let _ = request.respond(Response::from_string("OK"));
                  continue;
              } else if request.method().as_str() == "GET" && request.url() == "/show" {
                  if let Some(window) = app_handle.get_webview_window("main") {
                      let _ = window.unminimize();
                      let _ = window.show();
                      let _ = window.set_focus();
                  }
                  let _ = request.respond(Response::from_string("OK"));
                  continue;
              }

              // Security: Validate Origin header for sensitive endpoints
              let origin = request.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("Origin")).map(|h| h.value.as_str());
              let is_valid_origin = origin.map(|o| o.starts_with("chrome-extension://") || o.starts_with("moz-extension://")).unwrap_or(false);
              
              if !is_valid_origin {
                  let _ = request.respond(Response::from_string("Forbidden").with_status_code(403));
                  continue;
              }

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
    .invoke_handler(tauri::generate_handler![delete_downloaded_file, check_downloaded_file_exists])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
