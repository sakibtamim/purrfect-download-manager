---
name: display-ops
description: >-
  Standardized Wayland session diagnosis, kscreen-doctor display management,
  XDG desktop portal graceful restart, Electron Ozone/PipeWire screen capture flags,
  and Sunshine KMS capture capabilities runbook. Use when probing display connectors
  and resolutions on KDE/Wayland, recovering desktop portal screen sharing without SIGKILL,
  configuring Electron apps for Wayland/PipeWire sharing, or setting Linux capabilities for Sunshine streaming.
---
<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Arafat Zahan (@kuasha420) -->
<!-- Corporate Stewardship & Infrastructure: Purrfect Software Limited (PSL) -->
<!-- Governed by: ICARO-42/b Ordinance (Company-Supported Personal IP Framework) -->

# PSL Display Operations: Wayland, kscreen-doctor, Portals & Capture Runbook

This skill establishes empirical, tool-native runbooks for Wayland display configurations, KDE `kscreen-doctor` output management, XDG desktop portal recovery, Electron PipeWire capture flags, and Sunshine KMS capture capabilities.

---

## 1. Wayland Session & Output Probing (`kscreen-doctor`)

### Step 1.1: Verify Active Display Protocol
Confirm Wayland session environment:
```bash
echo "$XDG_SESSION_TYPE"       # Expected: wayland
echo "$XDG_CURRENT_DESKTOP"    # e.g., KDE, GNOME, Hyprland
```

### Step 1.2: Probe Connected Monitors & Modes (`kscreen-doctor -o`)
Query all connected displays, active resolutions, refresh rates, scaling factors, and connector IDs:
```bash
kscreen-doctor -o
```

### Step 1.3: Dynamic Display Reconfiguration
Configure resolution, refresh rate, and scaling without restarting the desktop session:
```bash
# Set primary output mode (e.g., 2560x1440 at 144Hz)
kscreen-doctor output.1.mode.2560x1440@144 output.1.scale.1.0

# Enable or disable secondary monitor
kscreen-doctor output.DP-2.enable
kscreen-doctor output.HDMI-A-1.disable

# Set monitor position in multi-monitor workspace
kscreen-doctor output.1.position.0,0 output.2.position.2560,0
```

---

## 2. XDG Desktop Portal Graceful Recovery (No `-9` Invariant)

### Invariant: Never Send SIGKILL (`kill -9`) to Portals
Sending `kill -9` (`SIGKILL`) to `xdg-desktop-portal` or its backend (`xdg-desktop-portal-kde`, `xdg-desktop-portal-gnome`, `xdg-desktop-portal-wlr`) leaves uncleaned D-Bus sessions, orphaned PipeWire nodes, and corrupts portal state. This causes file pickers, screen capture dialogues, and browser authorization modals to permanently hang until full desktop reboot.

### Step 2.1: Audit Portal Process & Service Status
```bash
systemctl --user status xdg-desktop-portal xdg-desktop-portal-kde --no-pager
```

### Step 2.2: Graceful Portal Restart Sequence
Always restart portals via `systemctl --user` to preserve D-Bus session registration:
```bash
# On KDE Plasma Wayland
systemctl --user restart xdg-desktop-portal-kde xdg-desktop-portal

# On wlroots / Hyprland / Sway
systemctl --user restart xdg-desktop-portal-wlr xdg-desktop-portal
```

### Step 2.3: Graceful Fallback Termination (`SIGTERM` Only)
If systemd user manager is unavailable or non-responsive, terminate with `SIGTERM` and allow D-Bus auto-activation to respawn:
```bash
killall -TERM xdg-desktop-portal-kde xdg-desktop-portal 2>/dev/null || [ $? -eq 1 ]
sleep 1
# Trigger D-Bus activation
busctl --user introspect org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop >/dev/null 2>&1 || [ $? -eq 1 ]
```

---

## 3. Electron Ozone & PipeWire Screen Capture Flags

Electron and Chromium-based applications running under Wayland often default to legacy XWayland, resulting in blurry fractional scaling and completely broken screen capture (black screens).

### Step 3.1: Native Wayland & PipeWire Launch Flags
Launch Electron apps (VS Code, Discord, Slack, Element, Chromium) with native Wayland Ozone platform hints and WebRTC PipeWire capturer flags:
```bash
<application-binary> \
  --ozone-platform-hint=auto \
  --enable-features=WaylandWindowDecorations,WebRTCPipeWireCapturer
```

For strict Wayland execution:
```bash
<application-binary> \
  --ozone-platform=wayland \
  --enable-features=WebRTCPipeWireCapturer
```

### Step 3.2: Verifying Portal Screen Capture Stream
When screen sharing starts, verify that the application has successfully negotiated a PipeWire video node:
```bash
wpctl status | grep -i portal || [ $? -eq 1 ]
pw-top -b -n 1
```

---

## 4. Sunshine Low-Latency Streaming & KMS Capture Capabilities

Sunshine provides high-performance self-hosted game and desktop streaming. On Wayland, it requires Kernel Mode Setting (KMS) or NVFBC/VAAPI direct capture permissions.

### Step 4.1: Grant KMS Capture Capabilities (`cap_sys_admin`)
To allow Sunshine to capture Wayland displays directly without running as root, set the `cap_sys_admin` capability on the executable:
```bash
sudo setcap cap_sys_admin+ep $(command -v sunshine)
```

> ⚠️ **Security Warning**: Granting `cap_sys_admin+ep` directly on a binary gives root-equivalent privileges to anyone who can execute or modify that binary.
>
> **Safer Alternatives**:
> 1. **Systemd Unit Ambient Capabilities (Recommended)**: Run Sunshine as a user/system systemd service and grant capabilities only at runtime rather than on disk:
>    ```ini
>    [Service]
>    AmbientCapabilities=CAP_SYS_ADMIN
>    CapabilityBoundingSet=CAP_SYS_ADMIN
>    ```
> 2. **Path-Based Ownership & Permission Hardening**: If using `setcap`, restrict executable ownership and permissions so non-root users cannot overwrite the privileged file:
>    ```bash
>    sudo chown root:root $(command -v sunshine)
>    sudo chmod 0755 $(command -v sunshine)
>    ```

### Step 4.2: User DRM / Video Group Membership
Ensure the local user belongs to `video` and `render` groups to access `/dev/dri/card*` and `/dev/dri/renderD*`:
```bash
groups $USER
# Add user if missing
sudo usermod -aG video,render $USER
```

### Step 4.3: Verify DRM Device Nodes
```bash
ls -la /dev/dri/
```

### Step 4.4: Check Sunshine Daemon Logs
```bash
journalctl --user -u sunshine -n 50 --no-pager
```
