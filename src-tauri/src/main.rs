// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // On Linux / EndeavourOS, AMD (amdgpu/Mesa) and Intel (i915/xe) have native DMA-BUF and Wayland support.
        // We avoid disabling compositing mode so hardware GPU acceleration is active.
        // If running on legacy/troublesome Nvidia drivers, users can pass --disable-dmabuf or PDM_DISABLE_DMABUF=1.
        let disable_dmabuf = std::env::var("PDM_DISABLE_DMABUF").map(|v| v == "1").unwrap_or(false)
            || std::env::args().any(|arg| arg == "--disable-dmabuf");
        if disable_dmabuf {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
    purrfect_download_manager_lib::run();
}
