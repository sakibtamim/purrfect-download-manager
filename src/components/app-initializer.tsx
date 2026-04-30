"use client";

import { useEffect } from "react";
import { useDownloadStore } from "@/store/downloadStore";

export function AppInitializer() {
  const fetchDownloads = useDownloadStore(state => state.fetchDownloads);
  const addDownload = useDownloadStore(state => state.addDownload);

  useEffect(() => {
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
            const payload: any = event.payload;
            if (payload && payload.url) {
                addDownload(payload.url);
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
        addDownload(url.trim());
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
  }, [fetchDownloads, addDownload]);

  return null;
}
