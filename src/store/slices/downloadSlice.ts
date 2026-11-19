import { StateCreator } from 'zustand';
import { aria2Client, Aria2Download } from '@/lib/aria2Client';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { Store, load } from '@tauri-apps/plugin-store';
import { Command } from '@tauri-apps/plugin-shell';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { formatChecksum, type DetectedChecksum } from '@/lib/utils';
import { DownloadState, StagedDownload } from '../types';

interface CachedMeta {
  totalLength: string;
  completedLength: string;
  addedAt?: number;
}

const mockMetaStore = new Map<string, unknown>();
let metaStoreCache: Store | null = null;

export async function getMetaStore(): Promise<Store> {
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

export interface DownloadDataSlice {
  active: Aria2Download[];
  completed: Aria2Download[];
  failed: Aria2Download[];
  globalSpeed: string;
  stagedDownload: StagedDownload | null;

  stageDownload: (download: StagedDownload) => Promise<void>;
  clearStagedDownload: () => void;
  fetchDownloads: () => Promise<void>;
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

export const createDownloadSlice: StateCreator<DownloadState, [], [], DownloadDataSlice> = (set, get) => ({
  active: [],
  completed: [],
  failed: [],
  globalSpeed: '0',
  stagedDownload: null,

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
      console.warn('Failed to focus window', e);
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
            title: 'New Download Ready',
            body: download.filename ? `Confirmation required for: ${download.filename}` : 'A new download requires your confirmation.'
          });
        }
      }
    } catch (e) {
      console.warn('Notification failed', e);
    }
  },

  clearStagedDownload: () => set({ stagedDownload: null }),

  fetchDownloads: async () => {
    try {
      const keys = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'dir', 'files', 'errorMessage', 'bitfield', 'numPieces', 'connections'];
      const active = await aria2Client.tellActive(keys);
      const waiting = await aria2Client.tellWaiting(0, 100, keys);
      const stopped = await aria2Client.tellStopped(0, 100, keys);
      const stats = await aria2Client.getGlobalStat();

      const combinedActive = [...active, ...waiting];
      const completed = stopped.filter(d => d.status === 'complete');
      const failed = stopped.filter(d => d.status === 'error' || d.status === 'removed');

      const metaStore = await getMetaStore();
      const allDownloads = [...combinedActive, ...completed, ...failed];
      let hasChanges = false;
      for (const dl of allDownloads) {
        const total = parseInt(dl.totalLength, 10);
        const done = parseInt(dl.completedLength, 10);

        let cached = await metaStore.get<CachedMeta>(dl.gid);

        if (!cached) {
          cached = { totalLength: dl.totalLength, completedLength: dl.completedLength, addedAt: Date.now() };
          await metaStore.set(dl.gid, cached);
          hasChanges = true;
        } else if (!cached.addedAt) {
          cached.addedAt = Date.now();
          await metaStore.set(dl.gid, cached);
          hasChanges = true;
        }

        if (total === 0 && cached.totalLength) {
          dl.totalLength = cached.totalLength;
        }
        if (done === 0 && cached.completedLength) {
          dl.completedLength = cached.completedLength;
        }

        dl.addedAt = cached.addedAt;

        if (total > 0 && (cached.totalLength !== dl.totalLength || (dl.status !== 'active' && cached.completedLength !== dl.completedLength))) {
          await metaStore.set(dl.gid, { ...cached, totalLength: dl.totalLength, completedLength: dl.completedLength } as CachedMeta);
          hasChanges = true;
        }
      }
      if (hasChanges) {
        await metaStore.save();
      }

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
        } catch (e) {
          console.warn('Notification failed', e);
        }
      };

      if (newCompleted.length > 0 && prevCompleted.length > 0) {
        const nonMuxCompleted = newCompleted.filter(c => !get().pendingMuxes.some(m => m.videoGid === c.gid || m.audioGid === c.gid));
        if (nonMuxCompleted.length > 0) {
          notify('Download Complete', `${nonMuxCompleted.length} file(s) finished downloading.`);
        }
      }
      if (newFailed.length > 0 && prevFailed.length > 0 && newFailed.some(f => f.status === 'error')) {
        notify('Download Failed', 'A download has failed or encountered an error.');
      }

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

                const ffmpegArgs = [
                  '-y',
                  '-i', vPath,
                  '-i', aPath,
                  '-c:v', 'copy',
                  '-c:a', 'copy',
                  finalPath
                ];

                const runFfmpeg = async () => {
                  try {
                    return await Command.sidecar('bin/pdm-ffmpeg', ffmpegArgs).execute();
                  } catch {
                    return await Command.create('system-ffmpeg', ffmpegArgs).execute();
                  }
                };

                runFfmpeg().then(output => {
                  if (output.code === 0) {
                    notify('Video Processing Complete', 'High-resolution video merged successfully.');
                    invoke('delete_downloaded_file', { path: vPath }).catch(console.error);
                    invoke('delete_downloaded_file', { path: aPath }).catch(console.error);
                    set(state => ({ pendingMuxes: state.pendingMuxes.filter(m => m !== mux) }));
                  } else {
                    notify('Video Processing Failed', 'Failed to merge video and audio tracks.');
                    mux.status = 'error';
                    set({ pendingMuxes: [...get().pendingMuxes] });
                  }
                }).catch(e => {
                  console.error('FFmpeg error:', e);
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
        err?.message?.includes('Failed to fetch') ||
        err?.message?.includes('fetch failed') ||
        err?.message?.includes('NetworkError') ||
        err?.message?.includes('Load failed');

      if (!isFetchError) {
        console.error('Failed to fetch aria2 status', error);
      }
    }
  },

  addDownload: async (url: string, headers: string[] = [], dir?: string, filename?: string, audioUrl?: string, checksum?: DetectedChecksum | string) => {
    const options: Record<string, string | string[]> = {
      'check-certificate': 'true',
      'split': '16',
      'max-connection-per-server': '16',
      'min-split-size': '1M'
    };
    if (headers.length > 0) {
      options['header'] = headers;
    }
    if (dir) {
      options['dir'] = dir;
    }
    if (checksum) {
      const formatted = formatChecksum(checksum);
      if (formatted) {
        options['checksum'] = formatted;
      }
    }

    let targetDir = dir || get().defaultDownloadDir;
    if (!targetDir) {
      try {
        const globalOpts = await aria2Client.getGlobalOption();
        targetDir = globalOpts['dir'] || '';
      } catch (e) {
        console.warn('Failed to get aria2c global dir', e);
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

      if (!finalFilename && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        try {
          const res = await tauriFetch(url, { method: 'HEAD' });
          const dispHeader = res.headers.get('content-disposition');
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
          console.warn('Failed to fetch HEAD for filename', e);
          try {
            finalFilename = new URL(url).pathname.split('/').pop() || undefined;
          } catch {}
        }
      }

      if (finalFilename) {
        if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
          finalFilename = await get().getUniqueFilename(finalFilename, targetDir);
        }
        options['out'] = finalFilename;
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
      if (dl.status === 'active' || dl.status === 'waiting' || dl.status === 'paused') {
        try { await aria2Client.remove(gid); } catch {}
      } else {
        try { await aria2Client.removeDownloadResult(gid); } catch {}
      }

      if (removeLocalFile && dl.files && dl.files.length > 0) {
        const customDir = get().defaultDownloadDir || undefined;
        for (const f of dl.files) {
          if (f.path) {
            try {
              await invoke('delete_downloaded_file', { path: f.path, customDir });
            } catch (e) {
              console.error('Failed to delete local file:', f.path, e);
            }
            if (dl.status !== 'complete') {
              try {
                await invoke('delete_downloaded_file', { path: f.path + '.aria2', customDir });
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
    await aria2Client.changeGlobalOption({ 'max-overall-download-limit': bytesPerSecond });
  },

  getUniqueFilename: async (name: string, dir?: string): Promise<string> => {
    let targetDir = dir || get().defaultDownloadDir;
    if (!targetDir) {
      try {
        const globalOpts = await aria2Client.getGlobalOption();
        targetDir = globalOpts['dir'] || '';
      } catch (e) {
        console.warn('Failed to get aria2c global dir', e);
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
      console.warn('Failed to check file existence', e);
    }
    return uniqueName;
  }
});
