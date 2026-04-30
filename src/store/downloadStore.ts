import { create } from 'zustand';
import { aria2Client, Aria2Download } from '@/lib/aria2Client';
import { YtDlpFormat } from '@/lib/ytdlpClient';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { Store, load } from '@tauri-apps/plugin-store';
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from '@tauri-apps/plugin-autostart';

let settingsStoreCache: Store | null = null;
async function getStore() {
  if (!settingsStoreCache) {
    settingsStoreCache = await load('settings.json');
  }
  return settingsStoreCache;
}

export interface StagedDownload {
  url: string;
  headers: string[];
  filename?: string;
  fileSize?: number;
  mediaFormats?: YtDlpFormat[];
}

export interface DownloadState {
  active: Aria2Download[];
  completed: Aria2Download[];
  failed: Aria2Download[];
  globalSpeed: string;
  isPlayfulMode: boolean;
  stagedDownload: StagedDownload | null;
  
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
  fetchDownloads: () => Promise<void>;
  stageDownload: (download: StagedDownload) => void;
  clearStagedDownload: () => void;
  addDownload: (url: string, headers?: string[], dir?: string, filename?: string) => Promise<void>;
  pauseDownload: (gid: string) => Promise<void>;
  resumeDownload: (gid: string) => Promise<void>;
  cancelDownload: (gid: string) => Promise<void>;
  pauseAllDownloads: () => Promise<void>;
  resumeAllDownloads: () => Promise<void>;
  clearCompletedDownloads: () => Promise<void>;
  setSpeedLimit: (bytesPerSecond: string) => Promise<void>;
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  active: [],
  completed: [],
  failed: [],
  globalSpeed: "0",
  isPlayfulMode: false,
  stagedDownload: null,

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
    } catch(e) {}

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
    } catch(e) {}
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
  stageDownload: (download) => set({ stagedDownload: download }),
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
        notify("Download Complete", `${newCompleted.length} file(s) finished downloading.`);
      }
      if (newFailed.length > 0 && prevFailed.length > 0 && newFailed.some(f => f.status === 'error')) {
        notify("Download Failed", "A download has failed or encountered an error.");
      }

      set({ 
        active: combinedActive, 
        completed, 
        failed, 
        globalSpeed: stats.downloadSpeed 
      });
    } catch (error) {
      console.error("Failed to fetch aria2 status", error);
    }
  },

  addDownload: async (url: string, headers: string[] = [], dir?: string, filename?: string) => {
    const options: Record<string, any> = {
      "check-certificate": "false"
    };
    if (headers.length > 0) {
      options["header"] = headers;
    }
    if (dir) {
      options["dir"] = dir;
    }
    if (filename) {
      options["out"] = filename;
    }
    await aria2Client.addUri([url], options);
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
  }
}));
