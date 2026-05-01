---
trigger: always_on
---

# Security Standards

## 1. Dependencies

- Check vulnerabilities when adding or upgrading packages (`pnpm audit`).
- Do not introduce new high/critical vulnerabilities.
- Prioritize security updates for core runtime dependencies.

## 2. Platform-Specific Concerns

- This project targets a desktop application with a Tauri backend; prioritize
  the following concerns over cloud-specific rules unless Firebase is added to
  the repo explicitly:
  - Validate any filesystem access performed by Tauri sidecars; avoid broad
    directory writes and enforce strict path sanitization.
  - Treat spawned sidecar binaries (ffmpeg, yt-dlp, etc.) as untrusted inputs
    for command arguments—sanitize and validate all external inputs.

## 3. Secrets and Environment

- Never hardcode credentials, tokens, or secrets in source files.
- Keep environment configuration in `.env.local` for local development and
  document required variables in `.env.example` when relevant.
- For desktop builds, ensure secrets injected into build artifacts are handled
  per platform best practices (e.g., do not embed long-lived credentials in
  distributed binaries).

## 4. Release Checks

- Run `pnpm lint` and `pnpm build` as part of release validation. Add
  platform-specific validation (Tauri build/test) when preparing release
  artifacts.
- For security-relevant changes, include tests or validation steps that prove
  the behavior is enforced.
