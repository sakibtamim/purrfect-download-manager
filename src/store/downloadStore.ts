import { create } from 'zustand';
import { aria2Client, Aria2Download } from '@/lib/aria2Client';
import { YtDlpFormat } from '@/lib/ytdlpClient';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { Store, load } from '@tauri-apps/plugin-store';
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from '@tauri-apps/plugin-autostart';
import { Command } from '@tauri-apps/plugin-shell';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { formatChecksum, type DetectedChecksum } from '@/lib/utils';

const mockStore = new Map<string, unknown>();
let settingsStoreCache: Store | null = null;
async function getStore() {
  if (!settingsStoreCache) {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      settingsStoreCache = await load('settings.json');
    } else {
      settingsStoreCache = {
        get: async <T>(key: string) => (mockStore.get(key) ?? null) as T | null,
        set: async (key: string, value: unknown) => { mockStore.set(key, value); },
        save: async () => {}
      } as unknown as Store;
    }
  }
  return settingsStoreCache;
}

// Persisted download metadata cache — survives app restarts
interface CachedMeta { totalLength: string; completedLength: string; }
const mockMetaStore = new Map<string, unknown>();
let metaStoreCache: Store | null = null;
async function getMetaStore() {
  if (!metaStoreCache) {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      metaStoreCache = await load('download-meta.json');
    } else {
      metaStoreCache = {
        get: async <T>(key: string) => (mockMetaStore.get(key) ?? null) as T | null,
        set: async (key: string, value: unknown) => { mockMetaStore.set(key, value); },
        save: async () => {}
      } as unknown as Store;
    }
  }
  return metaStoreCache;
}

export interface StagedDownload {
  url: string;
  headers: string[];
  filename?: string;
  fileSize?: number;
  mediaFormats?: YtDlpFormat[];
  checksum?: DetectedChecksum;
}

export interface PendingMux {
  videoGid: string;
  audioGid: string;
  finalFilename: string;
  status: 'waiting' | 'muxing' | 'error';
}

export interface DownloadState {
  active: Aria2Download[];
  completed: Aria2Download[];
  failed: Aria2Download[];
  globalSpeed: string;
  isPlayfulMode: boolean;
  stagedDownload: StagedDownload | null;
  pendingMuxes: PendingMux[];
  selectedDownloadId: string | null;
  
  // Settings
  defaultDownloadDir: string;
  maxConcurrentDownloads: number;
  splitConnections: number;
  autoStart: boolean;
  safeBrowsingApiKey: string;

  initSettings: () => Promise<void>;
  setDefaultDownloadDir: (dir: string) => Promise<void>;
  setMaxConcurrentDownloads: (max: number) => Promise<void>;
  setSplitConnections: (split: number) => Promise<void>;
  setAutoStart: (enabled: boolean) => Promise<void>;
  setSafeBrowsingApiKey: (key: string) => Promise<void>;
  
  togglePlayfulMode: () => void;
  setSelectedDownload: (gid: string | null) => void;
  fetchDownloads: () => Promise<void>;
  stageDownload: (download: StagedDownload) => Promise<void>;
  clearStagedDownload: () => void;
  addDownload: (url: string, headers?: string[], dir?: string, filename?: string, audioUrl?: string, checksum?: DetectedChecksum | string) => Promise<void>;
  pauseDownload: (gid: string) => Promise<void>;
  resumeDownload: (gid: string) => Promise<void>;
  cancelDownload: (gid: string) => Promise<void>;
  deleteDownload: (gid: string, removeLocalFile: boolean) => Promise<void>;
  pauseAllDownloads: () => Promise<void>;
  resumeAllDownloads: () => Promise<void>;
  clearCompletedDownloads: () => Promise<void>;
  setSpeedLimit: (bytesPerSecond: string) => Promise<void>;
  getUniqueFilename: (name: string, dir?: string) => Promise<string>;
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  active: [],
  completed: [],
  failed: [],
  globalSpeed: "0",
  isPlayfulMode: false,
  stagedDownload: null,
  pendingMuxes: [],
  selectedDownloadId: null,

  defaultDownloadDir: "",
  maxConcurrentDownloads: 5,
  splitConnections: 1,
  autoStart: false,
  safeBrowsingApiKey: "",

  initSettings: async () => {
    // Load from Store
    const store = await getStore();
    const maxConcurrent = await store.get<number>("maxConcurrentDownloads") || 5;
    const split = await store.get<number>("splitConnections") || 1;
    const dir = await store.get<string>("defaultDownloadDir") || "";
    const apiKey = await store.get<string>("safeBrowsingApiKey") || "";
    
    // Auto start
    let autoStartEnabled = false;
    try {
      autoStartEnabled = await isAutostartEnabled();
    } catch {}

    set({
      maxConcurrentDownloads: maxConcurrent,
      splitConnections: split,
      defaultDownloadDir: dir,
      autoStart: autoStartEnabled,
      safeBrowsingApiKey: apiKey
    });

    // Sync with aria2
    try {
      await aria2Client.changeGlobalOption({
        "max-concurrent-downloads": maxConcurrent.toString(),
        "split": split.toString(),
        "max-connection-per-server": split.toString()
      });
    } catch {}
  },

