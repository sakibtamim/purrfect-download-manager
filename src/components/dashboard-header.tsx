"use client";

import { useDownloadStore } from "@/store/downloadStore";
import { Activity, DownloadCloud, Gauge } from "lucide-react";
import { useState } from "react";
import { AddDownloadModal } from "./add-download-modal";

export function DashboardHeader() {
  const activeDownloads = useDownloadStore(state => state.active);
  const globalSpeed = useDownloadStore(state => state.globalSpeed);
  const setSpeedLimit = useDownloadStore(state => state.setSpeedLimit);
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
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-zinc-950 border-b border-zinc-800">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-lg">
            <DownloadCloud className="h-5 w-5 text-indigo-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-400">Active Downloads</p>
            <p className="text-2xl font-bold text-zinc-100">{activeDownloads.length}</p>
          </div>
        </div>
        <div className="w-px h-10 bg-zinc-800 hidden md:block"></div>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 rounded-lg">
            <Activity className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-400">Total Speed</p>
            <p className="text-2xl font-bold text-zinc-100">{formatSpeed(globalSpeed)}</p>
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <div className="flex items-center bg-zinc-900 rounded-lg border border-zinc-800 px-3 py-1.5 focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/20 transition-all">
          <Gauge className="w-4 h-4 text-zinc-500 mr-2" />
          <input 
            type="number"
            min="0"
            placeholder="Limit (KB/s)"
            className="bg-transparent border-none outline-none text-sm text-zinc-100 placeholder:text-zinc-600 w-24"
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
