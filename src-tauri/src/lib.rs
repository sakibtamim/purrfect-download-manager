use serde_json::Value;
use std::fs;
use std::thread;
use tauri::{
    menu::{Menu, MenuItem, CheckMenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    window::{ProgressBarState, ProgressBarStatus},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_store::StoreExt;
use tiny_http::{Response, Server};

#[tauri::command]
fn set_taskbar_progress(
    window: tauri::WebviewWindow,
    progress: Option<u64>,
    status: Option<String>,
) -> Result<(), String> {
    let progress_status = match status.as_deref() {
        Some("error") => Some(ProgressBarStatus::Error),
        Some("indeterminate") => Some(ProgressBarStatus::Indeterminate),
        Some("paused") => Some(ProgressBarStatus::Paused),
        Some("none") => Some(ProgressBarStatus::None),
        _ => Some(ProgressBarStatus::Normal),
    };

    let state = ProgressBarState {
        progress,
        status: progress_status,
    };

    window.set_progress_bar(state).map_err(|e| e.to_string())
}

struct TrayStatusItem(MenuItem<tauri::Wry>);
struct TrayStartOnBootItem(CheckMenuItem<tauri::Wry>);

#[tauri::command]
fn sync_tray_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if let Some(item) = app.try_state::<TrayStartOnBootItem>() {
        let _ = item.0.set_checked(enabled);
    }
    Ok(())
}

#[tauri::command]
fn update_tray_tooltip(app: tauri::AppHandle, tooltip: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(tooltip.clone()));
    }
    if let Some(item) = app.menu().and_then(|m| m.get("status")) {
        let _ = item.as_menuitem().map(|mi| mi.set_text(tooltip.clone()));
    }
    if let Some(status_item) = app.try_state::<TrayStatusItem>() {
        let _ = status_item.0.set_text(tooltip);
    }
    Ok(())
}

#[tauri::command]
fn delete_downloaded_file(app: tauri::AppHandle, path: String, custom_dir: Option<String>) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    let target = p.canonicalize().map_err(|e| format!("Invalid path: {}", e))?;
    if !target.is_file() {
        return Err("File not found or is a directory".to_string());
    }

    let download_dir = app.path().download_dir().ok().and_then(|d| d.canonicalize().ok());
    let app_data_dir = app.path().app_local_data_dir().ok().and_then(|d| d.canonicalize().ok());
    let custom_target_dir = custom_dir.and_then(|cd| std::path::PathBuf::from(cd).canonicalize().ok());

    let is_in_download = download_dir.map(|d| target.starts_with(&d)).unwrap_or(false);
    let is_in_app_data = app_data_dir.map(|d| target.starts_with(&d)).unwrap_or(false);
    let is_in_custom = custom_target_dir.map(|d| target.starts_with(&d)).unwrap_or(false);

    if is_in_download || is_in_app_data || is_in_custom {
        std::fs::remove_file(target).map_err(|e| e.to_string())
    } else {
        Err("Permission denied: Target file is outside allowed download directories".to_string())
    }
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err("File or folder does not exist".to_string());
    }

    // Native Linux / EndeavourOS desktop file manager reveal via xdg-open
    let parent = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
    std::process::Command::new("xdg-open")
        .arg(parent)
        .spawn()
        .map_err(|e| format!("Failed to open folder via xdg-open: {}", e))?;
    Ok(())
}

#[tauri::command]
fn check_downloaded_file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[cfg(target_os = "linux")]
fn activate_linux_window(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_always_on_top(false);
        // Tao/WebKitGTK Wayland surface hitbox refresh
        let _ = window.set_resizable(false);
        let _ = window.set_resizable(true);
        let _ = window.set_focus();
    }

    let is_kde = std::env::var("XDG_CURRENT_DESKTOP")
        .map(|d| d.to_uppercase().contains("KDE"))
        .unwrap_or(false);

    if is_kde {
        std::thread::spawn(|| {
            let script_content = r#"
for (var i = 0; i < workspace.windowList().length; i++) {
    var w = workspace.windowList()[i];
    if (w.resourceClass === 'PurrfectDownloadManager' || (w.caption && w.caption.indexOf('Purrfect Download Manager') !== -1)) {
        w.minimized = false;
        workspace.activeWindow = w;
        break;
    }
}
"#;
            let temp_path = std::env::temp_dir().join(format!("pdm_raise_{}.js", std::process::id()));
            if fs::write(&temp_path, script_content).is_ok() {
                let temp_path_str = temp_path.to_string_lossy().to_string();
                let load_output = std::process::Command::new("qdbus6")
                    .args(["org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.loadScript", &temp_path_str])
                    .output();

                if let Ok(output) = load_output {
                    let script_id = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !script_id.is_empty() {
                        let _ = std::process::Command::new("qdbus6")
                            .args(["org.kde.KWin", &format!("/Scripting/Script{}", script_id), "org.kde.kwin.Script.run"])
                            .status();
                    }
                    let _ = std::process::Command::new("qdbus6")
                        .args(["org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.start"])
                        .status();

                    std::thread::sleep(std::time::Duration::from_millis(200));

                    if !script_id.is_empty() {
                        let _ = std::process::Command::new("qdbus6")
                            .args(["org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.unloadScript", &script_id])
                            .status();
                    }
                    let _ = std::process::Command::new("qdbus6")
                        .args(["org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.unloadScript", &temp_path_str])
                        .status();
                }
                let _ = fs::remove_file(temp_path);
            }
        });
    }
}

