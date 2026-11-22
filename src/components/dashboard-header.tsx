"use client";

import { useAppStore } from "@/store";
import { useThemeStore } from "@/store/themeStore";
import { Activity, DownloadCloud, Gauge, Pause, Play, Trash2, Sun, Moon, Cat } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";
import { AddDownloadModal } from "./add-download-modal";
import { formatSpeed, cn } from "@/lib/utils";

export function DashboardHeader() {
  const activeCount = useAppStore((state) => state.active.length);
  const globalSpeed = useAppStore((state) => state.globalSpeed);
  const speedUnit = useAppStore((state) => state.speedUnit);
  const setSpeedLimit = useAppStore((state) => state.setSpeedLimit);
  const pauseAllDownloads = useAppStore((state) => state.pauseAllDownloads);
  const resumeAllDownloads = useAppStore((state) => state.resumeAllDownloads);
  const clearCompletedDownloads = useAppStore((state) => state.clearCompletedDownloads);
  const isPlayfulMode = useAppStore((state) => state.isPlayfulMode);
  const togglePlayfulMode = useAppStore((state) => state.togglePlayfulMode);

  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setTheme = useThemeStore((state) => state.setTheme);

  const [limitInput, setLimitInput] = useState("");

  return (
    <header className="h-12 shrink-0 flex items-center justify-between gap-3 px-3.5 bg-background/90 glass border-b border-border select-none">
      {/* Left: Active badge + Queue actions */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/10 text-primary border border-primary/20 text-xs font-medium shrink-0">
          <DownloadCloud className="h-3.5 w-3.5 shrink-0" />
          <span>Active: <strong className="font-semibold">{activeCount}</strong></span>
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10"
            title="Pause All"
            aria-label="Pause all downloads"
            onClick={pauseAllDownloads}
          >
            <Pause className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10"
            title="Resume All"
            aria-label="Resume all downloads"
            onClick={resumeAllDownloads}
          >
            <Play className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
            title="Clear Completed"
            aria-label="Clear completed downloads"
            onClick={clearCompletedDownloads}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Right: Live speed, speed limit, theme toggles, Add Download */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-semibold shrink-0">
          <Activity className="h-3.5 w-3.5 animate-pulse shrink-0" />
          <span>{formatSpeed(globalSpeed, speedUnit)}</span>
        </div>

        <div className="flex items-center bg-muted/50 rounded-md border border-border px-2 py-0.5 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all text-xs h-7">
          <Gauge className="w-3.5 h-3.5 text-muted-foreground mr-1 shrink-0" />
          <input
            type="number"
            min="0"
            placeholder="Limit (KB/s)"
            aria-label="Download speed limit in kilobytes per second"
            className="bg-transparent border-none outline-none text-xs text-foreground placeholder:text-muted-foreground/60 w-18"
            value={limitInput}
            onChange={(e) => setLimitInput(e.target.value)}
            onBlur={(e) => {
              const kb = parseInt(e.target.value);
              setSpeedLimit(isNaN(kb) || kb <= 0 ? "0" : (kb * 1024).toString());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
          />
        </div>

        <div className="w-px h-4 bg-border shrink-0" />

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            title={resolvedTheme === "dark" ? "Switch to Light Theme" : "Switch to Dark Theme"}
            aria-label={resolvedTheme === "dark" ? "Switch to Light Theme" : "Switch to Dark Theme"}
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            {resolvedTheme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              "transition-colors",
              isPlayfulMode ? "text-primary bg-primary/10 hover:bg-primary/20" : "text-muted-foreground hover:text-foreground"
            )}
            title={isPlayfulMode ? "Disable Playful Mode" : "Enable Playful Mode 🐾"}
            aria-label={isPlayfulMode ? "Disable Playful Mode" : "Enable Playful Mode"}
            onClick={togglePlayfulMode}
          >
            <Cat className="h-3.5 w-3.5" />
          </Button>
        </div>

        <AddDownloadModal />
      </div>
    </header>
  );
}
