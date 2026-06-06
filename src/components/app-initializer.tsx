"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useDownloadStore } from "@/store/downloadStore";

export function AppInitializer() {
  const pathname = usePathname();
  const setSelectedDownload = useDownloadStore(state => state.setSelectedDownload);
  
  useEffect(() => {
    setSelectedDownload(null);
  }, [pathname, setSelectedDownload]);

  const fetchDownloads = useDownloadStore(state => state.fetchDownloads);
  const stageDownload = useDownloadStore(state => state.stageDownload);
  const initSettings = useDownloadStore(state => state.initSettings);
  const pauseAllDownloads = useDownloadStore(state => state.pauseAllDownloads);
  const resumeAllDownloads = useDownloadStore(state => state.resumeAllDownloads);

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

    // Initial fetch
    fetchDownloads();

    // Poll every 1 second
    const interval = setInterval(() => {
      fetchDownloads();
    }, 1000);
    
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
      clearInterval(interval);
      if (unlisten) unlisten();
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [fetchDownloads, stageDownload, initSettings, pauseAllDownloads, resumeAllDownloads]);

  return null;
}
