# Purrfect Download Manager (PDM) 🐾

A fast, modern desktop download manager built with **Tauri v2** and **Next.js 16**, powered by **aria2**, **yt-dlp**, and **ffmpeg**.

---

## Overview

Purrfect Download Manager is a cross-platform desktop application designed for high-throughput, reliable downloading. It couples the raw performance of the `aria2` engine with modern web technologies (React 19, Tailwind CSS v4, Zustand) and native operating system integration (system tray, taskbar progress, dynamic drive detection).

---

## Features

### Core Transfer Engine
* **Multi-Connection Acceleration**: Utilizes `aria2` to dynamically segment files and establish multiple parallel connections per server for maximum bandwidth utilization.
* **Global Speed Limiter**: Configure maximum download speeds directly from the dashboard header to conserve network bandwidth.
* **Persistent Session State**: Active download queues and session metadata automatically persist to disk, resuming seamlessly across application restarts.
* **Collision-Safe Renaming**: Detects duplicate filenames on disk and applies collision-resistant numbering (`(1)`, `(2)`, etc.) before writes occur.
* **Safe Deep Deletion**: Remove completed or cancelled tasks from download history, with optional physical file deletion that safely removes primary files, companion streams, control files (`.aria2`), and isolated multi-file directories.

### Multi-Drive & Storage Management
* **Dynamic Drive Discovery**: Automatically probes mounted physical storage volumes on Linux (`/mnt/*`, `/run/media/*`, `$HOME`, `/`), Windows drive letters (`C:\`, `D:\`), and macOS volumes (`/Volumes/*`).
* **Live Storage Metrics**: Queries live total and free space via OS filesystem statistics (`statvfs`), unescaping volume labels from `/dev/disk/by-label/*`.
* **Quick-Select Storage Pills**: Interactive drive shortcuts in the download confirmation modal and settings allow instant destination switching without manual navigation.
* **Folder Picker Breakout**: Automatically seeds folder dialogs with the target drive's path (`defaultPath`), eliminating the `$HOME` folder trap on desktop portal dialogs.

### Media Extraction & Web Tools
* **Stream Extraction**: Paste media links from supported platforms into Web Tools; PDM invokes `yt-dlp` to resolve direct media streams.
* **Adaptive Stream Multiplexing**: Automatically detects separate high-definition video and audio tracks, downloads them concurrently via `aria2`, and multiplexes them into `.mp4` containers via bundled `ffmpeg`.
* **Site Asset Grabber**: Crawls web pages directly through native desktop HTTP channels to extract downloadable media, documents, and archives for batch queuing.

### Desktop & OS Integration
* **Taskbar Progress Indicator**: Reflects active queue progress, pause states, and error alerts directly on the native OS taskbar and dock icons.
* **System Tray Service**: Runs quietly in the background with a live tray menu displaying transfer rates, queue counts, and quick pause/resume controls. Closing the main window cleanly minimizes to tray.
* **Slide-Over Inspector**: Slide-over drawer providing chunk visualization, transfer metrics, connection statuses, and one-click file reveal in your system file manager (Explorer, Finder, xdg-open).
* **Dual Layout Options**: High-density tabular view with zero horizontal scrolling (optimized for viewports down to 920×560) and a grid card view.
* **Google Safe Browsing**: Optional automated threat inspection against Google Safe Browsing APIs before download staging.
* **Desktop Notifications**: System notifications for completed, failed, or staged downloads requiring operator confirmation.

### Companion Browser Extension
* **Cross-Browser Support**: Manifest V3 extension compatible with Chromium-based browsers (Chrome, Edge, Brave) and Mozilla Firefox.
* **Download Interception**: Automatically intercepts browser download requests, passing URLs, suggested filenames, referrers, and cookies to PDM.
* **Context Menu Actions**: Right-click web links, images, or media to queue downloads directly into PDM.

---

## Security Architecture

* **Dynamic Port Allocation**: Automatically probes and claims free local ports (`6800..=6820`) for the Aria2 RPC daemon to prevent port collisions.
* **Mandatory Ephemeral Tokens**: Secures all Aria2 JSON-RPC communication behind high-entropy, per-session authentication secrets (`--rpc-secret`).
* **Zero Wildcard CORS**: Aria2 RPC daemon restricts origin permissions; webview communication routes over native Rust sockets via `@tauri-apps/plugin-http` to shield the RPC port from browser web pages.
* **Path Traversal Defense**: Filename sanitization decodes multi-pass percent encodings, strips directory traversal sequences (`../`, `..\`), and removes trailing slashes before saving to disk.
* **Scoped File Deletion Whitelist**: Deletion requests are strictly validated against configured download directories to prevent accidental deletion outside user-selected download roots.

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Desktop Framework** | [Tauri v2](https://v2.tauri.app/) (Rust) |
| **Frontend Framework** | [Next.js 16](https://nextjs.org/) (App Router, Turbopack, React 19) |
| **Styling & Components** | [Tailwind CSS v4](https://tailwindcss.com/), [shadcn/ui](https://ui.shadcn.com/), Lucide Icons |
| **State Management** | [Zustand](https://github.com/pmndrs/zustand) |
| **Core Engines** | [aria2](https://aria2.github.io/), [yt-dlp](https://github.com/yt-dlp/yt-dlp), [ffmpeg](https://ffmpeg.org/) (sidecar processes) |
| **Testing** | [Vitest](https://vitest.dev/), Cargo Test |
| **Package Manager** | [pnpm](https://pnpm.io/) |

---

## Getting Started

### Prerequisites

* **Node.js**: v20 or later
* **pnpm**: v9 or later (`corepack enable && corepack prepare pnpm@latest --activate`)
* **Rust Toolchain**: Stable (`rustup default stable`)
* **System Dependencies (Linux)**:
  * Debian / Ubuntu: `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`
  * Arch / EndeavourOS: `sudo pacman -S webkit2gtk-4.1 libayatana-appindicator`
  * Fedora: `sudo dnf install webkit2gtk4.1-devel libappindicator-gtk3-devel`

### Installation & Local Setup

1. **Clone the repository and install dependencies**:
   ```bash
   git clone https://github.com/sakibtamim/purrfect-download-manager.git
   cd purrfect-download-manager
   pnpm install
   ```

2. **Download platform sidecar binaries** (`aria2c`, `yt-dlp`, `ffmpeg`):
   ```bash
   pnpm run setup
   ```
   *Note: On Linux, if system packages are already installed, PDM automatically falls back to system `aria2c`, `yt-dlp`, and `ffmpeg` if sidecars are absent.*

3. **Start the development application**:
   ```bash
   pnpm run dev:app
   ```
   This terminates any lingering sidecar processes from previous runs, compiles the Tauri Rust backend, and launches the Next.js development server.

---

## Companion Browser Extension Setup

The browser extension source resides in the `extension/` directory.

### Mozilla Firefox
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**
3. Select `extension/manifest.json`.

### Google Chrome / Chromium / Brave / Edge
1. Navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in top-right corner).
3. Click **Load unpacked** and select the `extension/` folder.

---

## Repository Scripts

| Script | Purpose |
| :--- | :--- |
| `pnpm run dev:app` | Cleans lingering sidecars and starts Tauri desktop app in dev mode |
| `pnpm run setup` | Downloads precompiled sidecar binaries for the current platform |
| `pnpm run package:extension` | Builds store-ready Chrome and Firefox extension `.zip` bundles under `dist/` |
| `pnpm run clean` | Terminates zombie sidecar/application processes |
| `pnpm run build` | Builds the Next.js production web bundle |
| `pnpm run lint` | Runs ESLint across the TypeScript/JavaScript codebase |
| `pnpm run typecheck` | Validates static types via `tsc --noEmit` |
| `pnpm run test` | Runs the Vitest automated test suite |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Executes the native Rust test suite |

---

## Project Structure

```text
purrfect-download-manager/
├── extension/             # Manifest V3 companion browser extension
├── scripts/               # Setup, sidecar management, and helper scripts
├── src/
│   ├── app/               # Next.js App Router (pages and layouts)
│   ├── components/        # UI components (tables, modals, panels, primitives)
│   ├── lib/               # Client helpers (aria2, yt-dlp, formatters, utilities)
│   └── store/             # Zustand state stores (downloads, settings, theme, mux)
├── src-tauri/
│   ├── capabilities/      # Tauri v2 security ACL permissions and HTTP scopes
│   ├── icons/             # Multi-resolution application icons
│   └── src/lib.rs         # Tauri Rust core backend, IPC commands, and sidecar lifecycle
└── package.json
```

---

## License

This project is licensed under the [MIT License](LICENSE).
