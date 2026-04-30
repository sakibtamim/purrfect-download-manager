# Purrfect Download Manager (PDM) 🐾

A modern, lightning-fast desktop download manager built with **Tauri v2**, **Next.js**, and powered by the **aria2** engine under the hood. 



## Features

- **Blazing Fast Downloads:** Uses the `aria2` backend to dynamically segment and multi-thread downloads for maximum speed.
- **Browser Extension API:** Ships with a local HTTP server (Port `6801`) that can accept JSON payloads directly from future Chrome/Edge extensions, bypassing website bot protections by cloning your browser session!
- **Drag & Drop Magic:** Found a link? Just drag and drop it directly onto the PDM window to immediately add it to your queue.
- **Global Speed Limiter:** Don't let downloads hog your whole network! Set a max KB/s download speed right from the dashboard header.
- **Native OS Notifications:** Get pinged directly on your desktop when your downloads hit completion or fail.
- **System Tray Integration:** Runs quietly in the background. Clicking the "X" safely minimizes PDM to your tray instead of killing your downloads.
- **"Playful Mode":** Toggle the playful switch to give the UI some fun cat-themed text and subtle CSS micro-animations while you wait! 🐈

## Tech Stack

- **Frontend:** Next.js 15 (React 19), Tailwind CSS v4, Zustand (State Management), Lucide Icons, shadcn/ui.
- **Backend:** Tauri v2 (Rust).
- **Core Engine:** `aria2c` running as a decoupled sidecar process, communicating via JSON-RPC.
- **Package Manager:** `pnpm`

## Getting Started

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) (with `pnpm`), and [Rust](https://www.rust-lang.org/) installed on your system.

### Installation

1. Install all frontend dependencies:
   ```bash
   pnpm install
   ```

2. Run the application in development mode:
   ```bash
   pnpm run tauri dev
   ```

This will automatically compile the Rust backend, spawn the `aria2c` sidecar, and boot up the Next.js frontend in a native desktop window.

## Architecture Notes
- The Rust backend manages the lifecycle of the `aria2c` executable. It automatically configures `aria2c` to bypass strict SSL checks, spoof a modern User-Agent, and target your OS's native `Downloads` folder.
- The `src/components/app-initializer.tsx` component is the bridge between the backend and frontend. It polls `aria2c` using JSON-RPC every second to keep the React UI instantly synced with download progress.
- To fully exit the app, right-click the system tray icon and select "Quit", or kill the process in your terminal.
