# Purrfect Download Manager — Roadmap 🗺️

This document outlines the strategic milestones, architectural evolutions, and delivery horizons for Purrfect Download Manager (PDM).

---

## Milestone 1: Core Architecture & Native Sidecars (Completed ✅)

Established the foundational desktop engine, decoupled sidecar architecture, and initial end-to-end download workflows.

### Delivered Capabilities
- **Tauri v2 + Next.js App Router Core**: Bootstrapped robust hybrid desktop foundation running React 19 and Rust.
- **Decoupled Sidecar Processes**: Integrated `pdm-aria2c` for high-throughput segmented chunk transfers, `pdm-yt-dlp` for media extraction, and `pdm-ffmpeg` for high-fidelity 4K stream muxing.
- **Queue Persistence**: Implemented JSON-backed atomic disk synchronization saving active queues every 10 seconds.
- **Smart Disk Operations**: Collision-safe physical file renaming (`(1)`, `(2)`), deep disk deletion, and native folder opening.
- **Web Tools & Interception**: Site grabber engine bypassing CORS, video resolution extraction, and initial Chromium extension bridge via WebSocket port hopping.
- **Security & Desktop Baseline**: Google Safe Browsing URL evaluation, system tray lifecycle handling, and autostart on boot.

---

## Milestone 2: Compact Responsive UI/UX Overhaul & Extension Modernization (Completed ✅ — PR #25)

Refined user experience for compact desktop viewports, modernized browser extension support, and introduced deep OS desktop integrations.

### Delivered Capabilities
- **Compact Viewport Density**: Standardized on a 920x560 minimum viewport envelope with zero horizontal scroll across all tabs and components.
- **Dual Layout Modes**: High-density tabular view with compact headers and responsive columns, paired with an alternate rich card view.
- **Slide-Over Inspector Drawer**: Replaced cumbersome bottom inspection panel with a fluid, full-height slide-over drawer for chunk progress, headers, and metadata.
- **Dual-Engine Browser Extension (MV3)**: Upgraded extension architecture supporting Chromium (`downloads.onDeterminingFilename`) and Firefox Gecko (`downloads.onCreated`), with resilient port-hopping and full payload extraction (cookies, headers, referrer).
- **Desktop Taskbar & Dynamic Tray**: Live OS taskbar/dock progress bar indicator, real-time transfer stats in system tray context menu, and bidirectional autostart sync between UI and desktop preferences.
- **View Transitions Theme Engine**: Instant, eye-friendly light/dark/system theme switching powered by the native View Transitions API.
- **Wayland Desktop Reliability**: Window decoration surface hitbox recovery mechanism resolving Wayland resize grip drops.
- **Verification Baseline**: 70 unit tests passing in ~320ms, 0 lint errors, 0 type errors, clean Turbopack build.

---

## Milestone 3: Advanced Bandwidth Scheduling, Proxy Pools & BitTorrent Expansion (Planned ⏳ — Medium Resolution)

Focuses on enterprise-grade network controls, protocol expansions, and granular scheduling boundaries.

### Architectural Objectives
- **Granular Bandwidth Scheduler**:
  - Time-of-day download speed throttle schedules (e.g., peak vs. off-peak limits).
  - Priority queues with dynamic connection allocation per download category.
- **Proxy Pools & Dynamic Routing**:
  - SOCKS5, HTTP/HTTPS proxy configuration with per-domain routing rules.
  - Automatic proxy failover and credential keychain integration.
- **BitTorrent Protocol Expansion**:
  - Native torrent and magnet link ingestion via aria2 BitTorrent module.
  - Sequential piece downloading for instant media preview streaming.
  - Seed-ratio management, peer blocklists, and tracker management dashboard.
- **Batch Metadata Extraction**:
  - Multi-URL clipboard batch parser with automatic filetype categorization.
  - Granular yt-dlp format selector modal (audio-only, custom codecs, subtitle tracks).

---

## Milestone 4: Multi-Device Sync & Cross-Platform Mobile Companions (Vision 🔭 — Low Resolution)

Long-range vision exploring distributed queue management and mobile companion integration.

### Strategic Vectors
- **PDM Remote Mesh (Knot Integration)**:
  - Secure end-to-end encrypted remote queue control from external devices.
  - Headless daemon mode for local NAS, home server, and Raspberry Pi deployments.
- **Mobile Companion Apps**:
  - Lightweight companion apps (Android / iOS) for sending links directly to desktop queues and monitoring active progress.
- **Cloud Storage Relay**:
  - Optional post-download push pipelines to private S3, WebDAV, or Nextcloud storage targets.
