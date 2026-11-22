# Purrfect Download Manager — Project Ledger

## Milestone 2 Handoff & Architecture Decisions (2026-11-23)

### Architectural Decision Records
- **ADR-2026-001 (Compact Viewport Density)**:
  Standardized window minimum boundaries to 920x560. Replaced horizontal-scroll layouts with auto-collapsing table rows, responsive flex containers, and dual Table/Card view toggles.
- **ADR-2026-002 (Dual-Engine Browser Interception)**:
  Decoupled browser extension download listeners: Chromium uses `chrome.downloads.onDeterminingFilename` to cancel browser transfers and route to PDM; Firefox Gecko uses `browser.downloads.onCreated` with immediate `browser.downloads.cancel()` to bypass Gecko MV3 constraints.
- **ADR-2026-003 (Wayland Surface Hitbox Recovery via Resizable Toggle)**:
  Mitigated Wayland window decoration grip hitbox drops on un-minimize / restore by programmatically cycling Tauri window resizability state (`set_resizable(false)` -> `set_resizable(true)`) after visibility change events.

### Empirical Quality Baseline
- **Automated Tests**: 70/70 unit tests passing hermetically in ~320ms (`vitest run`).
- **Static Quality**: 0 ESLint errors, 0 TypeScript compile errors.
- **Runtime Build**: Clean Next.js 16 / Turbopack bundle verification.
