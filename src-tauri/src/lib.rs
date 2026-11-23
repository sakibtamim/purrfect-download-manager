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
use tiny_http::{Header, Response, Server};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct Aria2Config {
    pub port: u16,
    pub secret: String,
}

#[derive(Clone)]
pub struct Aria2Secret(pub String);

#[derive(Clone, Default)]
pub struct Aria2ErrorState(pub std::sync::Arc<std::sync::Mutex<Option<String>>>);

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug, PartialEq, Eq)]
pub struct SystemDrive {
    pub id: String,
    pub label: String,
    pub mount_point: String,
    pub free_space: u64,
    pub total_space: u64,
    pub is_removable: bool,
}

#[cfg(target_os = "linux")]
fn unescape_proc_mount(s: &str) -> String {
    s.replace("\\040", " ")
        .replace("\\011", "\t")
        .replace("\\012", "\n")
        .replace("\\134", "\\")
}

#[cfg(target_os = "linux")]
fn unescape_hex(s: &str) -> String {
    let mut bytes = Vec::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' && chars.peek() == Some(&'x') {
            chars.next();
            let h1 = chars.next();
            let h2 = chars.next();
            if let (Some(c1), Some(c2)) = (h1, h2) {
                if let Ok(byte) = u8::from_str_radix(&format!("{}{}", c1, c2), 16) {
                    bytes.push(byte);
                    continue;
                } else {
                    bytes.extend_from_slice(b"\\x");
                    let mut buf = [0u8; 4];
                    bytes.extend_from_slice(c1.encode_utf8(&mut buf).as_bytes());
                    bytes.extend_from_slice(c2.encode_utf8(&mut buf).as_bytes());
                    continue;
                }
            } else {
                bytes.extend_from_slice(b"\\x");
                if let Some(c1) = h1 {
                    let mut buf = [0u8; 4];
                    bytes.extend_from_slice(c1.encode_utf8(&mut buf).as_bytes());
                }
                continue;
            }
        }
        let mut buf = [0u8; 4];
        bytes.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

#[cfg(target_os = "linux")]
fn get_system_drives_linux() -> Result<Vec<SystemDrive>, String> {
    use std::collections::{HashMap, HashSet};
    use std::ffi::CString;
    use std::fs;
    use std::mem::MaybeUninit;
    use std::path::Path;

    let mut label_map: HashMap<String, String> = HashMap::new();
    if let Ok(entries) = fs::read_dir("/dev/disk/by-label") {
        for entry in entries.flatten() {
            let label_name = entry.file_name().to_string_lossy().to_string();
            let unescaped_label = unescape_hex(&label_name);
            let path = entry.path();
            if let Ok(target) = fs::canonicalize(&path) {
                if let Some(dev_name) = target.file_name().and_then(|n| n.to_str()) {
                    label_map.insert(dev_name.to_string(), unescaped_label.clone());
                }
                label_map.insert(target.to_string_lossy().to_string(), unescaped_label.clone());
            } else if let Ok(target) = fs::read_link(&path) {
                if let Some(dev_name) = target.file_name().and_then(|n| n.to_str()) {
                    label_map.insert(dev_name.to_string(), unescaped_label.clone());
                }
            }
        }
    }

    let mounts_content = fs::read_to_string("/proc/mounts")
        .map_err(|e| format!("Failed to read /proc/mounts: {}", e))?;

    let mut drives = Vec::new();
    let mut seen_mounts = HashSet::new();

    for line in mounts_content.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }

        let dev_path = parts[0];
        let raw_mount = parts[1];
        let mount_point = unescape_proc_mount(raw_mount);

        let is_valid_device = (dev_path.starts_with("/dev/sd")
            || dev_path.starts_with("/dev/nvme")
            || dev_path.starts_with("/dev/vd")
            || dev_path.starts_with("/dev/mapper/")
            || dev_path.starts_with("/dev/mmcblk"))
            && !dev_path.starts_with("/dev/loop")
            && !dev_path.starts_with("/dev/zram");

        if !is_valid_device {
            continue;
        }

        if mount_point.starts_with("/boot")
            || mount_point.starts_with("/efi")
            || mount_point.starts_with("/var/cache")
            || mount_point.starts_with("/var/log")
            || mount_point.starts_with("/var/lib/flatpak")
        {
            continue;
        }

        let is_included = mount_point == "/"
            || mount_point == "/home"
            || mount_point.starts_with("/home/")
            || mount_point == "/mnt"
            || mount_point.starts_with("/mnt/")
            || mount_point == "/run/media"
            || mount_point.starts_with("/run/media/")
            || mount_point == "/media"
            || mount_point.starts_with("/media/");

        if !is_included {
            continue;
        }

        if !seen_mounts.insert(mount_point.clone()) {
            continue;
        }

        let c_mount = match CString::new(mount_point.as_bytes()) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let mut stat = MaybeUninit::<libc::statvfs>::uninit();
        let res = unsafe { libc::statvfs(c_mount.as_ptr(), stat.as_mut_ptr()) };
        if res != 0 {
            continue;
        }

        let stat = unsafe { stat.assume_init() };
        let frsize = if stat.f_frsize > 0 {
            stat.f_frsize
        } else {
            stat.f_bsize
        };
        let total_space = stat.f_blocks.saturating_mul(frsize);
        let free_space = stat.f_bavail.saturating_mul(frsize);

        if total_space == 0 {
            continue;
        }

        let dev_basename = Path::new(dev_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");

        let label = if let Some(lbl) = label_map.get(dev_basename) {
            lbl.clone()
        } else if let Some(lbl) = label_map.get(dev_path) {
            lbl.clone()
        } else if mount_point == "/" {
            "System".to_string()
        } else if mount_point == "/home" {
            "Home".to_string()
        } else {
            Path::new(&mount_point)
                .file_name()
                .and_then(|n| n.to_str())
                .filter(|s| !s.is_empty())
                .unwrap_or("Drive")
                .to_string()
        };

        let is_removable = mount_point.starts_with("/run/media") || mount_point.starts_with("/media");

        drives.push(SystemDrive {
            id: mount_point.clone(),
            label,
            mount_point,
            free_space,
            total_space,
            is_removable,
        });
    }

    if drives.is_empty() {
        if let Ok(c_mount) = CString::new("/") {
            let mut stat = MaybeUninit::<libc::statvfs>::uninit();
            let res = unsafe { libc::statvfs(c_mount.as_ptr(), stat.as_mut_ptr()) };
            if res == 0 {
                let stat = unsafe { stat.assume_init() };
                let frsize = if stat.f_frsize > 0 {
                    stat.f_frsize
                } else {
                    stat.f_bsize
                };
                let total_space = stat.f_blocks.saturating_mul(frsize);
                let free_space = stat.f_bavail.saturating_mul(frsize);
                if total_space > 0 {
                    drives.push(SystemDrive {
                        id: "/".to_string(),
                        label: "System".to_string(),
                        mount_point: "/".to_string(),
                        free_space,
                        total_space,
                        is_removable: false,
                    });
                }
            }
        }
    }

    Ok(drives)
}

