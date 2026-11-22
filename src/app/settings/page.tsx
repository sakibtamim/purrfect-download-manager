"use client";

import { useState } from "react";
import { useDownloadStore } from "@/store/downloadStore";
import { useThemeStore } from "@/store/themeStore";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { open } from "@tauri-apps/plugin-dialog";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  FolderOpen,
  HardDrive,
  Activity,
  Cat,
  Globe,
  Moon,
  Sun,
  Monitor,
  Palette,
  AppWindow,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ThemeMode = "dark" | "light" | "system";

export default function SettingsPage() {
  const {
    defaultDownloadDir,
    setDefaultDownloadDir,
    maxConcurrentDownloads,
    setMaxConcurrentDownloads,
    splitConnections,
    setSplitConnections,
    speedUnit,
    setSpeedUnit,
    autoStart,
    setAutoStart,
    isPlayfulMode,
    togglePlayfulMode,
    safeBrowsingApiKey,
    setSafeBrowsingApiKey,
    closeToTray,
    setCloseToTray,
    minimizeToTray,
    setMinimizeToTray,
    startMinimized,
    setStartMinimized,
    showTaskbarProgress,
    setShowTaskbarProgress,
  } = useDownloadStore();

  const { theme, setTheme } = useThemeStore();

  const [tempApiKey, setTempApiKey] = useState(safeBrowsingApiKey || "");
  const [apiKeyStatus, setApiKeyStatus] = useState<"idle" | "validating" | "success" | "error">("idle");
  const [apiErrorMessage, setApiErrorMessage] = useState("");
  const [browserTab, setBrowserTab] = useState<"firefox" | "chromium">("firefox");

  const handleValidateApiKey = async () => {
    if (!tempApiKey.trim()) {
      setSafeBrowsingApiKey("");
      setApiKeyStatus("success");
      return;
    }

    setApiKeyStatus("validating");
    setApiErrorMessage("");

    try {
      const res = await tauriFetch(
        `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${tempApiKey.trim()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client: { clientId: "purrfect-dl", clientVersion: "1.0.0" },
            threatInfo: {
              threatTypes: ["MALWARE"],
              platformTypes: ["ANY_PLATFORM"],
              threatEntryTypes: ["URL"],
              threatEntries: [{ url: "http://example.com" }],
            },
          }),
        }
      );

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error?.message || `API Error ${res.status}`);
      }

      setSafeBrowsingApiKey(tempApiKey.trim());
      setApiKeyStatus("success");
      setTimeout(() => setApiKeyStatus("idle"), 3000);
    } catch (e: unknown) {
      setApiKeyStatus("error");
      setApiErrorMessage(e instanceof Error ? e.message : "Invalid API Key");
    }
  };

  const handleBrowseDefaultDir = async () => {
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Select Default Save Location",
      });
      if (selectedPath && typeof selectedPath === "string") {
        setDefaultDownloadDir(selectedPath);
      }
    } catch (e) {
      console.error("Failed to open dialog", e);
    }
  };

  const themeOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  return (
    <div className="space-y-4 max-w-4xl pb-12">
      {/* Page Header */}
      <div className="pb-3 border-b border-border/60">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Configure your Purrfect Download Manager preferences and desktop integration.
        </p>
      </div>

      <div className="grid gap-3.5">
        {/* Section 1: Appearance & Fun */}
        <section className="bg-card/70 border border-border rounded-xl p-3.5 space-y-3">
          <div className="flex items-center gap-2 text-primary">
            <Palette className="h-4 w-4" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Appearance &amp; Theme
            </h2>
          </div>

          <div className="space-y-2.5">
            {/* Theme Segmented Control */}
            <div className="flex items-center justify-between py-1">
              <div>
                <Label className="text-xs font-medium text-foreground">Color Scheme</Label>
                <p className="text-[11px] text-muted-foreground">Select your interface appearance.</p>
              </div>
              <div className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border h-8 shrink-0">
                {themeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTheme(opt.value)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 h-7 rounded-md text-xs font-medium transition-colors",
                      theme === opt.value
                        ? "bg-background text-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    aria-label={`Select ${opt.label} theme`}
                    aria-pressed={theme === opt.value}
                  >
                    <opt.icon className="w-3.5 h-3.5" />
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Playful Mode */}
            <div className="flex items-center justify-between py-1 pt-2.5 border-t border-border/50">
              <div className="space-y-0.5">
                <Label htmlFor="playful-mode" className="text-xs font-medium text-foreground flex items-center gap-1.5 cursor-pointer">
                  Playful Kitty Mode <Cat className="w-3.5 h-3.5 text-primary" />
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Enable fun cat-themed status text and playful animations.
                </p>
              </div>
              <Switch
                id="playful-mode"
                checked={isPlayfulMode}
                onCheckedChange={togglePlayfulMode}
                aria-label="Toggle Playful Kitty Mode"
              />
            </div>
          </div>
        </section>

        {/* Section 2: Storage & Performance */}
        <section className="bg-card/70 border border-border rounded-xl p-3.5 space-y-3">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <HardDrive className="h-4 w-4" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Downloads &amp; Performance
            </h2>
          </div>

          <div className="space-y-2.5">
            {/* Default Directory */}
            <div className="space-y-1">
              <Label htmlFor="default-download-dir" className="text-xs font-medium text-foreground">
                Default Download Directory
              </Label>
              <div className="flex gap-2">
                <Input
                  id="default-download-dir"
                  aria-label="Default Download Directory"
                  value={defaultDownloadDir || "OS Default Downloads"}
                  readOnly
                  className="bg-background border-border text-foreground text-xs h-8 font-medium"
                />
                <Button
                  onClick={handleBrowseDefaultDir}
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 text-xs gap-1.5"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Browse
                </Button>
              </div>
            </div>

            {/* Max Concurrent */}
            <div className="pt-2 border-t border-border/50 space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <div>
                  <Label className="text-xs font-medium text-foreground">Max Concurrent Downloads</Label>
                  <p className="text-[11px] text-muted-foreground">Simultaneous active download tasks.</p>
                </div>
                <span className="font-mono font-bold text-xs bg-muted px-2.5 py-0.5 rounded-md border border-border">
                  {maxConcurrentDownloads}
                </span>
              </div>
              <Slider
                value={[maxConcurrentDownloads]}
                onValueChange={(vals) => setMaxConcurrentDownloads(typeof vals === "number" ? vals : vals[0])}
                max={16}
                min={1}
                step={1}
                aria-label="Max concurrent downloads"
                className="py-1"
              />
            </div>

            {/* Split Connections */}
            <div className="pt-2 border-t border-border/50 space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <div>
                  <Label className="text-xs font-medium text-foreground">Parallel Connections (Split)</Label>
                  <p className="text-[11px] text-muted-foreground">Number of parallel connection streams per file (1 to 32).</p>
                </div>
                <span className="font-mono font-bold text-xs bg-muted px-2.5 py-0.5 rounded-md border border-border">
                  {splitConnections}
                </span>
              </div>
              <Slider
                value={[splitConnections]}
                onValueChange={(vals) => setSplitConnections(typeof vals === "number" ? vals : vals[0])}
                max={32}
                min={1}
                step={1}
                aria-label="Parallel connections per download"
                className="py-1"
              />
            </div>

            {/* Speed Unit */}
            <div className="pt-2 border-t border-border/50 flex items-center justify-between">
              <div>
                <Label className="text-xs font-medium text-foreground">Speed Unit</Label>
                <p className="text-[11px] text-muted-foreground">Display speeds in MegaBytes (MB/s) or Megabits (Mbps).</p>
              </div>
              <div className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border h-7">
                <button
                  type="button"
                  onClick={() => setSpeedUnit("MBps")}
                  className={cn(
                    "px-2.5 h-6 text-xs font-medium rounded-md transition-colors",
                    speedUnit === "MBps"
                      ? "bg-background text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  aria-pressed={speedUnit === "MBps"}
                >
                  MB/s
                </button>
                <button
                  type="button"
                  onClick={() => setSpeedUnit("Mbps")}
                  className={cn(
                    "px-2.5 h-6 text-xs font-medium rounded-md transition-colors",
                    speedUnit === "Mbps"
                      ? "bg-background text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  aria-pressed={speedUnit === "Mbps"}
                >
                  Mbps
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Section 3: System Tray & Taskbar */}
        <section className="bg-card/70 border border-border rounded-xl p-3.5 space-y-3">
          <div className="flex items-center gap-2 text-cyan-500 dark:text-cyan-400">
            <AppWindow className="h-4 w-4" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              System Tray &amp; Taskbar
            </h2>
          </div>

          <div className="divide-y divide-border/50 text-xs">
            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label htmlFor="close-to-tray" className="text-xs font-medium text-foreground cursor-pointer">Close to System Tray</Label>
                <p className="text-[11px] text-muted-foreground">Keep app running in system tray when close button (✕) is clicked.</p>
              </div>
              <Switch id="close-to-tray" checked={closeToTray} onCheckedChange={setCloseToTray} aria-label="Toggle close to system tray" />
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label htmlFor="minimize-to-tray" className="text-xs font-medium text-foreground cursor-pointer">Minimize to System Tray</Label>
                <p className="text-[11px] text-muted-foreground">Hide application from the OS taskbar when minimized.</p>
              </div>
              <Switch id="minimize-to-tray" checked={minimizeToTray} onCheckedChange={setMinimizeToTray} aria-label="Toggle minimize to system tray" />
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label htmlFor="auto-start" className="text-xs font-medium text-foreground cursor-pointer">Launch on System Startup</Label>
                <p className="text-[11px] text-muted-foreground">Automatically launch Purrfect DL on system boot.</p>
              </div>
              <Switch id="auto-start" checked={autoStart} onCheckedChange={setAutoStart} aria-label="Toggle launch on startup" />
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label htmlFor="start-minimized" className="text-xs font-medium text-foreground cursor-pointer">Start Minimized</Label>
                <p className="text-[11px] text-muted-foreground">Start quietly in the background without opening the main window.</p>
              </div>
              <Switch id="start-minimized" checked={startMinimized} onCheckedChange={setStartMinimized} aria-label="Toggle start minimized" />
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label htmlFor="taskbar-progress" className="text-xs font-medium text-foreground cursor-pointer">Taskbar Download Progress</Label>
                <p className="text-[11px] text-muted-foreground">Display overall live progress on the OS taskbar icon.</p>
              </div>
              <Switch id="taskbar-progress" checked={showTaskbarProgress} onCheckedChange={setShowTaskbarProgress} aria-label="Toggle taskbar progress" />
            </div>
          </div>
        </section>

        {/* Section 4: Browser Integration */}
        <section className="bg-card/70 border border-border rounded-xl p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sky-500 dark:text-sky-400">
              <Globe className="h-4 w-4" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Browser Companion Extension
              </h2>
            </div>

            <div role="tablist" aria-label="Browser Companion Instructions" className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border h-7">
              <button
                type="button"
                role="tab"
                id="tab-firefox"
                aria-selected={browserTab === "firefox"}
                aria-controls="panel-browser-instructions"
                onClick={() => setBrowserTab("firefox")}
                className={cn(
                  "px-2.5 h-6 text-xs font-medium rounded-md transition-colors",
                  browserTab === "firefox"
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Firefox
              </button>
              <button
                type="button"
                role="tab"
                id="tab-chromium"
                aria-selected={browserTab === "chromium"}
                aria-controls="panel-browser-instructions"
                onClick={() => setBrowserTab("chromium")}
                className={cn(
                  "px-2.5 h-6 text-xs font-medium rounded-md transition-colors",
                  browserTab === "chromium"
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Chrome / Brave / Edge
              </button>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Automatically intercepts browser downloads and enables right-click &quot;Download with Purrfect DL&quot;.
          </p>

          <div
            role="tabpanel"
            id="panel-browser-instructions"
            aria-labelledby={browserTab === "firefox" ? "tab-firefox" : "tab-chromium"}
            className="bg-muted/30 border border-border rounded-lg p-3 text-xs text-foreground/80 space-y-1.5 font-mono"
          >
            {browserTab === "firefox" ? (
              <>
                <p>1. Open Firefox: <code className="text-primary bg-primary/10 px-1 py-0.5 rounded">about:debugging#/runtime/this-firefox</code></p>
                <p>2. Click <strong className="text-foreground font-sans">Load Temporary Add-on...</strong></p>
                <p>3. Select <code className="text-primary bg-primary/10 px-1 py-0.5 rounded">manifest.json</code> from the <code className="text-primary bg-primary/10 px-1 py-0.5 rounded">extension/</code> folder in PDM.</p>
              </>
            ) : (
              <>
                <p>1. Open Chrome/Brave/Edge: <code className="text-primary bg-primary/10 px-1 py-0.5 rounded">chrome://extensions</code></p>
                <p>2. Toggle <strong className="text-foreground font-sans">Developer mode</strong> (top right)</p>
                <p>3. Click <strong className="text-foreground font-sans">Load unpacked</strong> and select the <code className="text-primary bg-primary/10 px-1 py-0.5 rounded">extension/</code> folder.</p>
              </>
            )}
          </div>
        </section>

        {/* Section 5: Security & Antivirus */}
        <section className="bg-card/70 border border-border rounded-xl p-3.5 space-y-3">
          <div className="flex items-center gap-2 text-rose-500 dark:text-rose-400">
            <ShieldCheck className="h-4 w-4" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Security &amp; Antivirus
            </h2>
          </div>

          <div className="space-y-2">
            <Label htmlFor="safe-browsing-api-key" className="text-xs font-medium text-foreground">
              Google Safe Browsing API Key
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Scans URLs for malware and phishing before downloading. Leave blank to disable.
            </p>
            <div className="flex gap-2">
              <Input
                id="safe-browsing-api-key"
                aria-label="Google Safe Browsing API Key"
                type="password"
                value={tempApiKey}
                onChange={(e) => {
                  setTempApiKey(e.target.value);
                  setApiKeyStatus("idle");
                }}
                placeholder="AIzaSyB..."
                className="bg-background border-border text-foreground text-xs h-8 font-mono"
              />
              <Button
                onClick={handleValidateApiKey}
                disabled={apiKeyStatus === "validating"}
                size="sm"
                className="h-8 shrink-0 text-xs"
              >
                {apiKeyStatus === "validating" ? (
                  <Activity className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : null}
                {apiKeyStatus === "validating" ? "Validating..." : "Save & Validate"}
              </Button>
            </div>

            {apiKeyStatus === "error" && (
              <p className="text-xs text-red-500 flex items-center gap-1.5 mt-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {apiErrorMessage}
              </p>
            )}

            {apiKeyStatus === "success" && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 mt-1">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                {tempApiKey ? "API Key successfully validated and saved!" : "Security scanning disabled."}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
