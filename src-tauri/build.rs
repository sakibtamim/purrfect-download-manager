use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    tauri_build::build();

    // Ensure sidecars from bin/ are copied to the active cargo target directory (target/debug or target/release)
    // Workaround for Cargo OUT_DIR subfolder hashing in recent Rust versions
    if let Ok(out_dir) = env::var("OUT_DIR") {
        let out_path = PathBuf::from(&out_dir);
        let mut curr = out_path.as_path();
        while let Some(parent) = curr.parent() {
            if curr.file_name().and_then(|s| s.to_str()) == Some("build") {
                let profile_dir = parent;
                let target_triple = env::var("TARGET").unwrap_or_else(|_| "x86_64-unknown-linux-gnu".to_string());
                let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string()));
                let bin_dir = manifest_dir.join("bin");

                for bin_name in &["pdm-aria2c", "pdm-ffmpeg", "pdm-yt-dlp"] {
                    let sidecar_filename = format!("{}-{}", bin_name, target_triple);
                    let src_file = bin_dir.join(&sidecar_filename);
                    let dest_file = profile_dir.join(bin_name);

                    if src_file.exists() {
                        let _ = fs::copy(&src_file, &dest_file);
                        #[cfg(unix)]
                        {
                            use std::os::unix::fs::PermissionsExt;
                            let _ = fs::set_permissions(&dest_file, fs::Permissions::from_mode(0o755));
                        }
                    }
                }
                break;
            }
            curr = parent;
        }
    }
}
