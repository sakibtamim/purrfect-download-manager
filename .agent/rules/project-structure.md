---
trigger: always_on
---

# Project Structure Map

This repository is a Next.js (App Router) application with a Tauri backend under `src-tauri`.

## Root

- `src/app/`: Routes, layouts and page-level UI.
- `src/components/`: Reusable React components and `ui/` primitives.
- `src/lib/`: Shared helpers and service wrappers (e.g. `aria2Client.ts`, `ytdlpClient.ts`).
- `src/store/`: Zustand state stores.
- `src-tauri/`: Tauri Rust backend, sidecar binaries, and Tauri config.

## Config and Ops

- Build, lint and other maintainer scripts live in `package.json`.
- Local maintenance helpers live under `scripts/` and are intended for maintainers, not for committing generated artifacts.

## Navigation Tips

- Use relative imports or the `src` project alias (as configured in `tsconfig.json`).
- Add focused modules inside existing folders rather than introducing broad new top-level domains.
