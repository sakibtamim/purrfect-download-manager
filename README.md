# Purrfect Download Manager (PDM) 🐾

A modern, lightning-fast desktop download manager built with **Tauri v2**, **Next.js**, and powered by the **aria2** engine and **yt-dlp** under the hood.

## Features

### Core Downloading Engine

- **Blazing Fast Downloads:** Uses the `aria2` backend to dynamically segment and multi-thread downloads for maximum speed.
- **Global Speed Limiter:** Don't let downloads hog your whole network! Set a max KB/s download speed right from the dashboard header.
- **Persistent Queues:** Automatically saves your active download queue to disk every 10 seconds. You can close PDM entirely, and when you reopen it, your downloads will resume right where they left off.

### Web Tools & Media Extraction

- **The Site Grabber:** Paste a target website URL into the Web Tools tab. PDM rips the HTML directly bypassing CORS, extracts every single image, video, and document link, and allows you to bulk download them all in a single click.
- **Native YouTube Downloader:** Paste a YouTube, Twitter, or TikTok link into the Web Tools tab. PDM runs `yt-dlp` in the background (configured with anti-bot evasion variables) to extract the absolute direct `.mp4` stream and pushes it to `aria2c` for high-speed queue downloading.
- **True 4K Unlocked:** Standard downloaders cap out at 720p on YouTube. PDM intelligently detects high-res, separated video and audio tracks, downloads them concurrently via `aria2c`, and silently spins up a bundled `ffmpeg` process to perfectly mux them into pristine 1080p, 1440p, or 4K `.mp4` files.
- **Browser Interceptor Extension:** Ships with a Chromium extension that intercepts all browser downloads and seamlessly pipes the metadata (URL, Filename, Size, Headers, and Cookies) directly into the PDM queue.
- **Context Menus:** Right-click any link, image, or video in your browser and select "Download with Purrfect DL" to queue it instantly.

### Security & Integrations

- **Google Safe Browsing Integration:** Automatically pings Google Safe Browsing before staging a download. If a malicious or phishing URL is detected, the UI turns hostile and physically prevents you from downloading the virus.
- **System Tray Integration:** Runs quietly in the background. Clicking the "X" safely minimizes PDM to your tray instead of killing your downloads.
- **Windows Autostart:** Optionally boots PDM silently on system startup so your downloads never stop.
- **Native OS Notifications:** Get pinged directly on your desktop when your downloads hit completion or fail.

### UX/UI

- **Interactive Staging Modal:** When a download is intercepted, PDM pauses the download and launches a beautiful confirmation modal, giving you a chance to inspect the file size, filename, security status, and choose a custom save directory.
- **Drag & Drop Magic:** Found a link? Just drag and drop it directly onto the PDM window to immediately add it to your queue.
- **"Playful Mode":** Toggle the playful switch to give the UI some fun cat-themed text and subtle CSS micro-animations while you wait! 🐈

## Tech Stack

- **Frontend:** Next.js 16 (React 19), Tailwind CSS v4, Zustand (State Management), Lucide Icons, shadcn/ui.
- **Backend:** Tauri v2 (Rust).
- **Core Engines:** `aria2c`, `yt-dlp`, and `ffmpeg` running as decoupled sidecar processes.
- **Package Manager:** `pnpm`

## Contributor Workflow

- Run `pnpm install` to install dependencies and set up the local Git hooks.
- Use `pnpm lint` before pushing changes.
- The GitHub helper scripts live in `scripts/`:
  - `scripts/generate-issues-report.js` generates an issue report under `docs/reports/`.
  - `scripts/gh-pr-review-comments.js` fetches review comments for a pull request.

## Getting Started

### Prerequisites

Make sure you have [Node.js](https://nodejs.org/) (with `pnpm`), and [Rust](https://www.rust-lang.org/) installed on your system.

### Installation

1. Install all frontend dependencies:

   ```bash
   pnpm install
   ```

2. Download all platform-specific binaries for the sidecars (`aria2c`, `yt-dlp`, and `ffmpeg`):

   ```bash
   pnpm run setup
   ```

3. Run the application in development mode:
   ```bash
   pnpm run dev:app
   ```
   > **Note:** Because PDM is designed to run silently in the background via the system tray, closing the window does not kill the sidecar processes. Running `pnpm run dev:app` ensures any lingering "zombie" processes from previous sessions are terminated so the Rust compiler can safely build the app without "Access Denied" lock errors.

This will automatically compile the Rust backend, spawn the `aria2c` sidecar, and boot up the Next.js frontend in a native desktop window.