  setDefaultDownloadDir: async (dir: string) => {
    const store = await getStore();
    await store.set("defaultDownloadDir", dir);
    await store.save();
    set({ defaultDownloadDir: dir });
  },

  setMaxConcurrentDownloads: async (max: number) => {
    const store = await getStore();
    await store.set("maxConcurrentDownloads", max);
    await store.save();
    set({ maxConcurrentDownloads: max });
    await aria2Client.changeGlobalOption({ "max-concurrent-downloads": max.toString() });
  },

  setSplitConnections: async (split: number) => {
    const store = await getStore();
    await store.set("splitConnections", split);
    await store.save();
    set({ splitConnections: split });
    await aria2Client.changeGlobalOption({ 
      "split": split.toString(),
      "max-connection-per-server": split.toString()
    });
  },

  setAutoStart: async (enabled: boolean) => {
    try {
      if (enabled) {
        await enableAutostart();
      } else {
        await disableAutostart();
      }
      set({ autoStart: enabled });
    } catch(e) {
      console.error("Failed to toggle autostart", e);
    }
  },

  setSafeBrowsingApiKey: async (key: string) => {
    const store = await getStore();
    await store.set("safeBrowsingApiKey", key);
    await store.save();
    set({ safeBrowsingApiKey: key });
  },

  togglePlayfulMode: () => set((state) => ({ isPlayfulMode: !state.isPlayfulMode })),
  setSelectedDownload: (gid) => set({ selectedDownloadId: gid }),
  
  stageDownload: async (download) => {
    set({ stagedDownload: download });
    
    try {
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        const appWindow = getCurrentWindow();
        await appWindow.unminimize();
        await appWindow.show();
        await appWindow.setAlwaysOnTop(true);
        try {
          await appWindow.setFocus();
        } finally {
          await appWindow.setAlwaysOnTop(false);
        }
      }
    } catch (e) {
      console.warn("Failed to focus window", e);
    }
    
