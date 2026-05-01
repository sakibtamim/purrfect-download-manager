---
trigger: always_on
---

# Tech Stack and Workflow

## Core Stack

- Framework: Next.js 16 (App Router).
- Language: TypeScript (strict mode).
- UI: React 19 + Tailwind CSS 4 + local UI primitives.
- State: Zustand.
- Desktop backend: Tauri (Rust) with optional sidecar binaries (ffmpeg, yt-dlp, etc.).
- Linting: ESLint 9 + `eslint-config-next`.
- Package manager: pnpm.

## Primary Scripts

- `pnpm dev`: Start Next.js development server.
- `pnpm dev:app`: Run Tauri desktop app in dev mode (cleans and starts tauri dev).
- `pnpm tauri`: Run Tauri CLI commands.
- `pnpm build`: Build the Next.js production bundle (and use platform-specific Tauri build steps as needed).
- `pnpm lint`: Run lint checks.
- `pnpm setup`: Prepare local sidecars and binaries for development.

## Critical Implementation Patterns

- Keep sidecar invocation and binary handling isolated to `scripts/` or `src-tauri` rather than spreading platform-specific logic through UI components.
- Keep business/domain helpers typed and testable in `src/lib/*`.
- Keep stateful client settings/auth logic in stores (`src/store`) and small provider components.
- Prefer existing UI primitives in `src/components/ui` for consistent UX.
