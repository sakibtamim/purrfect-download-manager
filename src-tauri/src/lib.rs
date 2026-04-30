use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_fs::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      
      let sidecar_command = app.shell().sidecar("aria2c").unwrap()
        .args(["--enable-rpc", "--rpc-listen-all=false", "--rpc-listen-port=6800", "--rpc-allow-origin-all"]);
        
      let (mut rx, mut _child) = sidecar_command.spawn().expect("Failed to spawn aria2c");
      
      tauri::async_runtime::spawn(async move {
        while let Some(_event) = rx.recv().await {
            // Read output if necessary
        }
      });
      
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
