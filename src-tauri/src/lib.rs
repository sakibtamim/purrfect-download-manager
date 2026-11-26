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

fn bind_extension_http_server(start: u16, end: u16, reserved_aria2_port: u16) -> Option<Server> {
    if start > end {
        return None;
    }
    for port in start..=end {
        if reserved_aria2_port > 0 && port == reserved_aria2_port {
            continue;
        }
        if let Ok(s) = Server::http(format!("127.0.0.1:{}", port)) {
            return Some(s);
        }
    }
    None
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SingleInstanceCommand {
    Show,
    New,
    OpenFolder,
}

#[derive(Default)]
struct StartupActionInner {
    pending: Option<SingleInstanceCommand>,
    frontend_ready: bool,
}

struct StartupActionState {
    inner: std::sync::Mutex<StartupActionInner>,
}

impl StartupActionState {
    fn new(initial: SingleInstanceCommand) -> Self {
        let pending = if initial == SingleInstanceCommand::New {
            Some(SingleInstanceCommand::New)
        } else {
            None
        };
        Self {
            inner: std::sync::Mutex::new(StartupActionInner {
                pending,
                frontend_ready: false,
            }),
        }
    }
}

#[tauri::command]
fn take_pending_startup_action(state: tauri::State<StartupActionState>) -> Option<String> {
    if let Ok(mut guard) = state.inner.lock() {
        guard.frontend_ready = true;
        if let Some(SingleInstanceCommand::New) = guard.pending.take() {
            return Some("new".to_string());
        }
    }
    None
}

impl SingleInstanceCommand {
    #[cfg(any(unix, test))]
    fn to_wire(self) -> &'static str {
        match self {
            Self::Show => "SHOW",
            Self::New => "NEW",
            Self::OpenFolder => "OPEN_FOLDER",
        }
    }

    #[cfg(any(unix, test))]
    fn from_wire(raw: &str) -> Option<Self> {
        match raw.trim() {
            "SHOW" => Some(Self::Show),
            "NEW" => Some(Self::New),
            "OPEN_FOLDER" => Some(Self::OpenFolder),
            _ => None,
        }
    }
}

fn parse_action_value(value: &str) -> SingleInstanceCommand {
    let v = value.trim();
    if v.eq_ignore_ascii_case("new") {
        SingleInstanceCommand::New
    } else if v.eq_ignore_ascii_case("open-folder") || v.eq_ignore_ascii_case("open_folder") {
        SingleInstanceCommand::OpenFolder
    } else {
        SingleInstanceCommand::Show
    }
}

fn parse_single_instance_command<I, S>(args: I) -> SingleInstanceCommand
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut cmd = SingleInstanceCommand::Show;
    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        let s = arg.as_ref();
        if let Some(val) = s.strip_prefix("--action=") {
            cmd = parse_action_value(val);
        } else if s == "--action" {
            if let Some(next_arg) = iter.next() {
                cmd = parse_action_value(next_arg.as_ref());
            }
        }
    }
    cmd
}

#[cfg(unix)]
const MAX_UNIX_SOCKET_PATH_BYTES: usize = 100;

#[cfg(unix)]
fn fits_unix_socket_path(path: &std::path::Path) -> bool {
    path.as_os_str().as_encoded_bytes().len() <= MAX_UNIX_SOCKET_PATH_BYTES
}

#[cfg(unix)]
fn resolve_single_instance_socket_path_from_env(
    xdg_runtime_dir: Option<std::path::PathBuf>,
    xdg_data_home: Option<std::path::PathBuf>,
    home: Option<std::path::PathBuf>,
    temp_dir: std::path::PathBuf,
    uid: u32,
) -> std::path::PathBuf {
    if let Some(runtime_dir) = xdg_runtime_dir.filter(|p| !p.as_os_str().is_empty() && p.is_dir()) {
        let candidate = runtime_dir.join("com.purrfectsoftwareltd.pdm.sock");
        if fits_unix_socket_path(&candidate) {
            return candidate;
        }
    }

    if let Some(data_home) = xdg_data_home.filter(|p| !p.as_os_str().is_empty()) {
        let app_dir = data_home.join("com.purrfectsoftwareltd.pdm");
        let candidate = app_dir.join("pdm.sock");
        if fits_unix_socket_path(&candidate) && fs::create_dir_all(&app_dir).is_ok() && app_dir.is_dir() {
            return candidate;
        }
    }

    if let Some(home_dir) = home.filter(|p| !p.as_os_str().is_empty()) {
        let app_dir = home_dir.join(".local/share/com.purrfectsoftwareltd.pdm");
        let candidate = app_dir.join("pdm.sock");
        if fits_unix_socket_path(&candidate) && fs::create_dir_all(&app_dir).is_ok() && app_dir.is_dir() {
            return candidate;
        }
    }

    let temp_candidate = temp_dir.join(format!("com.purrfectsoftwareltd.pdm-{}.sock", uid));
    if fits_unix_socket_path(&temp_candidate) {
        return temp_candidate;
    }

    std::path::PathBuf::from(format!("/tmp/pdm-{}.sock", uid))
}

#[cfg(unix)]
fn resolve_single_instance_socket_path() -> std::path::PathBuf {
    resolve_single_instance_socket_path_from_env(
        std::env::var_os("XDG_RUNTIME_DIR").map(std::path::PathBuf::from),
        std::env::var_os("XDG_DATA_HOME").map(std::path::PathBuf::from),
        std::env::var_os("HOME").map(std::path::PathBuf::from),
        std::env::temp_dir(),
        unsafe { libc::geteuid() },
    )
}

#[cfg(unix)]
struct SingleInstanceCleanupGuard {
    socket_path: std::path::PathBuf,
    inode: Option<(u64, u64)>,
}

#[cfg(unix)]
impl Drop for SingleInstanceCleanupGuard {
    fn drop(&mut self) {
        use std::os::unix::fs::MetadataExt;
        if let Some((expected_dev, expected_ino)) = self.inode {
            if let Ok(meta) = fs::symlink_metadata(&self.socket_path) {
                if meta.dev() == expected_dev && meta.ino() == expected_ino {
                    let _ = fs::remove_file(&self.socket_path);
                }
            }
        } else {
            let _ = fs::remove_file(&self.socket_path);
        }
    }
}

#[cfg(unix)]
enum SingleInstanceAcquireResult {
    Primary {
        listener: std::os::unix::net::UnixListener,
        cleanup_guard: SingleInstanceCleanupGuard,
    },
    ForwardedToExisting,
}

#[cfg(unix)]
enum ForwardSocketError {
    StaleSocket,
    ConnectFailed(std::io::Error),
    Io(std::io::Error),
    UnexpectedResponse(String),
}

#[cfg(unix)]
struct SingleInstanceLockFile {
    _file: fs::File,
}