#[tauri::command]
fn raise_window(app_handle: tauri::AppHandle) {
    #[cfg(target_os = "linux")]
    activate_linux_window(&app_handle);

    #[cfg(not(target_os = "linux"))]
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_always_on_top(false);
        let _ = window.set_focus();
    }
}

#[cfg(target_os = "linux")]
fn ensure_linux_desktop_window_rules() {
    let is_kde = std::env::var("XDG_CURRENT_DESKTOP")
        .map(|d| d.to_uppercase().contains("KDE"))
        .unwrap_or(false);

    std::thread::spawn(move || {
        // Install .desktop and icon files in user-space so Wayland matches app_id
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        let data_dir = std::env::var("XDG_DATA_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| std::path::PathBuf::from(&home).join(".local/share"));

        let apps_dir = data_dir.join("applications");
        let icons_dir = data_dir.join("icons/hicolor/128x128/apps");

        let _ = fs::create_dir_all(&apps_dir);
        let _ = fs::create_dir_all(&icons_dir);

        let icon_bytes = include_bytes!("../icons/128x128.png");
        let _ = fs::write(icons_dir.join("PurrfectDownloadManager.png"), icon_bytes);
        let _ = fs::write(icons_dir.join("com.purrfectsoftwareltd.pdm.png"), icon_bytes);

        let desktop_content = "[Desktop Entry]\n\
Name=Purrfect Download Manager\n\
Comment=Fast and aesthetic download manager\n\
Exec=PurrfectDownloadManager\n\
Icon=PurrfectDownloadManager\n\
Type=Application\n\
StartupWMClass=PurrfectDownloadManager\n\
Terminal=false\n\
Categories=Network;FileTransfer;\n";

        let _ = fs::write(apps_dir.join("PurrfectDownloadManager.desktop"), desktop_content);
        let _ = fs::write(apps_dir.join("com.purrfectsoftwareltd.pdm.desktop"), desktop_content);

        let _ = std::process::Command::new("kbuildsycoca6").status();
        let _ = std::process::Command::new("update-desktop-database").arg(&apps_dir).status();

        if is_kde {
            // Configure KWin Focus Stealing Prevention bypass rule for PurrfectDownloadManager
            // so intercepted downloads reliably auto-pop, unminimize, and focus above browsers.
            let _ = std::process::Command::new("kwriteconfig6")
                .args(["--file", "kwinrulesrc", "--group", "pdm-focus", "--key", "Description", "Purrfect Download Manager Focus Rule"])
                .status();
            let _ = std::process::Command::new("kwriteconfig6")
                .args(["--file", "kwinrulesrc", "--group", "pdm-focus", "--key", "wmclass", "PurrfectDownloadManager"])
                .status();
            let _ = std::process::Command::new("kwriteconfig6")
                .args(["--file", "kwinrulesrc", "--group", "pdm-focus", "--key", "wmclassmatch", "1"])
                .status();
            let _ = std::process::Command::new("kwriteconfig6")
                .args(["--file", "kwinrulesrc", "--group", "pdm-focus", "--key", "focusstealing", "0"])
                .status();
            let _ = std::process::Command::new("kwriteconfig6")
                .args(["--file", "kwinrulesrc", "--group", "pdm-focus", "--key", "focusstealingrule", "2"])
                .status();
            let _ = std::process::Command::new("kwriteconfig6")
                .args(["--file", "kwinrulesrc", "--group", "pdm-focus", "--key", "above", "--delete"])
                .status();
            let _ = std::process::Command::new("kwriteconfig6")
                .args(["--file", "kwinrulesrc", "--group", "pdm-focus", "--key", "aboverule", "--delete"])
                .status();

            let _ = std::process::Command::new("qdbus6")
                .args(["org.kde.KWin", "/KWin", "org.kde.KWin.reconfigure"])
                .status();
        }
    });
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
      WindowEvent::Focused(true) => {
          #[cfg(target_os = "linux")]
          {
              let _ = window.set_resizable(false);
              let _ = window.set_resizable(true);
          }
      }
      WindowEvent::CloseRequested { api, .. } => {
        let app = window.app_handle();
        let close_to_tray = app
            .store("settings.json")
            .ok()
            .and_then(|store| store.get("closeToTray"))
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        if close_to_tray {
            window.hide().unwrap();
            api.prevent_close();
        } else {
            app.exit(0);
        }
      }
      WindowEvent::Resized(_) => {
          let app = window.app_handle();
          let minimize_to_tray = app
              .store("settings.json")
              .ok()
              .and_then(|store| store.get("minimizeToTray"))
              .and_then(|v| v.as_bool())
              .unwrap_or(false);

          if minimize_to_tray && window.is_minimized().unwrap_or(false) {
              let _ = window.hide();
          }
      }
      _ => {}
    })
    .setup(|app| {
      #[cfg(target_os = "linux")]
      ensure_linux_desktop_window_rules();

      let start_minimized = app
          .store("settings.json")
          .ok()
          .and_then(|store| store.get("startMinimized"))
          .and_then(|v| v.as_bool())
          .unwrap_or(false);

      if start_minimized {
          if let Some(window) = app.get_webview_window("main") {
              let _ = window.hide();
          }
      }

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      
      let status_i = MenuItem::with_id(app, "status", "Purrfect DL — Ready", false, None::<&str>)?;
      app.manage(TrayStatusItem(status_i.clone()));
      let show_i = MenuItem::with_id(app, "show", "Open Dashboard", true, None::<&str>)?;
      let new_download_i = MenuItem::with_id(app, "new-download", "New Download", true, None::<&str>)?;
      let pause_all_i = MenuItem::with_id(app, "pause-all", "Pause All", true, None::<&str>)?;
      let resume_all_i = MenuItem::with_id(app, "resume-all", "Resume All", true, None::<&str>)?;
      let open_downloads_i = MenuItem::with_id(app, "open-downloads", "Open Downloads Folder", true, None::<&str>)?;
      
      let autostart_manager = app.autolaunch();
      let is_autostart = autostart_manager.is_enabled().unwrap_or(false);
      let start_on_boot_i = CheckMenuItem::with_id(app, "start-on-boot", "Start on Boot", true, is_autostart, None::<&str>)?;
      app.manage(TrayStartOnBootItem(start_on_boot_i.clone()));
      
      let quit_i = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
      
      let separator = PredefinedMenuItem::separator(app)?;
      
      let menu = Menu::with_items(app, &[
          &status_i,
          &separator,
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
      
      let _tray = TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event({
            let start_on_boot_i = start_on_boot_i.clone();
            move |app, event| {
                match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        #[cfg(target_os = "linux")]
                        activate_linux_window(app);

                        #[cfg(not(target_os = "linux"))]
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "new-download" => {
                        let _ = app.emit("tray-new-download", ());
                        #[cfg(target_os = "linux")]
                        activate_linux_window(app);

                        #[cfg(not(target_os = "linux"))]
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
                        let new_state = !current;
                        let success = if current {
                            autostart_manager.disable().is_ok()
                        } else {
                            autostart_manager.enable().is_ok()
                        };
                        if success {
                            let _ = start_on_boot_i.set_checked(new_state);
                            let _ = app.emit("tray-autostart-changed", new_state);
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
                        #[cfg(target_os = "linux")]
                        activate_linux_window(tray.app_handle());

                        #[cfg(not(target_os = "linux"))]
                        {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
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

      let current_pid = std::process::id();
      let stop_with_process_arg = format!("--stop-with-process={}", current_pid);

      let aria2_args = [
          "--enable-rpc", 
          "--rpc-listen-all=false", 
          "--rpc-allow-origin-all=true",
          "--rpc-listen-port=6800", 
          "--check-certificate=true",
          "--file-allocation=falloc",
          "--save-session-interval=10",
          "--continue=true",
          "--split=32",
          "--max-connection-per-server=16",
          "--min-split-size=1M",
          "--disk-cache=64M",
          "--piece-length=1M",
          &stop_with_process_arg,
          &session_arg,
          &input_file_arg,
          &dir_arg,
          "--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
      ];

      // Try bundled pdm-aria2c sidecar first; fall back to system aria2c if spawn fails
      let sidecar_spawn = app.shell().sidecar("pdm-aria2c").and_then(|cmd| cmd.args(&aria2_args).spawn());
      let final_spawn = match sidecar_spawn {
          Ok(child) => Ok(child),
          Err(err) => {
              log::warn!("Bundled pdm-aria2c sidecar spawn failed ({}), falling back to system-aria2c...", err);
              app.shell().command("system-aria2c").args(&aria2_args).spawn()
          }
      };

      match final_spawn {
          Ok((mut rx, _child)) => {
              tauri::async_runtime::spawn(async move {
                  let _child_keep_alive = _child;
                  while let Some(_event) = rx.recv().await {
                      // Keep receiver active
                  }
              });
          }
          Err(err) => {
              eprintln!("Failed to spawn aria2 daemon: {}. Please ensure aria2 is installed via pacman -S aria2 or run pnpm setup.", err);
          }
      }
      
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
                  #[cfg(target_os = "linux")]
                  activate_linux_window(&app_handle);

                  #[cfg(not(target_os = "linux"))]
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
                      #[cfg(target_os = "linux")]
                      activate_linux_window(&app_handle);

                      #[cfg(not(target_os = "linux"))]
                      if let Some(window) = app_handle.get_webview_window("main") {
                          let _ = window.unminimize();
                          let _ = window.show();
                          let _ = window.set_always_on_top(false);
                          let _ = window.set_focus();
                      }
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
    .invoke_handler(tauri::generate_handler![delete_downloaded_file, check_downloaded_file_exists, reveal_in_folder, raise_window, update_tray_tooltip, set_taskbar_progress, sync_tray_autostart])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
