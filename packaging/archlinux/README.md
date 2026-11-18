# EndeavourOS / Arch Linux Packaging Guide

This directory contains the packaging specifications to install **Purrfect Download Manager** natively on EndeavourOS and Arch Linux.

---

## 1. Local On-Demand Installation (`makepkg -si`)

Whenever you are satisfied with local testing and want PDM permanently installed to your system:

```bash
cd packaging/archlinux
makepkg -si
```

### What this does:
1. Resolves and installs system dependencies (`aria2`, `yt-dlp`, `ffmpeg`, `webkit2gtk-4.1`, `gtk3`).
2. Builds the Tauri desktop binary.
3. Installs the application to `/usr/bin/purrfect-download-manager`.
4. Creates a convenient CLI symlink: `/usr/bin/pdm`.
5. Installs the desktop entry and application icons in `/usr/share/applications/` and `/usr/share/icons/hicolor/`.

---

## 2. Launching PDM

Once installed, you can launch it in two ways:
- **CLI**: Run `pdm` (or `purrfect-download-manager`) in your terminal.
- **Application Launcher**: Search for **Purrfect Download Manager** in your KDE Plasma Kickoff, GNOME App Grid, or Rofi/Wofi.

---

## 3. How to Publish to the AUR for `yay` Installation

To make PDM installable via `yay -S purrfect-download-manager`:

1. **Generate `.SRCINFO`**:
   ```bash
   makepkg --printsrcinfo > .SRCINFO
   ```
2. **Clone your AUR repository**:
   ```bash
   git clone ssh://aur@aur.archlinux.org/purrfect-download-manager.git /tmp/aur-pdm
   ```
3. **Copy files and push**:
   ```bash
   cp PKGBUILD .SRCINFO purrfect-download-manager.desktop /tmp/aur-pdm/
   cd /tmp/aur-pdm
   git add PKGBUILD .SRCINFO purrfect-download-manager.desktop
   git commit -m "chore: release v0.1.1"
   git push origin master
   ```
4. **Install via yay**:
   ```bash
   yay -S purrfect-download-manager
   ```
