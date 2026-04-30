"use client";

import { useEffect } from "react";
import { useDownloadStore } from "@/store/downloadStore";

export function AppInitializer() {
  const fetchDownloads = useDownloadStore(state => state.fetchDownloads);

  useEffect(() => {
    // Initial fetch
    fetchDownloads();

    // Poll every 1 second
    const interval = setInterval(() => {
      fetchDownloads();
    }, 1000);

    return () => clearInterval(interval);
  }, [fetchDownloads]);

  return null;
}