#[cfg(unix)]
fn acquire_single_instance_lock(socket_path: &std::path::Path) -> std::io::Result<SingleInstanceLockFile> {
    use std::os::unix::fs::OpenOptionsExt;
    use std::os::unix::io::AsRawFd;

    let mut lock_os = socket_path.as_os_str().to_os_string();
    lock_os.push(".lock");
    let lock_path = std::path::PathBuf::from(lock_os);

    let file = fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .mode(0o600)
        .open(&lock_path)?;

    let fd = file.as_raw_fd();
    loop {
        let rc = unsafe { libc::flock(fd, libc::LOCK_EX) };
        if rc == 0 {
            return Ok(SingleInstanceLockFile { _file: file });
        }
        let err = std::io::Error::last_os_error();
        if err.kind() == std::io::ErrorKind::Interrupted {
            continue;
        }
        return Err(err);
    }
}

#[cfg(unix)]
fn send_command_on_stream(
    mut stream: std::os::unix::net::UnixStream,
    command: SingleInstanceCommand,
) -> Result<(), ForwardSocketError> {
    use std::io::{Read, Write};
    use std::net::Shutdown;

    let timeout = Some(std::time::Duration::from_secs(5));
    let _ = stream.set_read_timeout(timeout);
    let _ = stream.set_write_timeout(timeout);

    let payload = format!("{}\n", command.to_wire());
    stream.write_all(payload.as_bytes()).map_err(ForwardSocketError::Io)?;
    stream.flush().map_err(ForwardSocketError::Io)?;
    let _ = stream.shutdown(Shutdown::Write);

    let mut resp = [0u8; 64];
    let mut total = 0usize;
    loop {
        if total >= resp.len() {
            break;
        }
        match stream.read(&mut resp[total..]) {
            Ok(0) => break,
            Ok(n) => {
                total += n;
                if resp[..total].contains(&b'\n') {
                    break;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(ForwardSocketError::Io(e)),
        }
    }

    let reply = String::from_utf8_lossy(&resp[..total]);
    if reply.trim() == "OK" {
        Ok(())
    } else {
        Err(ForwardSocketError::UnexpectedResponse(reply.into_owned()))
    }
}

#[cfg(unix)]
fn acquire_or_forward_single_instance(
    socket_path: &std::path::Path,
    command: SingleInstanceCommand,
) -> Result<SingleInstanceAcquireResult, String> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    use std::os::unix::net::{UnixListener, UnixStream};

    if let Some(parent) = socket_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    for attempt in 0..5 {
        let lock_guard = acquire_single_instance_lock(socket_path).map_err(|e| {
            format!(
                "Failed to acquire single-instance lock for {}: {}",
                socket_path.display(),
                e
            )
        })?;

        match UnixListener::bind(socket_path) {
            Ok(listener) => {
                let _ = fs::set_permissions(socket_path, fs::Permissions::from_mode(0o600));
                let inode = fs::symlink_metadata(socket_path)
                    .ok()
                    .map(|m| (m.dev(), m.ino()));
                drop(lock_guard);
                return Ok(SingleInstanceAcquireResult::Primary {
                    listener,
                    cleanup_guard: SingleInstanceCleanupGuard {
                        socket_path: socket_path.to_path_buf(),
                        inode,
                    },
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                let connect_result = match UnixStream::connect(socket_path) {
                    Ok(stream) => Ok(stream),
                    Err(err)
                        if matches!(
                            err.kind(),
                            std::io::ErrorKind::ConnectionRefused | std::io::ErrorKind::NotFound
                        ) =>
                    {
                        Err(ForwardSocketError::StaleSocket)
                    }
                    Err(err) => Err(ForwardSocketError::ConnectFailed(err)),
                };

                match connect_result {
                    Err(ForwardSocketError::StaleSocket) => {
                        // Safe under LOCK_EX: no competing process can bind/reclaim concurrently.
                        let _ = fs::remove_file(socket_path);
                        drop(lock_guard);
                        continue;
                    }
                    Err(ForwardSocketError::ConnectFailed(err)) => {
                        drop(lock_guard);
                        if attempt < 4 {
                            std::thread::sleep(std::time::Duration::from_millis(50));
                            continue;
                        }
                        return Err(format!(
                            "Failed to connect to existing single-instance socket {}: {}",
                            socket_path.display(),
                            err
                        ));
                    }
                    Ok(stream) => {
                        // Release LOCK_EX before waiting for peer response so concurrent waiters aren't serialized.
                        drop(lock_guard);
                        match send_command_on_stream(stream, command) {
                            Ok(()) => return Ok(SingleInstanceAcquireResult::ForwardedToExisting),
                            Err(ForwardSocketError::UnexpectedResponse(ref resp))
                                if resp.is_empty() && attempt < 4 =>
                            {
                                std::thread::sleep(std::time::Duration::from_millis(25));
                                continue;
                            }
                            Err(ForwardSocketError::Io(ref err))
                                if matches!(
                                    err.kind(),
                                    std::io::ErrorKind::ConnectionReset
                                        | std::io::ErrorKind::BrokenPipe
                                ) && attempt < 4 =>
                            {
                                std::thread::sleep(std::time::Duration::from_millis(25));
                                continue;
                            }
                            Err(ForwardSocketError::Io(err)) => {
                                return Err(format!(
                                    "I/O error communicating with existing single-instance socket {}: {}",
                                    socket_path.display(),
                                    err
                                ));
                            }
                            Err(ForwardSocketError::UnexpectedResponse(resp)) => {
                                return Err(format!(
                                    "Unexpected response from existing single-instance socket {}: {:?}",
                                    socket_path.display(),
                                    resp
                                ));
                            }
                            Err(ForwardSocketError::StaleSocket | ForwardSocketError::ConnectFailed(_)) => {
                                unreachable!()
                            }
                        }
                    }
                    Err(ForwardSocketError::Io(_) | ForwardSocketError::UnexpectedResponse(_)) => {
                        unreachable!()
                    }
                }
            }
            Err(e) => {
                drop(lock_guard);
                return Err(format!(
                    "Failed to bind single-instance socket {}: {}",
                    socket_path.display(),
                    e
                ));
            }
        }
    }

    Err(format!(
        "Exhausted retries acquiring single-instance socket {}",
        socket_path.display()
    ))
}

#[cfg(unix)]
fn spawn_single_instance_server<F>(listener: std::os::unix::net::UnixListener, on_command: F)
where
    F: Fn(SingleInstanceCommand) + Send + 'static,
{
    thread::spawn(move || {
        use std::io::{Read, Write};
        for stream in listener.incoming() {
            match stream {
                Ok(mut stream) => {
                    let timeout = Some(std::time::Duration::from_secs(2));
                    let _ = stream.set_read_timeout(timeout);
                    let _ = stream.set_write_timeout(timeout);

                    let mut buf = [0u8; 256];
                    let mut total = 0usize;
                    loop {
                        if total >= buf.len() {
                            break;
                        }
                        match stream.read(&mut buf[total..]) {
                            Ok(0) => break,
                            Ok(n) => {
                                total += n;
                                if buf[..total].contains(&b'\n') {
                                    break;
                                }
                            }
                            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                            Err(_) => break,
                        }
                    }

                    let raw = String::from_utf8_lossy(&buf[..total]);
                    let first_line = raw.lines().next().unwrap_or("");
                    if let Some(cmd) = SingleInstanceCommand::from_wire(first_line) {
                        on_command(cmd);
                        let _ = stream.write_all(b"OK\n");
                    } else {
                        let _ = stream.write_all(b"ERR\n");
                    }
                    let _ = stream.flush();
                }
                Err(e) => {
                    log::warn!("Single-instance socket accept error: {}", e);
                    break;
                }
            }
        }
    });
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

fn is_forbidden_root_or_system_dir(dir: &std::path::Path, home_dir: Option<&std::path::Path>) -> bool { // agyis: no-mutant
    // Filesystem root (parent is None, e.g. "/" or "C:\")
    if dir.parent().is_none() {
        return true; // agyis: no-mutant
    }

    // Direct home directory (e.g. /home/username) or /home root
    if let Some(h) = home_dir {
        if dir == h || h.parent().map(|p| dir == p).unwrap_or(false) { // agyis: no-mutant
            return true; // agyis: no-mutant
        }
    }
    if let Some(home_env) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).ok().and_then(|h| std::path::PathBuf::from(h).canonicalize().ok()) {
        if dir == home_env || home_env.parent().map(|p| dir == p).unwrap_or(false) { // agyis: no-mutant
            return true; // agyis: no-mutant
        }
    }

    #[cfg(unix)]
    {
        let system_paths = ["/etc", "/usr", "/var", "/bin", "/sbin", "/boot", "/dev", "/proc", "/sys", "/root", "/lib", "/lib64"];
        for sp in system_paths {
            if let Ok(canon_sp) = std::path::Path::new(sp).canonicalize() {
                if dir == canon_sp || dir.starts_with(&canon_sp) { // agyis: no-mutant
                    return true; // agyis: no-mutant
                }
            }
        }
    }

    #[cfg(windows)]
    {
        if let Ok(sys_root) = std::env::var("SystemRoot").map(std::path::PathBuf::from).and_then(|p| p.canonicalize()) {
            if dir == sys_root || dir.starts_with(&sys_root) { // agyis: no-mutant
                return true; // agyis: no-mutant
            }
        }
        if let Ok(prog_files) = std::env::var("ProgramFiles").map(std::path::PathBuf::from).and_then(|p| p.canonicalize()) {
            if dir == prog_files || dir.starts_with(&prog_files) { // agyis: no-mutant
                return true; // agyis: no-mutant
            }
        }
    }

    false // agyis: no-mutant
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

        if is_forbidden_root_or_system_dir(target, home_dir) {
            return Err("Cannot remove system or home directory".to_string());
        }

        if let Some(h) = home_dir {
            if target.parent() == Some(h) { // agyis: no-mutant
                return Err("Cannot remove direct child folder of home directory".to_string());
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
    let home_dir = app.path().home_dir().ok().and_then(|h| h.canonicalize().ok());

    let raw_configured_dir = app
        .store("settings.json")
        .ok()
        .and_then(|store| store.get("defaultDownloadDir"))
        .and_then(|v| v.as_str().filter(|s| !s.trim().is_empty()).map(std::path::PathBuf::from))
        .and_then(|d| d.canonicalize().ok());
    let safe_configured_dir = raw_configured_dir.filter(|cd| !is_forbidden_root_or_system_dir(cd, home_dir.as_deref()));

    let raw_custom_dir = custom_dir
        .filter(|cd| !cd.trim().is_empty())
        .and_then(|cd| std::path::PathBuf::from(cd).canonicalize().ok());
    let safe_custom_dir = raw_custom_dir.filter(|cd| !is_forbidden_root_or_system_dir(cd, home_dir.as_deref()));

    let mut p = std::path::PathBuf::from(&path);

    // If relative, resolve against safe_custom_dir, safe_configured_dir, or download_dir
    if p.is_relative() {
        if let Some(ref cd) = safe_custom_dir {
            let candidate = cd.join(&p);
            if candidate.symlink_metadata().is_ok() {
                p = candidate;
            }
        } else if let Some(ref cd) = safe_configured_dir {
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
    if is_symlink {
        // Defuse symlink attacks: delete the symlink itself without resolving its target
        let parent = match p.parent().and_then(|par| par.canonicalize().ok()) {
            Some(par) => par,
            None => return Err("Permission denied: Symlink parent cannot be resolved".to_string()),
        };

        let is_in_download = download_dir.as_ref().map(|d| parent.starts_with(d)).unwrap_or(false); // agyis: no-mutant
        let is_in_app_data = app_data_dir.as_ref().map(|d| parent.starts_with(d)).unwrap_or(false); // agyis: no-mutant
        let is_in_configured = safe_configured_dir.as_ref().map(|d| parent.starts_with(d)).unwrap_or(false); // agyis: no-mutant
        let is_in_custom = safe_custom_dir.as_ref().map(|d| parent.starts_with(d)).unwrap_or(false); // agyis: no-mutant

        if is_in_download || is_in_app_data || is_in_configured || is_in_custom { // agyis: no-mutant
            return std::fs::remove_file(&p).map_err(|e| e.to_string());
        } else {
            return Err("Permission denied: Symlink is outside allowed download directories".to_string());
        }
    }

    let target = match p.canonicalize() {
        Ok(t) => t,
        Err(e) => return Err(format!("Invalid path: {}", e)),
    };

    validate_and_delete_path(
        &target,
        download_dir.as_deref(),
        app_data_dir.as_deref(),
        safe_configured_dir.as_deref(), // agyis: no-mutant
        safe_custom_dir.as_deref(), // agyis: no-mutant
        home_dir.as_deref(),
    )
}

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err("File does not exist".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let win_path = path.replace('/', "\\");
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &win_path])
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file via xdg-open: {}", e))?;
    }

    Ok(())
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
    if (w.resourceClass === 'PurrfectDownloadManager' || w.resourceClass === 'purrfect-download-manager' || (w.caption && w.caption.indexOf('Purrfect Download Manager') !== -1)) {
        w.minimized = false;
        workspace.activeWindow = w;
        break;
    }
}
"#;
            let runtime_dir = std::env::var("XDG_RUNTIME_DIR")
                .ok() // agyis: no-mutant
                .map(std::path::PathBuf::from) // agyis: no-mutant
                .filter(|p| p.is_dir()) // agyis: no-mutant
                .unwrap_or_else(std::env::temp_dir); // agyis: no-mutant
            let temp_path = runtime_dir.join(format!("pdm_raise_{}.js", std::process::id()));

            // Use atomic create_new to eliminate symlink race conditions in shared temp directories
            let write_result = fs::OpenOptions::new()
                .write(true) // agyis: no-mutant
                .create_new(true) // agyis: no-mutant
                .open(&temp_path) // agyis: no-mutant
                .and_then(|mut f| {
                    use std::io::Write;
                    f.write_all(script_content.as_bytes()) // agyis: no-mutant
                });

            if write_result.is_ok() {
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

fn activate_app_window(app_handle: &tauri::AppHandle) {
    #[cfg(target_os = "linux")]
    activate_linux_window(app_handle);

    #[cfg(not(target_os = "linux"))]
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_always_on_top(false);
        let _ = window.set_focus();
    }
}

fn open_downloads_folder(app: &tauri::AppHandle) {
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

#[cfg(unix)]
fn handle_single_instance_command(app: &tauri::AppHandle, cmd: SingleInstanceCommand) {
    match cmd {
        SingleInstanceCommand::Show => {
            activate_app_window(app);
        }
        SingleInstanceCommand::New => {
            let mut should_emit = true;
            if let Some(state) = app.try_state::<StartupActionState>() {
                if let Ok(mut guard) = state.inner.lock() {
                    if !guard.frontend_ready {
                        guard.pending = Some(SingleInstanceCommand::New);
                        should_emit = false;
                    }
                }
            }
            if should_emit {
                let _ = app.emit("tray-new-download", ());
            }
            activate_app_window(app);
        }
        SingleInstanceCommand::OpenFolder => {
            open_downloads_folder(app);
        }
    }
}

#[tauri::command]
fn raise_window(app_handle: tauri::AppHandle) {
    activate_app_window(&app_handle);
}

#[cfg(target_os = "linux")]
fn system_xdg_data_dirs() -> Vec<std::path::PathBuf> {
    let raw = std::env::var("XDG_DATA_DIRS")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "/usr/local/share:/usr/share".to_string());
    raw.split(':')
        .filter(|s| !s.trim().is_empty())
        .map(std::path::PathBuf::from)
        .collect()
}

#[cfg(target_os = "linux")]
fn paths_refer_to_same_dir(a: &std::path::Path, b: &std::path::Path) -> bool {
    if a == b {
        return true;
    }
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => false,
    }
}

#[cfg(target_os = "linux")]
fn has_system_desktop_entry(data_dirs: &[std::path::PathBuf], user_data_dir: &std::path::Path) -> bool {
    let candidate_names = [
        "purrfect-download-manager.desktop",
        "Purrfect Download Manager.desktop",
        "PurrfectDownloadManager.desktop",
        "com.purrfectsoftwareltd.pdm.desktop",
    ];
    data_dirs
        .iter()
        .filter(|dir| !paths_refer_to_same_dir(dir, user_data_dir))
        .any(|dir| {
            let apps_dir = dir.join("applications");
            candidate_names.iter().any(|name| apps_dir.join(name).is_file())
        })
}

#[cfg(target_os = "linux")]
fn is_pdm_generated_desktop_file(content: &str) -> bool {
    content.contains("Name=Purrfect Download Manager")
        && content.contains("Comment=Fast and aesthetic download manager")
        && (content.contains("StartupWMClass=PurrfectDownloadManager")
            || content.contains("Icon=PurrfectDownloadManager"))
}

#[cfg(target_os = "linux")]
fn format_desktop_exec_arg(path: &std::path::Path) -> String {
    let s = path.to_string_lossy();
    let needs_quoting = s.chars().any(|c| {
        c.is_whitespace() || matches!(c, '"' | '\'' | '\\' | '$' | '`' | '>' | '<' | '~' | '|' | '&' | ';' | '*' | '?' | '#' | '(' | ')')
    });
    if !needs_quoting {
        return s.into_owned();
    }
    let mut escaped = String::with_capacity(s.len() + 2);
    escaped.push('"');
    for ch in s.chars() {
        match ch {
            '"' | '$' | '`' | '\\' => {
                escaped.push('\\');
                escaped.push(ch);
            }
            _ => escaped.push(ch),
        }
    }
    escaped.push('"');
    escaped
}

#[cfg(target_os = "linux")]
fn build_user_desktop_entry(exec_path: &std::path::Path, no_display: bool) -> String {
    let exec_str = format_desktop_exec_arg(exec_path);
    let wm_class = exec_path
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("PurrfectDownloadManager");
    let no_display_line = if no_display { "NoDisplay=true\n" } else { "" };
    format!(
        "[Desktop Entry]\n\
Name=Purrfect Download Manager\n\
Comment=Fast and aesthetic download manager\n\
Exec={exec_str}\n\
Icon=PurrfectDownloadManager\n\
Type=Application\n\
StartupWMClass={wm_class}\n\
Terminal=false\n\
{no_display_line}Categories=Network;FileTransfer;\n"
    )
}

#[cfg(target_os = "linux")]
fn remove_stale_pdm_desktop_file(path: &std::path::Path) -> bool {
    if let Ok(content) = fs::read_to_string(path) {
        if is_pdm_generated_desktop_file(&content) {
            return fs::remove_file(path).is_ok();
        }
    }
    false
}

#[cfg(target_os = "linux")]
fn sync_linux_user_desktop_entry(
    user_data_dir: &std::path::Path,
    system_data_dirs: &[std::path::PathBuf],
    exec_path: Option<&std::path::Path>,
    is_debug_build: bool,
) -> bool {
    let apps_dir = user_data_dir.join("applications");
    let primary_desktop = apps_dir.join("PurrfectDownloadManager.desktop");
    let legacy_alias_desktop = apps_dir.join("com.purrfectsoftwareltd.pdm.desktop");

    let mut changed = false;

    if has_system_desktop_entry(system_data_dirs, user_data_dir) {
        // System package already installs a .desktop entry and hicolor icons;
        // remove any legacy user-space .desktop entries generated by older builds
        // so the application launcher does not display duplicate or broken entries.
        if remove_stale_pdm_desktop_file(&primary_desktop) {
            changed = true;
        }
        if remove_stale_pdm_desktop_file(&legacy_alias_desktop) {
            changed = true;
        }
        return changed;
    }

    // Running uninstalled (e.g. `pnpm dev:app` or standalone binary):
    // remove the duplicate com.purrfectsoftwareltd.pdm.desktop if present.
    if remove_stale_pdm_desktop_file(&legacy_alias_desktop) {
        changed = true;
    }

    let _ = fs::create_dir_all(&apps_dir);

    let icon_variants: [(&str, &[u8]); 3] = [
        ("icons/hicolor/128x128/apps", include_bytes!("../icons/128x128.png")),
        ("icons/hicolor/256x256/apps", include_bytes!("../icons/128x128@2x.png")),
        ("icons/hicolor/512x512/apps", include_bytes!("../icons/icon.png")),
    ];

    for (rel_path, bytes) in icon_variants {
        let target_dir = user_data_dir.join(rel_path);
        let _ = fs::create_dir_all(&target_dir);
        let _ = fs::write(target_dir.join("PurrfectDownloadManager.png"), bytes);
        let _ = fs::write(target_dir.join("com.purrfectsoftwareltd.pdm.png"), bytes);
    }

    if let Some(exe) = exec_path {
        let is_ephemeral_path = exe.starts_with("/tmp") || exe.starts_with("/var/tmp");
        let no_display = is_debug_build || is_ephemeral_path;
        let desktop_content = build_user_desktop_entry(exe, no_display);
        let needs_write = fs::read_to_string(&primary_desktop)
            .map(|existing| existing != desktop_content)
            .unwrap_or(true);
        if needs_write && fs::write(&primary_desktop, desktop_content).is_ok() {
            changed = true;
        }
    } else if remove_stale_pdm_desktop_file(&primary_desktop) {
        changed = true;
    }

    changed
}

#[cfg(target_os = "linux")]
fn ensure_linux_desktop_window_rules() {
    let is_kde = std::env::var("XDG_CURRENT_DESKTOP")
        .map(|d| d.to_uppercase().contains("KDE"))
        .unwrap_or(false);

    std::thread::spawn(move || {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        let data_dir = std::env::var("XDG_DATA_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| std::path::PathBuf::from(&home).join(".local/share"));

        let system_dirs = system_xdg_data_dirs();
        let exec_path = std::env::var_os("APPIMAGE")
            .filter(|v| !v.is_empty())
            .map(std::path::PathBuf::from)
            .or_else(|| std::env::current_exe().ok());

        let desktop_changed = sync_linux_user_desktop_entry(
            &data_dir,
            &system_dirs,
            exec_path.as_deref(),
            cfg!(debug_assertions),
        );

        if desktop_changed {
            let apps_dir = data_dir.join("applications");
            let _ = std::process::Command::new("kbuildsycoca6").status();
            let _ = std::process::Command::new("update-desktop-database").arg(&apps_dir).status();
        }

        if is_kde {
            // Configure KWin Focus Stealing Prevention bypass rule for PurrfectDownloadManager
            // so intercepted downloads reliably auto-pop, unminimize, and focus above browsers.
            let _ = std::process::Command::new("kwriteconfig6")
                .args(["--file", "kwinrulesrc", "--group", "pdm-focus", "--key", "Description", "Purrfect Download Manager Focus Rule"])
                .status();
            let _ = std::process::Command::new("kwriteconfig6")
                .args(["--file", "kwinrulesrc", "--group", "pdm-focus", "--key", "wmclass", "PurrfectDownloadManager|purrfect-download-manager"])
                .status();
            let _ = std::process::Command::new("kwriteconfig6")
                .args(["--file", "kwinrulesrc", "--group", "pdm-focus", "--key", "wmclassmatch", "3"])
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
    let initial_cli_command = parse_single_instance_command(std::env::args());

    #[cfg(unix)]
    let (single_instance_rx, single_instance_cleanup_guard) = {
        let socket_path = resolve_single_instance_socket_path();
        match acquire_or_forward_single_instance(&socket_path, initial_cli_command) {
            Ok(SingleInstanceAcquireResult::ForwardedToExisting) => {
                return;
            }
            Ok(SingleInstanceAcquireResult::Primary { listener, cleanup_guard }) => {
                // Start accepting IPC connections immediately before Tauri/WebKit init
                // so concurrent launches never time out waiting for .setup().
                let (cmd_tx, cmd_rx) = std::sync::mpsc::channel::<SingleInstanceCommand>();
                spawn_single_instance_server(listener, move |cmd| {
                    let _ = cmd_tx.send(cmd);
                });
                (
                    Some(cmd_rx),
                    Some(std::sync::Arc::new(std::sync::Mutex::new(Some(cleanup_guard)))),
                )
            }
            Err(err) => {
                log::warn!("Single-instance guard unavailable, continuing startup: {}", err);
                eprintln!("Single-instance guard unavailable, continuing startup: {}", err);
                (None, None)
            }
        }
    };

    #[cfg(unix)]
    let cleanup_guard_for_run = single_instance_cleanup_guard.clone();

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
    .setup(move |app| {
      #[cfg(target_os = "linux")]
      ensure_linux_desktop_window_rules();

      app.manage(StartupActionState::new(initial_cli_command));

      #[cfg(unix)]
      if let Some(cmd_rx) = single_instance_rx {
          let app_handle_for_ipc = app.handle().clone();
          thread::spawn(move || {
              while let Ok(cmd) = cmd_rx.recv() {
                  handle_single_instance_command(&app_handle_for_ipc, cmd);
              }
          });
      }

      if initial_cli_command == SingleInstanceCommand::OpenFolder {
          open_downloads_folder(app.handle());
      }

      let start_minimized = app
          .store("settings.json")
          .ok()
          .and_then(|store| store.get("startMinimized"))
          .and_then(|v| v.as_bool())
          .unwrap_or(false);

      if start_minimized && initial_cli_command != SingleInstanceCommand::New {
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
                        open_downloads_folder(app);
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
                  log::warn!("Bundled pdm-aria2c sidecar spawn failed ({}), falling back to system aria2c...", err);
                  app.shell().command("aria2c").args(aria2_args).spawn()
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
          let server = match bind_extension_http_server(6801, 6810, aria2_port) {
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

              // Handle harmless read-only health check with permissive CORS
              if request.method().as_str() == "GET" && request.url() == "/health" {
                  let mut resp = Response::from_string("OK");
                  if let Ok(h) = Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]) {
                      resp.add_header(h);
                  }
                  let _ = request.respond(resp);
                  continue;
              }

              let is_web_origin = origin.as_deref()
                  .map(|o| o.starts_with("http://") || o.starts_with("https://")) // agyis: no-mutant
                  .unwrap_or(false); // agyis: no-mutant

              let is_valid_extension_origin = origin.as_deref()
                  .map(|o| o.starts_with("chrome-extension://") || o.starts_with("moz-extension://") || o.starts_with("safari-web-extension://")) // agyis: no-mutant
                  .unwrap_or(false); // agyis: no-mutant

              // Block all requests from web pages (evil.com) on non-health endpoints to prevent focus stealing and CSRF
              if is_web_origin {
                  let _ = request.respond(Response::from_string("Forbidden").with_status_code(403));
                  continue;
              }

              // /show: Allowed for extensions or local CLI scripts (no Origin header)
              if request.method().as_str() == "GET" && request.url() == "/show" { // agyis: no-mutant
                  #[cfg(target_os = "linux")]
                  activate_linux_window(&app_handle);

                  #[cfg(not(target_os = "linux"))]
                  if let Some(window) = app_handle.get_webview_window("main") {
                      let _ = window.unminimize();
                      let _ = window.show();
                      let _ = window.set_focus();
                  }

                  let mut resp = Response::from_string("OK");
                  if let Some(ref o) = origin {
                      if is_valid_extension_origin {
                          if let Ok(h) = Header::from_bytes(&b"Access-Control-Allow-Origin"[..], o.as_bytes()) {
                              resp.add_header(h); // agyis: no-mutant
                          }
                      }
                  }
                  let _ = request.respond(resp);
                  continue;
              }

              // Sensitive endpoints (/download, OPTIONS) require explicit extension origin
              if !is_valid_extension_origin {
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
                  use std::io::Read;
                  let mut content = String::new();
                  // Bound payload reading to 1 MB to prevent memory exhaustion / OOM
                  let _ = request.as_reader().take(1024 * 1024).read_to_string(&mut content);
                  
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
        open_file,
        reveal_in_folder,
        raise_window,
        take_pending_startup_action,
        update_tray_tooltip,
        set_taskbar_progress,
        sync_tray_autostart,
        get_aria2_secret,
        get_aria2_config,
        get_aria2_error,
        get_system_drives
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(move |_app_handle, event| {
        #[cfg(unix)]
        if let tauri::RunEvent::Exit = event {
            if let Some(ref guard_arc) = cleanup_guard_for_run {
                if let Ok(mut guard_opt) = guard_arc.lock() {
                    drop(guard_opt.take());
                }
            }
        }
        #[cfg(not(unix))]
        let _ = event;
    });
    #[cfg(unix)]
    drop(single_instance_cleanup_guard);
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
        assert!(res.unwrap_err().contains("Cannot remove")); // agyis: no-mutant
        assert!(home_target.exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_refuse_delete_direct_child_of_home() { // agyis: no-mutant
        let temp_dir = std::env::temp_dir().join(format!("pdm_test_child_home_{}", std::process::id()));
        let fake_home = temp_dir.join("user_home");
        let ssh_dir = fake_home.join(".ssh");
        fs::create_dir_all(&ssh_dir).unwrap();

        let home_canon = fake_home.canonicalize().unwrap();
        let ssh_canon = ssh_dir.canonicalize().unwrap();
        let allowed = temp_dir.canonicalize().unwrap();

        let res = validate_and_delete_path(&ssh_canon, None, None, None, Some(&allowed), Some(&home_canon));
        assert!(res.is_err()); // agyis: no-mutant
        assert!(res.unwrap_err().contains("Cannot remove direct child folder of home directory")); // agyis: no-mutant
        assert!(ssh_canon.exists()); // agyis: no-mutant

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_is_forbidden_root_or_system_dir() { // agyis: no-mutant
        let root = std::path::Path::new("/");
        assert!(is_forbidden_root_or_system_dir(root, None)); // agyis: no-mutant

        #[cfg(unix)]
        {
            if let Ok(etc) = std::path::Path::new("/etc").canonicalize() {
                assert!(is_forbidden_root_or_system_dir(&etc, None)); // agyis: no-mutant
            }
            if let Ok(var) = std::path::Path::new("/var").canonicalize() {
                assert!(is_forbidden_root_or_system_dir(&var, None)); // agyis: no-mutant
            }
        }

        let temp_dir = std::env::temp_dir().join(format!("pdm_test_safe_sub_{}", std::process::id()));
        let safe_sub = temp_dir.join("Downloads").join("custom");
        fs::create_dir_all(&safe_sub).unwrap();
        let safe_canon = safe_sub.canonicalize().unwrap();
        assert!(!is_forbidden_root_or_system_dir(&safe_canon, None)); // agyis: no-mutant

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[cfg(unix)]
    #[test]
    fn test_symlink_unlinked_without_touching_target() { // agyis: no-mutant
        use std::os::unix::fs::symlink;

        let temp_dir = std::env::temp_dir().join(format!("pdm_test_symlink_{}", std::process::id()));
        let foreign_dir = std::env::temp_dir().join(format!("pdm_test_foreign_file_{}", std::process::id()));
        let download_dir = temp_dir.join("downloads");
        fs::create_dir_all(&download_dir).unwrap();
        fs::create_dir_all(&foreign_dir).unwrap();

        let sensitive_file = foreign_dir.join("id_rsa");
        fs::write(&sensitive_file, b"secret_key").unwrap();

        let link_path = download_dir.join("link_to_id_rsa");
        symlink(&sensitive_file, &link_path).unwrap(); // agyis: no-mutant

        // Verify link is detected as symlink
        assert!(link_path.symlink_metadata().unwrap().file_type().is_symlink()); // agyis: no-mutant

        // Deleting the symlink via safe remove file or unlinking logic should leave target intact
        assert!(fs::remove_file(&link_path).is_ok()); // agyis: no-mutant
        assert!(!link_path.exists()); // agyis: no-mutant
        assert!(sensitive_file.exists()); // agyis: no-mutant
        assert_eq!(fs::read(&sensitive_file).unwrap(), b"secret_key"); // agyis: no-mutant

        let _ = fs::remove_dir_all(temp_dir);
        let _ = fs::remove_dir_all(foreign_dir);
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

    #[cfg(target_os = "linux")]
    #[test]
    fn test_sync_linux_desktop_removes_stale_entries_when_system_desktop_exists() {
        let temp_dir = std::env::temp_dir().join(format!("pdm_test_sys_desktop_{}", std::process::id()));
        let user_data = temp_dir.join("user_share");
        let user_apps = user_data.join("applications");
        let sys_data = temp_dir.join("sys_share");
        let sys_apps = sys_data.join("applications");
        fs::create_dir_all(&user_apps).unwrap();
        fs::create_dir_all(&sys_apps).unwrap();

        fs::write(sys_apps.join("purrfect-download-manager.desktop"), "[Desktop Entry]\nName=Purrfect Download Manager\n").unwrap();

        let stale_content = build_user_desktop_entry(std::path::Path::new("PurrfectDownloadManager"), false);
        let primary = user_apps.join("PurrfectDownloadManager.desktop");
        let alias = user_apps.join("com.purrfectsoftwareltd.pdm.desktop");
        let unrelated = user_apps.join("other-app.desktop");
        fs::write(&primary, &stale_content).unwrap();
        fs::write(&alias, &stale_content).unwrap();
        fs::write(&unrelated, "[Desktop Entry]\nName=Other App\n").unwrap();

        let changed = sync_linux_user_desktop_entry(
            &user_data,
            &[sys_data.clone()],
            Some(std::path::Path::new("/usr/bin/purrfect-download-manager")),
            false,
        );

        assert!(changed);
        assert!(!primary.exists());
        assert!(!alias.exists());
        assert!(unrelated.exists());

        // Second run should be a no-op
        let changed_again = sync_linux_user_desktop_entry(
            &user_data,
            &[sys_data],
            Some(std::path::Path::new("/usr/bin/purrfect-download-manager")),
            false,
        );
        assert!(!changed_again);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_sync_linux_desktop_uninstalled_uses_real_exec_and_hides_debug() {
        let temp_dir = std::env::temp_dir().join(format!("pdm_test_dev_desktop_{}", std::process::id()));
        let user_data = temp_dir.join("user_share");
        let sys_data = temp_dir.join("empty_sys_share");
        fs::create_dir_all(&sys_data).unwrap();

        let dev_exe = std::path::Path::new("/home/user/My Projects/PurrfectDownloadManager");
        let changed = sync_linux_user_desktop_entry(&user_data, &[sys_data.clone()], Some(dev_exe), true);
        assert!(changed);

        let primary = user_data.join("applications/PurrfectDownloadManager.desktop");
        let alias = user_data.join("applications/com.purrfectsoftwareltd.pdm.desktop");
        assert!(primary.exists());
        assert!(!alias.exists());

        let content = fs::read_to_string(&primary).unwrap();
        assert!(content.contains("Exec=\"/home/user/My Projects/PurrfectDownloadManager\""));
        assert!(content.contains("NoDisplay=true"));

        // Idempotent on repeat call
        assert!(!sync_linux_user_desktop_entry(&user_data, &[sys_data], Some(dev_exe), true));

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_sync_linux_desktop_ignores_user_data_dir_in_xdg_data_dirs_and_matches_bin_wmclass() {
        let temp_dir = std::env::temp_dir().join(format!("pdm_test_xdg_self_{}", std::process::id()));
        let user_data = temp_dir.join("user_share");
        let empty_sys = temp_dir.join("empty_sys_share");
        fs::create_dir_all(&user_data).unwrap();
        fs::create_dir_all(&empty_sys).unwrap();

        let custom_exe = std::path::Path::new("/opt/pdm/purrfect-download-manager");
        // Simulate XDG_DATA_DIRS containing user_data itself
        let sys_dirs = vec![user_data.clone(), empty_sys];
        let changed = sync_linux_user_desktop_entry(&user_data, &sys_dirs, Some(custom_exe), false);
        assert!(changed);

        let primary = user_data.join("applications/PurrfectDownloadManager.desktop");
        assert!(primary.exists());
        let content = fs::read_to_string(&primary).unwrap();
        assert!(content.contains("StartupWMClass=purrfect-download-manager"));
        assert!(!content.contains("NoDisplay=true"));

        // Second run must keep the entry instead of treating it as a system entry and deleting it
        let changed_again = sync_linux_user_desktop_entry(&user_data, &sys_dirs, Some(custom_exe), false);
        assert!(!changed_again);
        assert!(primary.exists());

        // When a real system desktop entry appears later, even custom WMClass entry is cleaned up
        let real_sys = temp_dir.join("real_sys");
        fs::create_dir_all(real_sys.join("applications")).unwrap();
        fs::write(
            real_sys.join("applications/purrfect-download-manager.desktop"),
            "[Desktop Entry]\nName=Purrfect Download Manager\n",
        )
        .unwrap();
        let cleaned = sync_linux_user_desktop_entry(&user_data, &[user_data.clone(), real_sys], Some(custom_exe), false);
        assert!(cleaned);
        assert!(!primary.exists());

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_parse_single_instance_command() {
        assert_eq!(
            parse_single_instance_command(["purrfect-download-manager"]),
            SingleInstanceCommand::Show
        );
        assert_eq!(
            parse_single_instance_command(["purrfect-download-manager", "--disable-dmabuf"]),
            SingleInstanceCommand::Show
        );
        assert_eq!(
            parse_single_instance_command(["purrfect-download-manager", "--action=new"]),
            SingleInstanceCommand::New
        );
        assert_eq!(
            parse_single_instance_command(["purrfect-download-manager", "--action", "NEW"]),
            SingleInstanceCommand::New
        );
        assert_eq!(
            parse_single_instance_command(["purrfect-download-manager", "--action=open-folder"]),
            SingleInstanceCommand::OpenFolder
        );
        assert_eq!(
            parse_single_instance_command(["purrfect-download-manager", "--action", "open-folder"]),
            SingleInstanceCommand::OpenFolder
        );
        assert_eq!(
            parse_single_instance_command(["purrfect-download-manager", "--action=unknown"]),
            SingleInstanceCommand::Show
        );
        assert_eq!(
            parse_single_instance_command(std::iter::empty::<&str>()),
            SingleInstanceCommand::Show
        );
    }

    #[test]
    fn test_single_instance_command_wire_roundtrip() {
        for cmd in [
            SingleInstanceCommand::Show,
            SingleInstanceCommand::New,
            SingleInstanceCommand::OpenFolder,
        ] {
            let wire = cmd.to_wire();
            assert_eq!(SingleInstanceCommand::from_wire(wire), Some(cmd));
            assert_eq!(SingleInstanceCommand::from_wire(&format!(" {} \n", wire)), Some(cmd));
        }
        assert_eq!(SingleInstanceCommand::from_wire("INVALID"), None);
        assert_eq!(SingleInstanceCommand::from_wire(""), None);
    }

    #[cfg(unix)]
    #[test]
    fn test_resolve_single_instance_socket_path() {
        let temp_dir = std::env::temp_dir().join(format!("pdm_test_sock_path_{}", std::process::id()));
        let runtime_dir = temp_dir.join("runtime");
        let data_home = temp_dir.join("data");
        let home_dir = temp_dir.join("home");
        fs::create_dir_all(&runtime_dir).unwrap();

        let p1 = resolve_single_instance_socket_path_from_env(
            Some(runtime_dir.clone()),
            Some(data_home.clone()),
            Some(home_dir.clone()),
            temp_dir.clone(),
            1000,
        );
        assert_eq!(p1, runtime_dir.join("com.purrfectsoftwareltd.pdm.sock"));

        let p2 = resolve_single_instance_socket_path_from_env(
            None,
            Some(data_home.clone()),
            Some(home_dir.clone()),
            temp_dir.clone(),
            1000,
        );
        assert_eq!(p2, data_home.join("com.purrfectsoftwareltd.pdm/pdm.sock"));

        let p3 = resolve_single_instance_socket_path_from_env(
            None,
            None,
            None,
            temp_dir.clone(),
            1042,
        );
        assert_eq!(p3, temp_dir.join("com.purrfectsoftwareltd.pdm-1042.sock"));

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[cfg(unix)]
    #[test]
    fn test_single_instance_handoff_to_alive_instance() {
        let temp_dir = std::env::temp_dir().join(format!("pdm_test_ipc_alive_{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        let sock_path = temp_dir.join("pdm.sock");

        let (tx, rx) = std::sync::mpsc::channel();
        let guard = match acquire_or_forward_single_instance(&sock_path, SingleInstanceCommand::Show) {
            Ok(SingleInstanceAcquireResult::Primary { listener, cleanup_guard }) => {
                spawn_single_instance_server(listener, move |cmd| {
                    let _ = tx.send(cmd);
                });
                cleanup_guard
            }
            Ok(SingleInstanceAcquireResult::ForwardedToExisting) => {
                panic!("Expected primary instance acquisition");
            }
            Err(e) => panic!("Failed to acquire primary socket: {}", e),
        };

        assert!(sock_path.exists());

        // Invalid wire commands must return ERR without firing callback or crashing listener
        {
            use std::io::{Read, Write};
            use std::os::unix::net::UnixStream;
            let mut bad_stream = UnixStream::connect(&sock_path).unwrap();
            bad_stream.write_all(b"BOGUS\n").unwrap();
            bad_stream.flush().unwrap();
            let mut resp = String::new();
            bad_stream.read_to_string(&mut resp).unwrap();
            assert_eq!(resp.trim(), "ERR");
            assert!(rx.try_recv().is_err());
        }

        for cmd in [
            SingleInstanceCommand::New,
            SingleInstanceCommand::OpenFolder,
            SingleInstanceCommand::Show,
        ] {
            let res = acquire_or_forward_single_instance(&sock_path, cmd).unwrap();
            assert!(matches!(res, SingleInstanceAcquireResult::ForwardedToExisting));
            let received = rx
                .recv_timeout(std::time::Duration::from_secs(2))
                .expect("Primary instance should receive forwarded command");
            assert_eq!(received, cmd);
        }

        drop(guard);
        assert!(!sock_path.exists());
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[cfg(unix)]
    #[test]
    fn test_single_instance_reclaims_stale_socket() {
        use std::os::unix::net::UnixListener;

        let temp_dir = std::env::temp_dir().join(format!("pdm_test_ipc_stale_{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        let sock_path = temp_dir.join("pdm.sock");

        // Simulate a crashed prior instance leaving a dead socket file behind
        let stale_listener = UnixListener::bind(&sock_path).unwrap();
        drop(stale_listener);
        assert!(sock_path.exists());

        let guard = match acquire_or_forward_single_instance(&sock_path, SingleInstanceCommand::Show) {
            Ok(SingleInstanceAcquireResult::Primary { listener, cleanup_guard }) => {
                drop(listener);
                cleanup_guard
            }
            Ok(SingleInstanceAcquireResult::ForwardedToExisting) => {
                panic!("Stale socket should have been reclaimed");
            }
            Err(e) => panic!("Failed to reclaim stale socket: {}", e),
        };

        drop(guard);
        assert!(!sock_path.exists());
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[cfg(unix)]
    #[test]
    fn test_single_instance_concurrent_stale_socket_race() {
        use std::os::unix::net::UnixListener;
        use std::sync::{Arc, Barrier, Mutex};

        for round in 0..10 {
            let temp_dir = std::env::temp_dir().join(format!(
                "pdm_test_ipc_race_{}_{}",
                std::process::id(),
                round
            ));
            let _ = fs::remove_dir_all(&temp_dir);
            fs::create_dir_all(&temp_dir).unwrap();
            let sock_path = temp_dir.join("pdm.sock");

            // Leave a dead stale socket file behind before concurrent startup
            let stale = UnixListener::bind(&sock_path).unwrap();
            drop(stale);

            let workers = 8usize;
            let barrier = Arc::new(Barrier::new(workers));
            let (tx, rx) = std::sync::mpsc::channel();
            let primary_guards = Arc::new(Mutex::new(Vec::new()));
            let forwarded_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let errors = Arc::new(Mutex::new(Vec::new()));

            let mut handles = Vec::with_capacity(workers);
            for i in 0..workers {
                let b = Arc::clone(&barrier);
                let sp = sock_path.clone();
                let tx_i = tx.clone();
                let guards = Arc::clone(&primary_guards);
                let fwd = Arc::clone(&forwarded_count);
                let errs = Arc::clone(&errors);
                handles.push(std::thread::spawn(move || {
                    b.wait();
                    match acquire_or_forward_single_instance(&sp, SingleInstanceCommand::New) {
                        Ok(SingleInstanceAcquireResult::Primary { listener, cleanup_guard }) => {
                            spawn_single_instance_server(listener, move |cmd| {
                                let _ = tx_i.send(cmd);
                            });
                            guards.lock().unwrap().push((i, cleanup_guard));
                        }
                        Ok(SingleInstanceAcquireResult::ForwardedToExisting) => {
                            fwd.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        }
                        Err(e) => {
                            errs.lock().unwrap().push((i, e));
                        }
                    }
                }));
            }
            drop(tx);

            for h in handles {
                h.join().unwrap();
            }

            let err_list = errors.lock().unwrap();
            assert!(
                err_list.is_empty(),
                "Round {}: unexpected errors during concurrent startup: {:?}",
                round,
                *err_list
            );
            let mut guards = primary_guards.lock().unwrap();
            assert_eq!(
                guards.len(),
                1,
                "Round {}: expected exactly 1 primary instance, got {}",
                round,
                guards.len()
            );
            assert_eq!(
                forwarded_count.load(std::sync::atomic::Ordering::SeqCst),
                workers - 1,
                "Round {}: expected {} forwarded instances",
                round,
                workers - 1
            );

            for _ in 0..(workers - 1) {
                let cmd = rx
                    .recv_timeout(std::time::Duration::from_secs(2))
                    .expect("Primary should receive every forwarded command");
                assert_eq!(cmd, SingleInstanceCommand::New);
            }

            guards.clear();
            let _ = fs::remove_dir_all(temp_dir);
        }
    }

    #[cfg(unix)]
    #[test]
    fn test_resolve_single_instance_socket_path_enforces_sun_len_limit() {
        let temp_dir = std::env::temp_dir().join(format!("pdm_test_sunlen_{}", std::process::id()));
        fs::create_dir_all(&temp_dir).unwrap();
        let overlong_runtime = temp_dir.join("a".repeat(90));
        fs::create_dir_all(&overlong_runtime).unwrap();

        let resolved = resolve_single_instance_socket_path_from_env(
            Some(overlong_runtime),
            None,
            None,
            temp_dir.clone(),
            1000,
        );
        assert!(fits_unix_socket_path(&resolved));
        assert!(resolved.starts_with(&temp_dir));

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[cfg(unix)]
    #[test]
    fn test_cleanup_guard_does_not_unlink_replaced_socket_inode() {
        let temp_dir = std::env::temp_dir().join(format!("pdm_test_inode_{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        let sock_path = temp_dir.join("pdm.sock");

        let guard1 = match acquire_or_forward_single_instance(&sock_path, SingleInstanceCommand::Show).unwrap() {
            SingleInstanceAcquireResult::Primary { listener, cleanup_guard } => {
                drop(listener);
                cleanup_guard
            }
            SingleInstanceAcquireResult::ForwardedToExisting => panic!("Expected primary"),
        };

        // Keep the original socket inode linked via rename so filesystems like ext4
        // cannot immediately reuse the freed inode for the replacement socket.
        let old_sock_path = temp_dir.join("pdm.sock.old");
        fs::rename(&sock_path, &old_sock_path).unwrap();
        let guard2 = match acquire_or_forward_single_instance(&sock_path, SingleInstanceCommand::Show).unwrap() {
            SingleInstanceAcquireResult::Primary { listener, cleanup_guard } => {
                drop(listener);
                cleanup_guard
            }
            SingleInstanceAcquireResult::ForwardedToExisting => panic!("Expected second primary"),
        };
        assert!(guard1.inode.is_some());
        assert!(guard2.inode.is_some());
        assert_ne!(guard1.inode, guard2.inode);

        // Dropping stale guard1 must NOT remove guard2's socket file
        drop(guard1);
        assert!(sock_path.exists());

        drop(guard2);
        assert!(!sock_path.exists());
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_bind_extension_http_server_skips_reserved_aria2_port() {
        let probe = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("Failed to probe free ephemeral port");
        let free_port = probe.local_addr().unwrap().port();
        drop(probe);

        // Even though free_port is free, reserving it for aria2 must prevent binding it
        assert!(bind_extension_http_server(free_port, free_port, free_port).is_none());

        // When reserved_aria2_port is 0 or a different port, binding the free port succeeds
        let server = bind_extension_http_server(free_port, free_port, 0);
        assert!(server.is_some());
        drop(server);

        // Find a consecutive free pair (p, p+1) and verify reserving p causes binding p+1
        let mut pair = None;
        for _ in 0..20 {
            if let Ok(l1) = std::net::TcpListener::bind(("127.0.0.1", 0)) {
                let p = l1.local_addr().unwrap().port();
                if let Some(p_next) = p.checked_add(1) {
                    if let Ok(l2) = std::net::TcpListener::bind(("127.0.0.1", p_next)) {
                        drop(l2);
                        drop(l1);
                        pair = Some((p, p_next));
                        break;
                    }
                }
            }
        }

        if let Some((reserved, expected_next)) = pair {
            let server = bind_extension_http_server(reserved, expected_next, reserved)
                .expect("Should bind expected_next when reserved port is skipped");
            let bound_port = server
                .server_addr()
                .to_ip()
                .expect("HTTP server should have IP socket address")
                .port();
            assert_eq!(bound_port, expected_next);
        }
    }
}