    try {
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        let permissionGranted = await isPermissionGranted();
        if (!permissionGranted) {
          const permission = await requestPermission();
          permissionGranted = permission === 'granted';
        }
        if (permissionGranted) {
          sendNotification({ 
            title: "New Download Ready", 
            body: download.filename ? `Confirmation required for: ${download.filename}` : "A new download requires your confirmation."
          });
        }
      }
    } catch (e) {
      console.warn("Notification failed", e);
    }
  },

  clearStagedDownload: () => set({ stagedDownload: null }),

  fetchDownloads: async () => {
    try {
      const keys = ["gid", "status", "totalLength", "completedLength", "downloadSpeed", "dir", "files", "errorMessage"];
      const active = await aria2Client.tellActive(keys);
      const waiting = await aria2Client.tellWaiting(0, 100, keys);
      const stopped = await aria2Client.tellStopped(0, 100, keys);
      const stats = await aria2Client.getGlobalStat();

      const combinedActive = [...active, ...waiting];
      const completed = stopped.filter(d => d.status === 'complete');
      const failed = stopped.filter(d => d.status === 'error' || d.status === 'removed');

      // --- Metadata cache: persist sizes so session-restored paused downloads show correct values ---
      const metaStore = await getMetaStore();
      const allDownloads = [...combinedActive, ...completed, ...failed];
      for (const dl of allDownloads) {
        const total = parseInt(dl.totalLength, 10);
        const done = parseInt(dl.completedLength, 10);
        if (total > 0) {
          // Save known-good sizes to our cache
          await metaStore.set(dl.gid, { totalLength: dl.totalLength, completedLength: dl.completedLength } as CachedMeta);
        } else {
          // aria2c returned 0 — fill in from our cache
          const cached = await metaStore.get<CachedMeta>(dl.gid);
          if (cached) {
            dl.totalLength = cached.totalLength;
            if (done === 0) dl.completedLength = cached.completedLength;
          }
        }
      }
      await metaStore.save();

      const prevCompleted = get().completed;
      const prevFailed = get().failed;
      
      const newCompleted = completed.filter(c => !prevCompleted.find(p => p.gid === c.gid));
      const newFailed = failed.filter(f => !prevFailed.find(p => p.gid === f.gid));

      const notify = async (title: string, body: string) => {
        try {
          let permissionGranted = await isPermissionGranted();
          if (!permissionGranted) {
            const permission = await requestPermission();
            permissionGranted = permission === 'granted';
          }
          if (permissionGranted) {
            sendNotification({ title, body });
          }
        } catch(e) {
          console.warn("Notification failed", e);
        }
      };

      if (newCompleted.length > 0 && prevCompleted.length > 0) {
        // Only notify for completed downloads that aren't parts of a pending mux
        const nonMuxCompleted = newCompleted.filter(c => !get().pendingMuxes.some(m => m.videoGid === c.gid || m.audioGid === c.gid));
        if (nonMuxCompleted.length > 0) {
          notify("Download Complete", `${nonMuxCompleted.length} file(s) finished downloading.`);
        }
      }
      if (newFailed.length > 0 && prevFailed.length > 0 && newFailed.some(f => f.status === 'error')) {
        notify("Download Failed", "A download has failed or encountered an error.");
      }
      
      // Handle Muxing
      const { pendingMuxes } = get();
      if (pendingMuxes.length > 0) {
        const updatedMuxes = [...pendingMuxes];
        let stateChanged = false;
        
        for (let i = 0; i < updatedMuxes.length; i++) {
          const mux = updatedMuxes[i];
          if (mux.status === 'waiting') {
            const vComplete = completed.find(c => c.gid === mux.videoGid);
            const aComplete = completed.find(c => c.gid === mux.audioGid);
            
            if (vComplete && aComplete) {
              mux.status = 'muxing';
              stateChanged = true;
              
              const vPath = vComplete.files[0]?.path;
              const aPath = aComplete.files[0]?.path;
              
              if (vPath && aPath) {
                const finalPath = vPath.replace(/\.video\.[^.]+$/, '') + '.mp4';
                
                // Spawn FFmpeg
                Command.sidecar('bin/pdm-ffmpeg', [
                   '-y',
                   '-i', vPath,
                   '-i', aPath,
                   '-c:v', 'copy',
                   '-c:a', 'copy',
                   finalPath
                ]).execute().then(output => {
                   if (output.code === 0) {
                      notify("Video Processing Complete", `High-resolution video merged successfully.`);
                      invoke('delete_downloaded_file', { path: vPath }).catch(console.error);
                      invoke('delete_downloaded_file', { path: aPath }).catch(console.error);
                      set(state => ({ pendingMuxes: state.pendingMuxes.filter(m => m !== mux) }));
                   } else {
                      notify("Video Processing Failed", "Failed to merge video and audio tracks.");
                      mux.status = 'error';
                      set({ pendingMuxes: [...get().pendingMuxes] });
                   }
                }).catch(e => {
                   console.error("FFmpeg error:", e);
                   mux.status = 'error';
                   set({ pendingMuxes: [...get().pendingMuxes] });
                });
              }
            }
          }
        }
        if (stateChanged) {
          set({ pendingMuxes: updatedMuxes });
        }
      }

      set({ 
        active: combinedActive, 
        completed, 
        failed, 
        globalSpeed: stats.downloadSpeed 
      });
    } catch (error) {
      const err = error as Error;
      const isFetchError =
        err?.message?.includes("Failed to fetch") ||
        err?.message?.includes("fetch failed") ||
        err?.message?.includes("NetworkError") ||
        err?.message?.includes("Load failed");

      if (isFetchError) {
        // aria2 backend might not be running yet; suppress interval spam
      } else {
        console.error("Failed to fetch aria2 status", error);
      }
    }
  },

  addDownload: async (url: string, headers: string[] = [], dir?: string, filename?: string, audioUrl?: string, checksum?: DetectedChecksum | string) => {
    const options: Record<string, string | string[]> = {
      "check-certificate": "false"
    };
    if (headers.length > 0) {
      options["header"] = headers;
    }
    if (dir) {
      options["dir"] = dir;
    }
    if (checksum) {
      const formatted = formatChecksum(checksum);
      if (formatted) {
        options["checksum"] = formatted;
      }
    }
    
    let targetDir = dir || get().defaultDownloadDir;
    if (!targetDir) {
      try {
        const globalOpts = await aria2Client.getGlobalOption();
        targetDir = globalOpts["dir"] || "";
      } catch (e) {
        console.warn("Failed to get aria2c global dir", e);
      }
    }


    if (audioUrl && filename) {
      const lastDotIndex = filename.lastIndexOf('.');
      const hasExt = lastDotIndex !== -1;
      const base = hasExt ? filename.substring(0, lastDotIndex) : filename;
      const ext = hasExt ? filename.substring(lastDotIndex + 1) : 'mp4';
      
      let videoFilename = `${base}.video.${ext}`;
      let audioFilename = `${base}.audio.m4a`;
      let finalFilename = filename;
      
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        videoFilename = await get().getUniqueFilename(videoFilename, targetDir);
        audioFilename = await get().getUniqueFilename(audioFilename, targetDir);
        finalFilename = await get().getUniqueFilename(filename, targetDir);
      }
      
      const videoGid = await aria2Client.addUri([url], { ...options, out: videoFilename });
      const audioGid = await aria2Client.addUri([audioUrl], { ...options, out: audioFilename });
      
      set(state => ({
        pendingMuxes: [...state.pendingMuxes, {
          videoGid,
          audioGid,
          finalFilename: finalFilename,
          status: 'waiting'
        }]
      }));
    } else {
      let finalFilename = filename;
      
      // If no filename was provided, try to resolve one via HEAD request or URL parsing
      // so we can apply our `getUniqueFilename` logic and avoid aria2c's default `.1` suffix
      if (!finalFilename && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        try {
          const res = await tauriFetch(url, { method: "HEAD" });
          const dispHeader = res.headers.get("content-disposition");
          if (dispHeader) {
            const match = dispHeader.match(/filename="?([^"]+)"?/i);
            if (match && match[1]) {
              finalFilename = match[1].split(/[\/\\]/).pop() || undefined;
            }
          }
          if (!finalFilename) {
             const pathname = new URL(res.url || url).pathname;
             finalFilename = pathname.split('/').pop() || undefined;
          }
        } catch (e) {
           console.warn("Failed to fetch HEAD for filename", e);
           try {
             finalFilename = new URL(url).pathname.split('/').pop() || undefined;
           } catch {}
        }
      }

      if (finalFilename) {
        if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
          finalFilename = await get().getUniqueFilename(finalFilename, targetDir);
        }
        options["out"] = finalFilename;
      }
      await aria2Client.addUri([url], options);
    }
    
    await get().fetchDownloads();
  },

  pauseDownload: async (gid: string) => {
    await aria2Client.pause(gid);
    await get().fetchDownloads();
  },

  resumeDownload: async (gid: string) => {
    await aria2Client.unpause(gid);
    await get().fetchDownloads();
  },

  cancelDownload: async (gid: string) => {
    await aria2Client.remove(gid);
    await get().fetchDownloads();
  },

  deleteDownload: async (gid: string, removeLocalFile: boolean) => {
    const state = get();
    const allDownloads = [...state.active, ...state.completed, ...state.failed];
    const dl = allDownloads.find(d => d.gid === gid);

    if (dl) {
      if (dl.status === "active" || dl.status === "waiting" || dl.status === "paused") {
        try { await aria2Client.remove(gid); } catch {}
      } else {
        try { await aria2Client.removeDownloadResult(gid); } catch {}
      }
      
      if (removeLocalFile && dl.files && dl.files.length > 0) {
        for (const f of dl.files) {
          if (f.path) {
            try {
              await invoke('delete_downloaded_file', { path: f.path });
            } catch(e) {
              console.error("Failed to delete local file:", f.path, e);
            }
            if (dl.status !== "complete") {
              try {
                await invoke('delete_downloaded_file', { path: f.path + ".aria2" });
              } catch {}
            }
          }
        }
      }
    }

    await get().fetchDownloads();
  },

  pauseAllDownloads: async () => {
    await aria2Client.pauseAll();
    await get().fetchDownloads();
  },

  resumeAllDownloads: async () => {
    await aria2Client.unpauseAll();
    await get().fetchDownloads();
  },

  clearCompletedDownloads: async () => {
    await aria2Client.purgeDownloadResult();
    await get().fetchDownloads();
  },

  setSpeedLimit: async (bytesPerSecond: string) => {
    await aria2Client.changeGlobalOption({ "max-overall-download-limit": bytesPerSecond });
  },

  getUniqueFilename: async (name: string, dir?: string): Promise<string> => {
    let targetDir = dir || get().defaultDownloadDir;
    if (!targetDir) {
      try {
        const globalOpts = await aria2Client.getGlobalOption();
        targetDir = globalOpts["dir"] || "";
      } catch (e) {
        console.warn("Failed to get aria2c global dir", e);
      }
    }

    if (!targetDir || typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return name;
    let uniqueName = name;
    let counter = 1;
    
    const lastDotIndex = name.lastIndexOf('.');
    const hasExt = lastDotIndex !== -1 && lastDotIndex > 0;
    let base = hasExt ? name.substring(0, lastDotIndex) : name;
    const ext = hasExt ? name.substring(lastDotIndex) : '';

    const match = base.match(/ \((\d+)\)$/);
    if (match) {
      base = base.substring(0, base.length - match[0].length);
      counter = parseInt(match[1], 10) + 1;
    }

    try {
      while (await invoke('check_downloaded_file_exists', { path: await join(targetDir, uniqueName) })) {
        uniqueName = `${base} (${counter})${ext}`;
        counter++;
      }
    } catch (e) {
      console.warn("Failed to check file existence", e);
    }
    return uniqueName;
  }
}));
