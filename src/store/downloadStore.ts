import { create } from 'zustand';
import { aria2Client, Aria2Download } from '@/lib/aria2Client';

export interface DownloadState {
  active: Aria2Download[];
  completed: Aria2Download[];
  failed: Aria2Download[];
  globalSpeed: string;
  isPlayfulMode: boolean;
  
  togglePlayfulMode: () => void;
  fetchDownloads: () => Promise<void>;
  addDownload: (url: string) => Promise<void>;
  pauseDownload: (gid: string) => Promise<void>;
  resumeDownload: (gid: string) => Promise<void>;
  cancelDownload: (gid: string) => Promise<void>;
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

  addDownload: async (url: string) => {
    await aria2Client.addUri([url]);
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
  }
}));
