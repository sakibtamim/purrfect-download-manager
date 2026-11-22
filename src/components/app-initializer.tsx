"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAppStore } from "@/store";
import { invoke } from "@tauri-apps/api/core";
import { formatSpeed } from "@/lib/utils";

export function AppInitializer() {
  const pathname = usePathname();
  const setSelectedDownload = useAppStore((state) => state.setSelectedDownload);
  
  useEffect(() => {
    setSelectedDownload(null);
  }, [pathname, setSelectedDownload]);

  const active = useAppStore((state) => state.active);
  const globalSpeed = useAppStore((state) => state.globalSpeed);
  const speedUnit = useAppStore((state) => state.speedUnit);
  const showTaskbarProgress = useAppStore((state) => state.showTaskbarProgress);

  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      return;
    }

    if (showTaskbarProgress) {
      if (active.length > 0) {
        let total = 0;
        let completed = 0;
        for (const d of active) {
          total += Number(d.totalLength) || 0;
          completed += Number(d.completedLength) || 0;
        }
        const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
        invoke('set_taskbar_progress', { progress: pct, status: 'normal' }).catch(console.warn);
      } else {
        invoke('set_taskbar_progress', { progress: null, status: 'none' }).catch(console.warn);
      }
    } else {
      invoke('set_taskbar_progress', { progress: null, status: 'none' }).catch(console.warn);
    }

    const tooltip = active.length > 0
      ? `Purrfect DL: ${active.length} active (${formatSpeed(globalSpeed, speedUnit)})`
      : 'Purrfect DL — Ready';
    invoke('update_tray_tooltip', { tooltip }).catch(console.warn);
  }, [active, globalSpeed, speedUnit, showTaskbarProgress]);

  const fetchDownloads = useAppStore((state) => state.fetchDownloads);
  const stageDownload = useAppStore((state) => state.stageDownload);
  const initSettings = useAppStore((state) => state.initSettings);
  const pauseAllDownloads = useAppStore((state) => state.pauseAllDownloads);
  const resumeAllDownloads = useAppStore((state) => state.resumeAllDownloads);

  useEffect(() => {
    let active = true;
    const unlistens: (() => void)[] = [];
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      import('@tauri-apps/api/event').then(({ listen }) => {
        if (!active) return;
        listen('tray-pause-all', () => pauseAllDownloads()).then(f => {
          if (active) unlistens.push(f); else f();
        }).catch(console.warn);
        listen('tray-resume-all', () => resumeAllDownloads()).then(f => {
          if (active) unlistens.push(f); else f();
        }).catch(console.warn);
        listen<boolean>('tray-autostart-changed', (event) => {
          useAppStore.setState({ autoStart: event.payload });
        }).then(f => {
          if (active) unlistens.push(f); else f();
        }).catch(console.warn);
      });
    }
    return () => {
      active = false;
      unlistens.forEach(f => f());
    };
  }, [pauseAllDownloads, resumeAllDownloads]);

  useEffect(() => {
    // Initialize Settings
    initSettings();

    // Adaptive polling: 1s when downloads are active, 3s when idle to conserve system resources
    let timer: NodeJS.Timeout;
    let isRunning = true;
    const poll = async () => {
      if (!isRunning) return;
      await fetchDownloads();
      if (!isRunning) return;
      const hasActive = useAppStore.getState().active.length > 0;
      timer = setTimeout(poll, hasActive ? 1000 : 3000);
    };
    poll();
    
    // Listen for browser integration events
    let unlisten: (() => void) | undefined;
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      import('@tauri-apps/api/event').then(({ listen }) => {
        listen('browser-download', (event) => {
            const payload = event.payload as Record<string, unknown>;
            if (payload && typeof payload.url === 'string') {
                const headers = [];
                if (typeof payload.cookies === 'string') headers.push(`Cookie: ${payload.cookies}`);
                if (typeof payload.referrer === 'string') headers.push(`Referer: ${payload.referrer}`);
                if (typeof payload.userAgent === 'string') headers.push(`User-Agent: ${payload.userAgent}`);
                
                stageDownload({
                  url: payload.url,
                  sourceUrl: typeof payload.referrer === 'string' && payload.referrer ? payload.referrer : (typeof payload.url === 'string' ? payload.url : undefined),
                  headers,
                  filename: typeof payload.filename === 'string' ? payload.filename : undefined,
                  fileSize: typeof payload.fileSize === 'number' ? payload.fileSize : undefined,
                  checksum: typeof payload.checksum === 'object' && payload.checksum !== null ? (payload.checksum as import('@/lib/utils').DetectedChecksum) : undefined
                });
            }
        }).then(f => unlisten = f).catch(e => console.warn("Tauri event listen failed:", e));
      });
    }

    // Handle Drag & Drop
    const handleDragOver = (e: DragEvent) => e.preventDefault();
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      const url = e.dataTransfer?.getData('text/plain') || e.dataTransfer?.getData('text/uri-list');
      if (url && url.trim().startsWith('http')) {
        stageDownload({ url: url.trim(), headers: [] });
      }
    };
    
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      isRunning = false;
      clearTimeout(timer);
      if (unlisten) unlisten();
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [fetchDownloads, stageDownload, initSettings, pauseAllDownloads, resumeAllDownloads]);

  return null;
}
