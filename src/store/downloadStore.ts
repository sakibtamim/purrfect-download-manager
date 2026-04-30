import { create } from 'zustand';
import { aria2Client, Aria2Download } from '@/lib/aria2Client';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

export interface DownloadState {
  active: Aria2Download[];
  completed: Aria2Download[];
  failed: Aria2Download[];
  globalSpeed: string;
  isPlayfulMode: boolean;
  
  togglePlayfulMode: () => void;
  fetchDownloads: () => Promise<void>;
  addDownload: (url: string, headers?: string[]) => Promise<void>;
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

  togglePlayfulMode: () => set((state) => ({ isPlayfulMode: !state.isPlayfulMode })),

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

  addDownload: async (url: string, headers: string[] = []) => {
    const options: Record<string, any> = {
      "check-certificate": "false"
    };
    if (headers.length > 0) {
      options["header"] = headers;
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
