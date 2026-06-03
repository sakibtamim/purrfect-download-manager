"use client";

import { useDownloadStore } from "@/store/downloadStore";
import { Activity, DownloadCloud, Gauge, Pause, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";
import { AddDownloadModal } from "./add-download-modal";

export function DashboardHeader() {
  const { active, globalSpeed, setSpeedLimit, pauseAllDownloads, resumeAllDownloads, clearCompletedDownloads } = useDownloadStore();
  const [limitInput, setLimitInput] = useState("");

  const formatSpeed = (bytesPerSec: string) => {
    const speed = parseInt(bytesPerSec, 10);
    if (isNaN(speed) || speed === 0) return "0 B/s";
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(speed) / Math.log(k));
    return parseFloat((speed / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-background/80 glass border-b border-border">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <DownloadCloud className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Active Downloads</p>
            <p className="text-2xl font-bold text-foreground">{active.length}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 mt-1 lg:mt-0">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-amber-500 dark:hover:text-amber-400" title="Pause All" onClick={pauseAllDownloads}>
            <Pause className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-emerald-500 dark:hover:text-emerald-400" title="Resume All" onClick={resumeAllDownloads}>
            <Play className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500 dark:hover:text-red-400" title="Clear Completed" onClick={clearCompletedDownloads}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        <div className="w-px h-10 bg-border hidden md:block"></div>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 rounded-lg">
            <Activity className="h-5 w-5 text-emerald-500 dark:text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Total Speed</p>
            <p className="text-2xl font-bold text-foreground">{formatSpeed(globalSpeed)}</p>
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <div className="flex items-center bg-muted rounded-lg border border-border px-3 py-1.5 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
          <Gauge className="w-4 h-4 text-muted-foreground mr-2" />
          <input 
            type="number"
            min="0"
            placeholder="Limit (KB/s)"
            className="bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground/50 w-24"
            value={limitInput}
            onChange={(e) => setLimitInput(e.target.value)}
            onBlur={(e) => {
              const kb = parseInt(e.target.value);
              setSpeedLimit(isNaN(kb) || kb <= 0 ? "0" : (kb * 1024).toString());
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
          />
        </div>
        <AddDownloadModal />
      </div>
    </div>
  );
}