#[cfg(target_os = "windows")]
fn get_system_drives_windows() -> Result<Vec<SystemDrive>, String> {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            lpDirectoryName: *const u16,
            lpFreeBytesAvailableToCaller: *mut u64,
            lpTotalNumberOfBytes: *mut u64,
            lpTotalNumberOfFreeBytes: *mut u64,
        ) -> i32;
    }

    let mut drives = Vec::new();
    for letter in b'C'..=b'Z' {
        let root = format!("{}:\\", letter as char);
        if std::path::Path::new(&root).exists() {
            let mut free_avail: u64 = 0;
            let mut total: u64 = 0;
            let mut total_free: u64 = 0;
            let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
            let success = unsafe {
                GetDiskFreeSpaceExW(
                    wide.as_ptr(),
                    &mut free_avail,
                    &mut total,
                    &mut total_free,
                )
            };
            if success == 0 || total == 0 {
                continue;
            }
            let label = if (letter as char) == 'C' {
                "System (C:)".to_string()
            } else {
                format!("Drive ({}:)", letter as char)
            };
            drives.push(SystemDrive {
                id: root.clone(),
                label,
                mount_point: root,
                free_space: free_avail,
                total_space: total,
                is_removable: false,
            });
        }
    }
    Ok(drives)
}

#[cfg(target_os = "macos")]
fn get_system_drives_macos() -> Result<Vec<SystemDrive>, String> {
    use std::collections::HashSet;
    use std::ffi::CString;
    use std::fs;
    use std::mem::MaybeUninit;
    use std::path::Path;

    let mut drives = Vec::new();
    let mut seen = HashSet::new();
    let mut candidates = vec!["/".to_string(), "/System/Volumes/Data".to_string()];

    if let Ok(entries) = fs::read_dir("/Volumes") {
        for entry in entries.flatten() {
            let path = entry.path().to_string_lossy().to_string();
            candidates.push(path);
        }
    }

    for mount in candidates {
        if !Path::new(&mount).exists() || !seen.insert(mount.clone()) {
            continue;
        }

        let c_mount = match CString::new(mount.as_bytes()) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let mut stat = MaybeUninit::<libc::statvfs>::uninit();
        let res = unsafe { libc::statvfs(c_mount.as_ptr(), stat.as_mut_ptr()) };
        if res != 0 {
            continue;
        }

        let stat = unsafe { stat.assume_init() };
        let frsize = if stat.f_frsize > 0 {
            stat.f_frsize
        } else {
            stat.f_bsize
        };
        let total_space = stat.f_blocks.saturating_mul(frsize);
        let free_space = stat.f_bavail.saturating_mul(frsize);

        if total_space == 0 {
            continue;
        }

        let label = if mount == "/" {
            "Macintosh HD".to_string()
        } else if mount == "/System/Volumes/Data" {
            "Data".to_string()
        } else {
            Path::new(&mount)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Volume")
                .to_string()
        };

        let is_removable = mount.starts_with("/Volumes/");

        drives.push(SystemDrive {
            id: mount.clone(),
            label,
            mount_point: mount,
            free_space,
            total_space,
            is_removable,
        });
    }

    Ok(drives)
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn get_system_drives_fallback() -> Result<Vec<SystemDrive>, String> {
    Ok(vec![SystemDrive {
        id: "/".to_string(),
        label: "System".to_string(),
        mount_point: "/".to_string(),
        free_space: 0,
        total_space: 0,
        is_removable: false,
    }])
}

#[tauri::command]
fn get_system_drives() -> Result<Vec<SystemDrive>, String> {
    #[cfg(target_os = "linux")]
    return get_system_drives_linux();

    #[cfg(target_os = "windows")]
    return get_system_drives_windows();

    #[cfg(target_os = "macos")]
    return get_system_drives_macos();

    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    return get_system_drives_fallback();
}

#[tauri::command]
fn get_aria2_config(
    state: tauri::State<Aria2Config>,
    error_state: tauri::State<Aria2ErrorState>,
) -> Result<Aria2Config, String> {
    if let Ok(guard) = error_state.0.lock() {
        if let Some(ref err) = *guard {
            return Err(err.clone());
        }
    }
    if state.port == 0 {
        return Err("Failed to find available port for aria2: all ports in range 6800-6820 are occupied".to_string());
    }
    Ok(state.inner().clone())
}

#[tauri::command]
fn get_aria2_secret(state: tauri::State<Aria2Config>) -> String {
    state.secret.clone()
}

#[tauri::command]
fn get_aria2_error(state: tauri::State<Aria2ErrorState>) -> Option<String> {
    state.0.lock().ok().and_then(|guard| guard.clone())
}

fn find_available_port(start: u16, end: u16) -> Option<u16> {
    (start..=end).find(|&port| std::net::TcpListener::bind(("127.0.0.1", port)).is_ok())
}

fn generate_ephemeral_token() -> String {
    #[cfg(unix)]
    {
        if let Ok(mut file) = std::fs::File::open("/dev/urandom") {
            use std::io::Read;
            let mut bytes = [0u8; 16];
            if file.read_exact(&mut bytes).is_ok() {
                return bytes.iter().map(|b| format!("{:02x}", b)).collect();
            }
        }
    }

    let time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let pid = std::process::id();
    let stack_addr = &time as *const _ as usize;
    format!("{:016x}{:08x}{:016x}", (time ^ (stack_addr as u128)) as u64, pid, (time >> 64) as u64)
}

fn resolve_downloads_folder(
    configured_dir: Option<std::path::PathBuf>,
    system_download_dir: Option<std::path::PathBuf>,
) -> Option<std::path::PathBuf> {
    if let Some(conf) = configured_dir {
        if !conf.as_os_str().is_empty() {
            let _ = fs::create_dir_all(&conf);
            if conf.exists() {
                return Some(conf);
            }
        }
    }
    if let Some(sys) = system_download_dir {
        let _ = fs::create_dir_all(&sys);
        if sys.exists() {
            return Some(sys);
        }
    }
    None
}

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

fn safe_remove_file(target: &std::path::Path) -> std::io::Result<()> {
    let mut last_err = None;
    for _ in 0..5 {
        match std::fs::remove_file(target) {
            Ok(()) => return Ok(()),
            Err(e) => {
                if !target.exists() {
                    return Ok(());
                }
                last_err = Some(e);
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    }
    Err(last_err.unwrap())
}

fn safe_remove_dir_all(target: &std::path::Path) -> std::io::Result<()> {
    let mut last_err = None;
    for _ in 0..5 {
        match std::fs::remove_dir_all(target) {
            Ok(()) => return Ok(()),
            Err(e) => {
                if !target.exists() {
                    return Ok(());
                }
                last_err = Some(e);
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    }
    Err(last_err.unwrap())
}

fn validate_and_delete_path(
    target: &std::path::Path,
    download_dir: Option<&std::path::Path>,
    app_data_dir: Option<&std::path::Path>,
    configured_dir: Option<&std::path::Path>,
    custom_target_dir: Option<&std::path::Path>,
    home_dir: Option<&std::path::Path>,
) -> Result<(), String> {
    let is_in_download = download_dir.map(|d| target.starts_with(d)).unwrap_or(false);
    let is_in_app_data = app_data_dir.map(|d| target.starts_with(d)).unwrap_or(false);
    let is_in_configured = configured_dir.map(|d| target.starts_with(d)).unwrap_or(false);
    let is_in_custom = custom_target_dir.map(|d| target.starts_with(d)).unwrap_or(false);

    if !is_in_download && !is_in_app_data && !is_in_configured && !is_in_custom {
        return Err("Permission denied: Target file is outside allowed download directories".to_string());
    }

    if target.is_file() {
        safe_remove_file(target).map_err(|e| e.to_string())
    } else if target.is_dir() {
        let is_root_dir = download_dir.map(|d| target == d).unwrap_or(false)
            || app_data_dir.map(|d| target == d).unwrap_or(false)
            || configured_dir.map(|d| target == d).unwrap_or(false)
            || custom_target_dir.map(|d| target == d).unwrap_or(false);

        if is_root_dir {
            return Err("Cannot remove root download directory".to_string());
        }

        if target.parent().is_none() {
            return Err("Cannot remove filesystem root".to_string());
        }

        if home_dir.map(|h| target == h).unwrap_or(false) {
            return Err("Cannot remove home directory".to_string());
        }

        if let Some(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).ok().and_then(|h| std::path::PathBuf::from(h).canonicalize().ok()) {
            if target == home {
                return Err("Cannot remove home directory".to_string());
            }
        }

        safe_remove_dir_all(target).map_err(|e| e.to_string())
    } else {
        safe_remove_file(target).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn delete_downloaded_file(app: tauri::AppHandle, path: String, custom_dir: Option<String>) -> Result<(), String> {
    if path.trim().is_empty() {
        return Ok(());
    }

    let download_dir = app.path().download_dir().ok().and_then(|d| d.canonicalize().ok());
    let app_data_dir = app.path().app_local_data_dir().ok().and_then(|d| d.canonicalize().ok());
    let configured_dir = app
        .store("settings.json")
        .ok()
        .and_then(|store| store.get("defaultDownloadDir"))
        .and_then(|v| v.as_str().filter(|s| !s.trim().is_empty()).map(std::path::PathBuf::from))
        .and_then(|d| d.canonicalize().ok());
    let custom_target_dir = custom_dir
        .filter(|cd| !cd.trim().is_empty())
        .and_then(|cd| std::path::PathBuf::from(cd).canonicalize().ok());
    let home_dir = app.path().home_dir().ok().and_then(|h| h.canonicalize().ok());

    let mut p = std::path::PathBuf::from(&path);

    // If relative, resolve against custom_dir, configured_dir, or download_dir
    if p.is_relative() {
        if let Some(ref cd) = custom_target_dir {
            let candidate = cd.join(&p);
            if candidate.symlink_metadata().is_ok() {
                p = candidate;
            }
        } else if let Some(ref cd) = configured_dir {
            let candidate = cd.join(&p);
            if candidate.symlink_metadata().is_ok() {
                p = candidate;
            }
        } else if let Some(ref dd) = download_dir {
            let candidate = dd.join(&p);
            if candidate.symlink_metadata().is_ok() {
                p = candidate;
            }
        }
    }

    if p.symlink_metadata().is_err() {
        return Ok(());
    }

    let is_symlink = p.symlink_metadata().map(|m| m.file_type().is_symlink()).unwrap_or(false);
    let target = match p.canonicalize() {
        Ok(t) => t,
        Err(_) if is_symlink => {
            // Broken symlink: validate the symlink's parent against allowed download directories
            let parent = p.parent().and_then(|p| p.canonicalize().ok());
            if let Some(ref par) = parent {
                let is_in_download = download_dir.as_ref().map(|d| par.starts_with(d)).unwrap_or(false);
                let is_in_app_data = app_data_dir.as_ref().map(|d| par.starts_with(d)).unwrap_or(false);
                let is_in_configured = configured_dir.as_ref().map(|d| par.starts_with(d)).unwrap_or(false);
                let is_in_custom = custom_target_dir.as_ref().map(|d| par.starts_with(d)).unwrap_or(false);

                if is_in_download || is_in_app_data || is_in_configured || is_in_custom {
                    return std::fs::remove_file(&p).map_err(|e| e.to_string());
                }
            }
            return Err("Permission denied: Broken symlink is outside allowed download directories".to_string());
        }
        Err(e) => return Err(format!("Invalid path: {}", e)),
    };

    validate_and_delete_path(
        &target,
        download_dir.as_deref(),
        app_data_dir.as_deref(),
        configured_dir.as_deref(),
        custom_target_dir.as_deref(),
        home_dir.as_deref(),
    )
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err("File or folder does not exist".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let win_path = path.replace('/', "\\");
        std::process::Command::new("explorer.exe")
            .arg(format!("/select,{}", win_path))
            .spawn()
            .map_err(|e| format!("Failed to open folder via explorer: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to reveal file via open -R: {}", e))?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let parent = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Failed to open folder via xdg-open: {}", e))?;
    }

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
        let _ = fs::create_dir_all(&apps_dir);

        let icon_variants: [(&str, &[u8]); 3] = [
            ("icons/hicolor/128x128/apps", include_bytes!("../icons/128x128.png")),
            ("icons/hicolor/256x256/apps", include_bytes!("../icons/128x128@2x.png")),
            ("icons/hicolor/512x512/apps", include_bytes!("../icons/icon.png")),
        ];

        for (rel_path, bytes) in icon_variants {
            let target_dir = data_dir.join(rel_path);
            let _ = fs::create_dir_all(&target_dir);
            let _ = fs::write(target_dir.join("PurrfectDownloadManager.png"), bytes);
            let _ = fs::write(target_dir.join("com.purrfectsoftwareltd.pdm.png"), bytes);
        }

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
                        let configured_dir = app
                            .store("settings.json")
                            .ok()
                            .and_then(|store| store.get("defaultDownloadDir"))
                            .and_then(|v| v.as_str().filter(|s| !s.trim().is_empty()).map(std::path::PathBuf::from));
                        let sys_dir = app.path().download_dir().ok();

                        if let Some(dir) = resolve_downloads_folder(configured_dir, sys_dir) {
                            #[allow(deprecated)]
                            let _ = app.shell().open(dir.to_string_lossy().to_string(), None);
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

      let secret_token = generate_ephemeral_token();
      let error_state = Aria2ErrorState::default();
      app.manage(error_state.clone());

      let aria2_port_opt = find_available_port(6800, 6820);
      let aria2_port = match aria2_port_opt {
          Some(port) => port,
          None => {
              let err_msg = "Failed to find available port for aria2: all ports in range 6800-6820 are occupied".to_string();
              log::error!("{}", err_msg);
              eprintln!("{}", err_msg);
              if let Ok(mut guard) = error_state.0.lock() {
                  *guard = Some(err_msg.clone());
              }
              let _ = app.emit("aria2-error", err_msg);
              0
          }
      };

      app.manage(Aria2Config {
          port: aria2_port,
          secret: secret_token.clone(),
      });
      app.manage(Aria2Secret(secret_token.clone()));

      if aria2_port > 0 {
          let secret_arg = format!("--rpc-secret={}", secret_token);
          let port_arg = format!("--rpc-listen-port={}", aria2_port);

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
              &port_arg, 
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
              &secret_arg,
              "--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
          ];

          // Try bundled pdm-aria2c sidecar first; fall back to system aria2c if spawn fails
          let sidecar_spawn = app.shell().sidecar("pdm-aria2c").and_then(|cmd| cmd.args(aria2_args).spawn());
          let final_spawn = match sidecar_spawn {
              Ok(child) => Ok(child),
              Err(err) => {
                  log::warn!("Bundled pdm-aria2c sidecar spawn failed ({}), falling back to system-aria2c...", err);
                  app.shell().command("system-aria2c").args(aria2_args).spawn()
              }
          };

          let app_handle_for_events = app.handle().clone();
          let error_state_for_events = error_state.clone();
          match final_spawn {
              Ok((mut rx, _child)) => {
                  tauri::async_runtime::spawn(async move {
                      let _child_keep_alive = _child;
                      while let Some(event) = rx.recv().await {
                          use tauri_plugin_shell::process::CommandEvent;
                          match event {
                              CommandEvent::Stderr(bytes) => {
                                  let msg = String::from_utf8_lossy(&bytes);
                                  if msg.contains("Failed to bind") || msg.contains("Exception") || msg.contains("errorCode=") {
                                      log::error!("aria2 error: {}", msg);
                                      eprintln!("aria2 error: {}", msg);
                                      if let Ok(mut guard) = error_state_for_events.0.lock() {
                                          *guard = Some(msg.to_string());
                                      }
                                      let _ = app_handle_for_events.emit("aria2-error", msg.to_string());
                                  }
                              }
                              CommandEvent::Terminated(payload) => {
                                  if payload.code != Some(0) {
                                      let err_msg = format!("aria2 daemon terminated unexpectedly with exit code: {:?}", payload.code);
                                      log::error!("{}", err_msg);
                                      eprintln!("{}", err_msg);
                                      if let Ok(mut guard) = error_state_for_events.0.lock() {
                                          *guard = Some(err_msg.clone());
                                      }
                                      let _ = app_handle_for_events.emit("aria2-error", err_msg);
                                  }
                              }
                              CommandEvent::Error(err) => {
                                  log::error!("aria2 process error: {}", err);
                                  eprintln!("aria2 process error: {}", err);
                                  if let Ok(mut guard) = error_state_for_events.0.lock() {
                                      *guard = Some(err.clone());
                                  }
                                  let _ = app_handle_for_events.emit("aria2-error", err);
                              }
                              _ => {}
                          }
                      }
                  });
              }
              Err(err) => {
                  let err_msg = format!("Failed to spawn aria2 daemon: {}. Please ensure aria2 is installed via pacman -S aria2 or run pnpm setup.", err);
                  log::error!("{}", err_msg);
                  eprintln!("{}", err_msg);
                  if let Ok(mut guard) = error_state.0.lock() {
                      *guard = Some(err_msg.clone());
                  }
                  let _ = app.emit("aria2-error", err_msg);
              }
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
              let origin = request.headers().iter()
                  .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("Origin"))
                  .map(|h| h.value.as_str().to_string());

              // Handle harmless read-only endpoints with permissive CORS so popups can connect
              if request.method().as_str() == "GET" && request.url() == "/health" {
                  let mut resp = Response::from_string("OK");
                  if let Ok(h) = Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]) {
                      resp.add_header(h);
                  }
                  let _ = request.respond(resp);
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
                  let mut resp = Response::from_string("OK");
                  if let Ok(h) = Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]) {
                      resp.add_header(h);
                  }
                  let _ = request.respond(resp);
                  continue;
              }

              // Security: Validate Origin header for sensitive endpoints
              let is_valid_origin = origin.as_deref()
                  .map(|o| o.starts_with("chrome-extension://") || o.starts_with("moz-extension://") || o.starts_with("safari-web-extension://"))
                  .unwrap_or(false);
              
              if !is_valid_origin {
                  let _ = request.respond(Response::from_string("Forbidden").with_status_code(403));
                  continue;
              }

              if request.method().as_str() == "OPTIONS" {
                  let mut response = Response::empty(204);
                  if let Some(ref o) = origin {
                      if let Ok(h) = Header::from_bytes(&b"Access-Control-Allow-Origin"[..], o.as_bytes()) {
                          response.add_header(h);
                      }
                  }
                  if let Ok(h) = Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"POST, GET, OPTIONS"[..]) {
                      response.add_header(h);
                  }
                  let req_headers = request.headers().iter()
                      .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("Access-Control-Request-Headers"))
                      .map(|h| h.value.as_str().to_string())
                      .unwrap_or_else(|| "Content-Type, Authorization, *".to_string());
                  if let Ok(h) = Header::from_bytes(&b"Access-Control-Allow-Headers"[..], req_headers.as_bytes()) {
                      response.add_header(h);
                  }
                  if let Ok(h) = Header::from_bytes(&b"Access-Control-Max-Age"[..], &b"86400"[..]) {
                      response.add_header(h);
                  }
                  let _ = request.respond(response);
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
                  
                  let mut response = Response::from_string("OK");
                  if let Some(ref o) = origin {
                      if let Ok(h) = Header::from_bytes(&b"Access-Control-Allow-Origin"[..], o.as_bytes()) {
                          response.add_header(h);
                      }
                  }
                  let _ = request.respond(response);
              } else {
                  let _ = request.respond(Response::from_string("Not Found").with_status_code(404));
              }
          }
      });
      
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        delete_downloaded_file,
        check_downloaded_file_exists,
        reveal_in_folder,
        raise_window,
        update_tray_tooltip,
        set_taskbar_progress,
        sync_tray_autostart,
        get_aria2_secret,
        get_aria2_config,
        get_aria2_error,
        get_system_drives
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_delete_file_in_allowed_directory() {
        let temp_dir = std::env::temp_dir().join(format!("pdm_test_allowed_{}", std::process::id()));
        fs::create_dir_all(&temp_dir).unwrap();
        let test_file = temp_dir.join("test_file.txt");
        fs::write(&test_file, b"content").unwrap();

        let target = test_file.canonicalize().unwrap();
        let allowed = temp_dir.canonicalize().unwrap();

        let res = validate_and_delete_path(&target, None, None, None, Some(&allowed), None);
        assert!(res.is_ok());
        assert!(!target.exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_delete_file_outside_allowed_directory_rejected() {
        let temp_dir = std::env::temp_dir().join(format!("pdm_test_outside_{}", std::process::id()));
        let foreign_dir = std::env::temp_dir().join(format!("pdm_test_foreign_{}", std::process::id()));
        fs::create_dir_all(&temp_dir).unwrap();
        fs::create_dir_all(&foreign_dir).unwrap();

        let test_file = foreign_dir.join("foreign.txt");
        fs::write(&test_file, b"danger").unwrap();

        let target = test_file.canonicalize().unwrap();
        let allowed = temp_dir.canonicalize().unwrap();

        let res = validate_and_delete_path(&target, None, None, None, Some(&allowed), None);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Permission denied"));
        assert!(target.exists());

        let _ = fs::remove_dir_all(temp_dir);
        let _ = fs::remove_dir_all(foreign_dir);
    }

    #[test]
    fn test_delete_directory_in_allowed_directory() {
        let temp_dir = std::env::temp_dir().join(format!("pdm_test_sub_{}", std::process::id()));
        let sub_dir = temp_dir.join("torrent_folder");
        fs::create_dir_all(&sub_dir).unwrap();
        fs::write(sub_dir.join("subfile.bin"), b"123").unwrap();

        let target = sub_dir.canonicalize().unwrap();
        let allowed = temp_dir.canonicalize().unwrap();

        let res = validate_and_delete_path(&target, None, None, None, Some(&allowed), None);
        assert!(res.is_ok());
        assert!(!target.exists());
        assert!(allowed.exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_refuse_delete_root_download_directory() {
        let temp_dir = std::env::temp_dir().join(format!("pdm_test_root_{}", std::process::id()));
        fs::create_dir_all(&temp_dir).unwrap();

        let allowed = temp_dir.canonicalize().unwrap();
        let target = allowed.clone();

        let res = validate_and_delete_path(&target, None, None, None, Some(&allowed), None);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Cannot remove root download directory"));
        assert!(allowed.exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_refuse_delete_home_directory() {
        let temp_dir = std::env::temp_dir().join(format!("pdm_test_home_sub_{}", std::process::id()));
        let fake_home = temp_dir.join("fake_home");
        fs::create_dir_all(&fake_home).unwrap();

        let home_target = fake_home.canonicalize().unwrap();
        let allowed = temp_dir.canonicalize().unwrap();

        let res = validate_and_delete_path(&home_target, None, None, None, Some(&allowed), Some(&home_target));
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Cannot remove home directory"));
        assert!(home_target.exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_safe_remove_file_retry_success() {
        let temp_dir = std::env::temp_dir().join(format!("pdm_test_retry_{}", std::process::id()));
        fs::create_dir_all(&temp_dir).unwrap();
        let test_file = temp_dir.join("retry.txt");
        fs::write(&test_file, b"data").unwrap();

        assert!(safe_remove_file(&test_file).is_ok());
        assert!(!test_file.exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_generate_ephemeral_token() {
        let token1 = generate_ephemeral_token();
        let token2 = generate_ephemeral_token();
        assert!(!token1.is_empty());
        assert!(!token2.is_empty());
        assert_ne!(token1, token2);
        assert!(token1.len() >= 16);
    }

    #[test]
    fn test_resolve_downloads_folder_custom_preferred() {
        let temp_dir = std::env::temp_dir().join(format!("pdm_test_custom_dl_{}", std::process::id()));
        let custom = temp_dir.join("custom_downloads");
        let sys = temp_dir.join("sys_downloads");
        fs::create_dir_all(&sys).unwrap();

        let resolved = resolve_downloads_folder(Some(custom.clone()), Some(sys.clone()));
        assert_eq!(resolved, Some(custom.clone()));
        assert!(custom.exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_resolve_downloads_folder_fallback_to_system() {
        let temp_dir = std::env::temp_dir().join(format!("pdm_test_fallback_dl_{}", std::process::id()));
        let sys = temp_dir.join("sys_downloads");
        fs::create_dir_all(&sys).unwrap();

        let resolved = resolve_downloads_folder(None, Some(sys.clone()));
        assert_eq!(resolved, Some(sys));

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_resolve_downloads_folder_creates_nonexistent_system_dir() {
        let temp_dir = std::env::temp_dir().join(format!("pdm_test_sys_create_{}", std::process::id()));
        let sys = temp_dir.join("future_system_downloads");
        assert!(!sys.exists());

        let resolved = resolve_downloads_folder(None, Some(sys.clone()));
        assert_eq!(resolved, Some(sys.clone()));
        assert!(sys.exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_cors_preflight_headers_creation() {
        let origin = "chrome-extension://abcdefghijklmnopqrstuvwxyz123456";
        let allow_origin_h = Header::from_bytes(&b"Access-Control-Allow-Origin"[..], origin.as_bytes()).unwrap();
        assert_eq!(allow_origin_h.field.as_str(), "Access-Control-Allow-Origin");
        assert_eq!(allow_origin_h.value.as_str(), origin);

        let allow_methods_h = Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"POST, GET, OPTIONS"[..]).unwrap();
        assert_eq!(allow_methods_h.value.as_str(), "POST, GET, OPTIONS");

        let allow_headers_h = Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Content-Type, X-Custom-Header, *"[..]).unwrap();
        assert_eq!(allow_headers_h.value.as_str(), "Content-Type, X-Custom-Header, *");
    }

    #[test]
    fn test_find_available_port_success() {
        let port = find_available_port(6800, 6820);
        assert!(port.is_some());
        let p = port.unwrap();
        assert!(p >= 6800 && p <= 6820);
    }

    #[test]
    fn test_find_available_port_skips_occupied() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("Failed to bind ephemeral test socket");
        let occupied_port = listener.local_addr().unwrap().port();

        // When probing a range containing only the occupied port, it must return None
        assert_eq!(find_available_port(occupied_port, occupied_port), None);

        // When probing a range where occupied_port is first, it must not return occupied_port
        let found = find_available_port(occupied_port, occupied_port.saturating_add(1));
        assert_ne!(found, Some(occupied_port));

        drop(listener);
        // After dropping the listener, the port becomes available again
        assert_eq!(find_available_port(occupied_port, occupied_port), Some(occupied_port));
    }

    #[test]
    fn test_find_available_port_invalid_range_returns_none() {
        assert_eq!(find_available_port(6820, 6800), None);
    }

    #[test]
    fn test_aria2_config_serialization() {
        let config = Aria2Config {
            port: 6815,
            secret: "test_secret_abc".to_string(),
        };
        let serialized = serde_json::to_string(&config).unwrap();
        assert!(serialized.contains("\"port\":6815"));
        assert!(serialized.contains("\"secret\":\"test_secret_abc\""));

        let deserialized: Aria2Config = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized.port, 6815);
        assert_eq!(deserialized.secret, "test_secret_abc");
    }

    #[test]
    fn test_aria2_error_state_management() {
        let error_state = Aria2ErrorState::default();
        assert!(error_state.0.lock().unwrap().is_none());

        *error_state.0.lock().unwrap() = Some("Aria2 port collision".to_string());
        assert_eq!(error_state.0.lock().unwrap().as_deref(), Some("Aria2 port collision"));
    }

    #[test]
    fn test_get_system_drives() {
        let drives = get_system_drives().expect("get_system_drives should succeed");
        assert!(!drives.is_empty(), "Should return at least one system drive");
        let has_root_or_home = drives.iter().any(|d| d.mount_point == "/" || d.mount_point == "/home" || d.mount_point.starts_with("C:"));
        assert!(has_root_or_home, "Drives should contain root or home partition");
        for drive in &drives {
            assert!(!drive.id.is_empty());
            assert!(!drive.label.is_empty());
            assert!(!drive.mount_point.is_empty());
            assert!(drive.total_space > 0, "Drive total space should be non-zero for {}", drive.mount_point);
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_unescape_hex() {
        assert_eq!(unescape_hex("TOSHIBA\\x20HDWD120"), "TOSHIBA HDWD120");
        assert_eq!(unescape_hex("PlainLabel"), "PlainLabel");
        assert_eq!(unescape_hex("WDC\\x20WDS240G2G0A"), "WDC WDS240G2G0A");
        assert_eq!(unescape_hex("M\\xc3\\xbasica"), "Música");
        assert_eq!(unescape_hex("Donn\\xc3\\xa9es"), "Données");
        assert_eq!(unescape_hex("Invalid\\xZZLabel"), "Invalid\\xZZLabel");
        assert_eq!(unescape_hex("Incomplete\\x"), "Incomplete\\x");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_unescape_proc_mount() {
        assert_eq!(unescape_proc_mount("/mnt/My\\040Drive"), "/mnt/My Drive");
        assert_eq!(unescape_proc_mount("/home"), "/home");
    }
}
