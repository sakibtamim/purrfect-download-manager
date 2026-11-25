# Security Policy

## Supported Versions

We actively provide security updates and patches for the following versions:

| Version | Supported | Notes |
| :--- | :--- | :--- |
| `0.1.x` (current prereleases) | :white_check_mark: | Active release candidate series |
| `develop` branch | :white_check_mark: | Active integration branch |
| `< 0.1.0` | :x: | Legacy prototype builds |

## Reporting a Vulnerability

The Purrfect Download Manager (PDM) team takes the security of our desktop runtime, browser extensions, and user downloads seriously. If you discover a potential vulnerability, please report it responsibly:

### 1. Primary Channel: GitHub Private Vulnerability Reporting
Please submit findings via **[GitHub Private Vulnerability Reporting](https://github.com/sakibtamim/purrfect-download-manager/security/advisories/new)**. This creates a confidential advisory workspace where maintainers and researchers can collaborate on triage and patches before public disclosure.

### 2. Secondary Channel: Security Email
If you are unable to use GitHub advisories, you may report findings via email:
* **Security Contact**: `sakib@purrfectsoftwareltd.com`
* **Subject**: `[PDM Security] Vulnerability Report: <Brief Description>`

### What to Include
To help us triage and reproduce the issue rapidly, please include:
* Component affected (`src-tauri` backend, Next.js frontend, extension HTTP bridge, or browser extension).
* Type of vulnerability (e.g., path traversal, IPC boundary bypass, command injection, CORS misconfiguration).
* Clear step-by-step reproduction instructions or a minimal proof of concept (PoC).
* Impact assessment and suggested mitigations if known.

## Response Commitment & SLA

* **Initial Acknowledgement**: Within 48 hours of report receipt.
* **Triage Assessment**: Within 7 business days.
* **Remediation & Coordinated Disclosure**: Once a patch is validated and built across supported targets, a security update will be tagged and released alongside credited advisory attribution.

## Local Security Architecture & Defensive Invariants

Purrfect Download Manager adheres to defense-in-depth principles:
* **Loopback-Only Extension Server**: The companion HTTP server binds strictly to `127.0.0.1` and enforces strict `Origin` header validation matching registered extension identifiers (`chrome-extension://*`, `moz-extension://*`).
* **Single-Instance Advisory Locking**: Desktop processes acquire an advisory `flock` on a private per-user Unix domain socket under `$XDG_RUNTIME_DIR` to prevent local IPC hijacking or socket race conditions.
* **Strict Sidecar Argument & Path Sanitization**: Companion binaries (`aria2c`, `yt-dlp`, `ffmpeg`) are invoked with hermetic parameters and bound filesystem targets, preventing shell escaping or path breakout.
