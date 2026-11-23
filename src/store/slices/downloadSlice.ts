import { StateCreator } from 'zustand';
import { aria2Client, Aria2Download } from '@/lib/aria2Client';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { Store, load } from '@tauri-apps/plugin-store';
import { Command } from '@tauri-apps/plugin-shell';
import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { formatChecksum, decodeFilename, parseContentDispositionFilename, type DetectedChecksum } from '@/lib/utils';
import { calculateOptimalSplit } from '@/lib/networkOptimizer';
import { DownloadState, StagedDownload } from '../types';

interface CachedMeta {
  totalLength: string;
  completedLength: string;
  addedAt?: number;
  sourceUrl?: string;
  title?: string;
  path?: string;
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
        delete: async (key: string) => { mockMetaStore.delete(key); },
        save: async () => {},
        keys: async () => Array.from(mockMetaStore.keys()),
      } as unknown as Store;
    }
  }
  return metaStoreCache;
}

export function _resetMetaStoreForTesting() {
  metaStoreCache = null;
  mockMetaStore.clear();
}

export type EngineStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface DownloadDataSlice {
  active: Aria2Download[];
  completed: Aria2Download[];
  failed: Aria2Download[];
  globalSpeed: string;
  stagedDownload: StagedDownload | null;
  downloadMetadata: Record<string, { sourceUrl?: string; title?: string }>;
  engineStatus: EngineStatus;
  engineError: string | null;

  setEngineStatus: (status: EngineStatus, error?: string | null) => void;
  stageDownload: (download: StagedDownload) => Promise<void>;
  clearStagedDownload: () => void | Promise<void>;
  fetchDownloads: () => Promise<void>;
  addDownload: (url: string, headers?: string[], dir?: string, filename?: string, audioUrl?: string, checksum?: DetectedChecksum | string, sourceUrl?: string, fileSize?: number) => Promise<void>;
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
  downloadMetadata: {},
  engineStatus: 'connecting',
  engineError: null,

  setEngineStatus: (status, error) => {
    set({
      engineStatus: status,
      engineError: error ?? null,
    });
  },

  stageDownload: async (download) => {
    set({ stagedDownload: download });

    try {
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        try {
          await invoke('raise_window');
        } catch {
          // fallback
        }
        const appWindow = getCurrentWindow();
        await appWindow.unminimize();
        await appWindow.show();
        await appWindow.setAlwaysOnTop(true);
        await appWindow.setFocus();
        try {
          await appWindow.requestUserAttention(UserAttentionType.Critical);
        } catch {
          // ignore if platform does not support user attention
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

  clearStagedDownload: async () => {
    set({ stagedDownload: null });
    try {
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        const appWindow = getCurrentWindow();
        await appWindow.setAlwaysOnTop(false);
      }
    } catch (e) {
      console.warn('Failed to reset always on top', e);
    }
  },

  fetchDownloads: async () => {
    try {
      const keys = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'dir', 'files', 'errorMessage', 'bitfield', 'numPieces', 'connections', 'pieceLength'];
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
      const metadataUpdates: Record<string, { sourceUrl?: string; title?: string }> = { ...get().downloadMetadata };

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

        if (cached.path && dl.files && dl.files.length > 0) {
          dl.files = dl.files.map(f => ({ ...f, path: cached.path! }));
        }

        if (cached.sourceUrl || cached.title) {
          if (!metadataUpdates[dl.gid]) {
            metadataUpdates[dl.gid] = {
              sourceUrl: cached.sourceUrl,
              title: cached.title
            };
          }
        }

        if (total > 0 && (cached.totalLength !== dl.totalLength || (dl.status !== 'active' && cached.completedLength !== dl.completedLength))) {
          await metaStore.set(dl.gid, { ...cached, totalLength: dl.totalLength, completedLength: dl.completedLength } as CachedMeta);
          hasChanges = true;
        }
      }
      if (hasChanges) {
        await metaStore.save();
      }

      const prevCompleted = get().completed || [];
      const prevFailed = get().failed || [];

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

      const pendingMuxes = get().pendingMuxes || [];
      const audioGidSet = new Set(pendingMuxes.map(m => m.audioGid));
      const videoMuxMap = new Map(pendingMuxes.map(m => [m.videoGid, m]));

      if (newCompleted.length > 0 && prevCompleted.length > 0) {
        const nonMuxCompleted = newCompleted.filter(c => !pendingMuxes.some(m => m.videoGid === c.gid || m.audioGid === c.gid));
        if (nonMuxCompleted.length > 0) {
          notify('Download Complete', `${nonMuxCompleted.length} file(s) finished downloading.`);
        }
      }
      if (newFailed.length > 0 && prevFailed.length > 0 && newFailed.some(f => f.status === 'error')) {
        notify('Download Failed', 'A download has failed or encountered an error.');
      }

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
                const targetDir = (vComplete.dir || get().defaultDownloadDir || '').replace(/\\/g, '/').replace(/\/+$/, '');
                const finalPath = targetDir && mux.finalFilename ? `${targetDir}/${mux.finalFilename}` : (vPath.replace(/\.video\.[^.]+$/, '') + '.mp4');

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
                    const isStillPending = get().pendingMuxes.some(m => m.videoGid === mux.videoGid);
                    const muxTargetDir = vComplete.dir || get().defaultDownloadDir || undefined;

                    if (!isStillPending) {
                      invoke('delete_downloaded_file', { path: finalPath, customDir: muxTargetDir }).catch(() => {});
                      invoke('delete_downloaded_file', { path: vPath, customDir: muxTargetDir }).catch(() => {});
                      invoke('delete_downloaded_file', { path: aPath, customDir: muxTargetDir }).catch(() => {});
                      invoke('delete_downloaded_file', { path: `${vPath}.aria2`, customDir: muxTargetDir }).catch(() => {});
                      invoke('delete_downloaded_file', { path: `${aPath}.aria2`, customDir: muxTargetDir }).catch(() => {});
                      return;
                    }

                    notify('Video Processing Complete', 'High-resolution video merged successfully.');
                    invoke('delete_downloaded_file', { path: vPath, customDir: muxTargetDir }).catch(console.error);
                    invoke('delete_downloaded_file', { path: aPath, customDir: muxTargetDir }).catch(console.error);
                    invoke('delete_downloaded_file', { path: `${vPath}.aria2`, customDir: muxTargetDir }).catch(() => {});
                    invoke('delete_downloaded_file', { path: `${aPath}.aria2`, customDir: muxTargetDir }).catch(() => {});
                    aria2Client.removeDownloadResult(mux.audioGid).catch(console.warn);

                    getMetaStore().then(async metaStore => {
                      try {
                        const cached = await metaStore.get<CachedMeta>(mux.videoGid) || { totalLength: '0', completedLength: '0' };
                        await metaStore.set(mux.videoGid, { ...cached, path: finalPath, title: mux.finalFilename });
                        await metaStore.delete(mux.audioGid);
                        await metaStore.save();
                      } catch (err) {
                        console.warn('Failed to update metaStore after mux:', err);
                      }
                    });

                    set(state => {
                      const videoItem = state.active.find(a => a.gid === mux.videoGid) || state.completed.find(c => c.gid === mux.videoGid);
                      const updatedVideo: Aria2Download | null = videoItem ? {
                        ...videoItem,
                        status: 'complete',
                        files: videoItem.files.map(f => ({ ...f, path: finalPath }))
                      } : null;

                      return {
                        pendingMuxes: state.pendingMuxes.filter(m => m !== mux),
                        active: state.active.filter(a => a.gid !== mux.videoGid && a.gid !== mux.audioGid),
                        completed: [
                          ...state.completed.filter(c => c.gid !== mux.audioGid && c.gid !== mux.videoGid),
                          ...(updatedVideo ? [updatedVideo] : [])
                        ]
                      };
                    });
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

      // Filter out any companion audio download from UI lists
      const filteredActive = combinedActive.filter(dl => !audioGidSet.has(dl.gid));
      let filteredCompleted = completed.filter(dl => !audioGidSet.has(dl.gid));
      const filteredFailed = failed.filter(dl => !audioGidSet.has(dl.gid));

      const processMuxedVideo = (dl: Aria2Download) => {
        if (!videoMuxMap.has(dl.gid)) return;
        const mux = videoMuxMap.get(dl.gid)!;
        const companionAudio = allDownloads.find(d => d.gid === mux.audioGid);

        const vTotal = parseInt(dl.totalLength || '0', 10);
        const aTotal = companionAudio ? parseInt(companionAudio.totalLength || '0', 10) : 0;
        const vDone = parseInt(dl.completedLength || '0', 10);
        const aDone = companionAudio ? parseInt(companionAudio.completedLength || '0', 10) : 0;
        const vSpeed = parseInt(dl.downloadSpeed || '0', 10);
        const aSpeed = companionAudio ? parseInt(companionAudio.downloadSpeed || '0', 10) : 0;

        dl.totalLength = String(vTotal + aTotal);
        dl.completedLength = String(vDone + aDone);
        dl.downloadSpeed = String(vSpeed + aSpeed);

        if (mux.finalFilename && dl.files && dl.files.length > 0) {
          const currentPath = dl.files[0].path;
          const lastSlash = Math.max(currentPath.lastIndexOf('/'), currentPath.lastIndexOf('\\'));
          const dir = lastSlash !== -1 ? currentPath.substring(0, lastSlash + 1) : (dl.dir ? (dl.dir.endsWith('/') ? dl.dir : `${dl.dir}/`) : '');
          dl.files[0] = {
            ...dl.files[0],
            path: dir ? `${dir}${mux.finalFilename}` : mux.finalFilename
          };
        }

        if (mux.status === 'muxing') {
          dl.status = 'muxing';
        }
      };

      filteredActive.forEach(processMuxedVideo);
      filteredCompleted.forEach(processMuxedVideo);
      filteredFailed.forEach(processMuxedVideo);

      // Keep actively muxing video in active downloads so user sees progress
      const activelyMuxing = filteredCompleted.filter(d => (d.status as string) === 'muxing');
      if (activelyMuxing.length > 0) {
        filteredCompleted = filteredCompleted.filter(d => (d.status as string) !== 'muxing');
        for (const dl of activelyMuxing) {
          if (!filteredActive.some(a => a.gid === dl.gid)) {
            filteredActive.push(dl);
          }
        }
      }

      set({
        active: filteredActive,
        completed: filteredCompleted,
        failed: filteredFailed,
        globalSpeed: stats.downloadSpeed,
        downloadMetadata: metadataUpdates,
        engineStatus: 'connected',
        engineError: null,
      });
    } catch (error) {
      const err = error as Error;
      const priorError = get().engineError;
      const errorMessage = priorError || err?.message || 'Failed to connect to aria2 engine';

      set({
        engineStatus: 'error',
        engineError: errorMessage,
      });

      console.error('Failed to fetch aria2 status:', errorMessage, error);
    }
  },

  addDownload: async (url: string, headers: string[] = [], dir?: string, filename?: string, audioUrl?: string, checksum?: DetectedChecksum | string, sourceUrl?: string, fileSize?: number) => {
    if (url.includes('.m3u8') || url.includes('/hls_playlist/')) {
      console.warn('Attempted to download HLS manifest directly with aria2:', url);
    }

    let resolvedFileSize = fileSize;
    const { split, maxConnectionPerServer, minSplitSize } = calculateOptimalSplit({
      fileSize: resolvedFileSize,
      url,
      sourceUrl,
      userSetting: get().splitConnections,
      dynamicEnabled: get().dynamicConnections
    });

    const isMediaStream = Boolean(
      url.includes('googlevideo.com') ||
      (sourceUrl && (sourceUrl.includes('youtube.com') || sourceUrl.includes('youtu.be'))) ||
      url.includes('youtube.com') ||
      url.includes('youtu.be')
    );

    const hasUserAgent = headers.some(h => h.toLowerCase().startsWith('user-agent:'));
    const effectiveHeaders = [...headers];
    if (isMediaStream && !hasUserAgent) {
      effectiveHeaders.push('User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');
    }

    const options: Record<string, string | string[]> = {
      'check-certificate': 'true',
      'split': String(split),
      'max-connection-per-server': String(maxConnectionPerServer),
      'min-split-size': minSplitSize
    };
    if (effectiveHeaders.length > 0) {
      options['header'] = effectiveHeaders;
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

      const metaUpdates: Record<string, { sourceUrl?: string; title?: string }> = {};
      if (sourceUrl || filename) {
        metaUpdates[videoGid] = { sourceUrl, title: filename };
        metaUpdates[audioGid] = { sourceUrl, title: filename };
      }

      set(state => ({
        downloadMetadata: { ...state.downloadMetadata, ...metaUpdates },
        pendingMuxes: [...state.pendingMuxes, {
          videoGid,
          audioGid,
          finalFilename: finalFilename,
          status: 'waiting'
        }]
      }));

      if (sourceUrl || filename) {
        try {
          const metaStore = await getMetaStore();
          await metaStore.set(videoGid, { sourceUrl, title: filename, totalLength: '0', completedLength: '0', addedAt: Date.now() });
          await metaStore.set(audioGid, { sourceUrl, title: filename, totalLength: '0', completedLength: '0', addedAt: Date.now() });
          await metaStore.save();
        } catch (e) {
          console.warn('Failed to save download meta to store', e);
        }
      }
    } else {
      let finalFilename = filename ? decodeFilename(filename) : undefined;

      if (!finalFilename && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        try {
          const res = await tauriFetch(url, { method: 'HEAD' });
          const cl = res.headers.get('content-length');
          if (cl && !resolvedFileSize) {
            const parsed = parseInt(cl, 10);
            if (!isNaN(parsed) && parsed > 0) {
              resolvedFileSize = parsed;
              const recomputed = calculateOptimalSplit({
                fileSize: resolvedFileSize,
                url,
                sourceUrl,
                userSetting: get().splitConnections,
                dynamicEnabled: get().dynamicConnections
              });
              options['split'] = String(recomputed.split);
              options['max-connection-per-server'] = String(recomputed.maxConnectionPerServer);
              options['min-split-size'] = recomputed.minSplitSize;
            }
          }
          const dispHeader = res.headers.get('content-disposition');
          if (dispHeader) {
            const parsed = parseContentDispositionFilename(dispHeader);
            if (parsed) {
              finalFilename = parsed;
            }
          }
          if (!finalFilename) {
            const pathname = new URL(res.url || url).pathname;
            const extracted = pathname.split('/').pop();
            finalFilename = extracted ? decodeFilename(extracted) : undefined;
          }
        } catch (e) {
          console.warn('Failed to fetch HEAD for filename', e);
          try {
            const fallback = new URL(url).pathname.split('/').pop();
            finalFilename = fallback ? decodeFilename(fallback) : undefined;
          } catch (err) {
            console.warn('Failed to parse fallback URL for filename', err);
          }
        }
      }

      if (finalFilename) {
        if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
          finalFilename = await get().getUniqueFilename(finalFilename, targetDir);
        }
        options['out'] = finalFilename;
      }
      const gid = await aria2Client.addUri([url], options);

      if (sourceUrl || finalFilename) {
        set(state => ({
          downloadMetadata: {
            ...state.downloadMetadata,
            [gid]: { sourceUrl, title: finalFilename }
          }
        }));
        try {
          const metaStore = await getMetaStore();
          await metaStore.set(gid, { sourceUrl, title: finalFilename, totalLength: '0', completedLength: '0', addedAt: Date.now() });
          await metaStore.save();
        } catch (e) {
          console.warn('Failed to save download meta to store', e);
        }
      }
    }

    await get().fetchDownloads();
  },

  pauseDownload: async (gid: string) => {
    const pendingMuxes = get().pendingMuxes || [];
    const mux = pendingMuxes.find(m => m.videoGid === gid);
    try {
      await aria2Client.pause(gid);
    } catch (e) {
      console.warn('Failed to pause video download', e);
    }
    if (mux) {
      try {
        await aria2Client.pause(mux.audioGid);
      } catch (e) {
        console.warn('Failed to pause companion audio download', e);
      }
    }
    await get().fetchDownloads();
  },

  resumeDownload: async (gid: string) => {
    const pendingMuxes = get().pendingMuxes || [];
    const mux = pendingMuxes.find(m => m.videoGid === gid);
    try {
      await aria2Client.unpause(gid);
    } catch (e) {
      console.warn('Failed to unpause video download', e);
    }
    if (mux) {
      try {
        await aria2Client.unpause(mux.audioGid);
      } catch (e) {
        console.warn('Failed to unpause companion audio download', e);
      }
    }
    await get().fetchDownloads();
  },

  cancelDownload: async (gid: string) => {
    const pendingMuxes = get().pendingMuxes || [];
    const mux = pendingMuxes.find(m => m.videoGid === gid);
    try {
      await aria2Client.remove(gid);
    } catch (e) {
      console.warn('Failed to remove video download', e);
    }
    if (mux) {
      try {
        await aria2Client.remove(mux.audioGid);
      } catch (e) {
        console.warn('Failed to remove companion audio download', e);
      }
      set(state => ({
        pendingMuxes: state.pendingMuxes.filter(m => m !== mux)
      }));
    }
    await get().fetchDownloads();
  },

  deleteDownload: async (gid: string, removeLocalFile: boolean) => {
    const state = get();
    const pendingMuxes = state.pendingMuxes || [];
    const mux = pendingMuxes.find(m => m.videoGid === gid || m.audioGid === gid);
    const companionGid = mux ? (mux.videoGid === gid ? mux.audioGid : mux.videoGid) : null;

    const allDownloads = [...state.active, ...state.completed, ...state.failed];
    const dl = allDownloads.find(d => d.gid === gid);
    const companionDl = companionGid ? allDownloads.find(d => d.gid === companionGid) : null;

    const removeAriaTask = async (taskGid: string, taskStatus?: string) => {
      if (taskStatus === 'active' || taskStatus === 'waiting' || taskStatus === 'paused') {
        try { await aria2Client.remove(taskGid); } catch {}
      }
      try { await aria2Client.removeDownloadResult(taskGid); } catch {}
    };

    if (dl) {
      await removeAriaTask(gid, dl.status);
    }
    if (companionGid) {
      await removeAriaTask(companionGid, companionDl?.status);
    }

    const metaStore = await getMetaStore();
    const cachedMeta = await metaStore.get<CachedMeta>(gid);
    const companionCachedMeta = companionGid ? await metaStore.get<CachedMeta>(companionGid) : null;

    if (removeLocalFile) {
      const taskDir = dl?.dir || companionDl?.dir || get().defaultDownloadDir || undefined;
      const pathsToDelete = new Set<string>();

      // 1. Collect files from active/completed download objects
      const allTargetFiles = [...(dl?.files || []), ...(companionDl?.files || [])];
      for (const f of allTargetFiles) {
        if (f.path) {
          pathsToDelete.add(f.path);
        }
      }

      // 2. Collect cached path from metadata store (handles muxed destination path)
      if (cachedMeta?.path) {
        pathsToDelete.add(cachedMeta.path);
      }
      if (companionCachedMeta?.path) {
        pathsToDelete.add(companionCachedMeta.path);
      }

      // 3. Address path desync for muxed streams (both pending and completed)
      if (mux?.finalFilename) {
        const baseDir = taskDir || '';
        const lastDot = mux.finalFilename.lastIndexOf('.');
        const baseName = lastDot !== -1 ? mux.finalFilename.substring(0, lastDot) : mux.finalFilename;
        const ext = lastDot !== -1 ? mux.finalFilename.substring(lastDot + 1) : 'mp4';

        if (baseDir) {
          const normBaseDir = baseDir.replace(/\\/g, '/').replace(/\/+$/, '');
          pathsToDelete.add(`${normBaseDir}/${mux.finalFilename}`);
          pathsToDelete.add(`${normBaseDir}/${baseName}.video.${ext}`);
          pathsToDelete.add(`${normBaseDir}/${baseName}.video.mp4`);
          pathsToDelete.add(`${normBaseDir}/${baseName}.video.webm`);
          pathsToDelete.add(`${normBaseDir}/${baseName}.video.mkv`);
          pathsToDelete.add(`${normBaseDir}/${baseName}.audio.m4a`);
        }
      }

      // For any collected video/audio path, also derive candidate complementary streams
      for (const p of Array.from(pathsToDelete)) {
        if (/\.video\.[^.]+$/.test(p)) {
          pathsToDelete.add(p.replace(/\.video\.[^.]+$/, '') + '.mp4');
          pathsToDelete.add(p.replace(/\.video\.[^.]+$/, '') + '.audio.m4a');
        } else if (/\.audio\.[^.]+$/.test(p)) {
          pathsToDelete.add(p.replace(/\.audio\.[^.]+$/, '') + '.mp4');
          pathsToDelete.add(p.replace(/\.audio\.[^.]+$/, '') + '.video.mp4');
        } else if (/\.(mp4|mkv|webm)$/i.test(p)) {
          const base = p.replace(/\.[^.]+$/, '');
          pathsToDelete.add(`${base}.video.mp4`);
          pathsToDelete.add(`${base}.video.webm`);
          pathsToDelete.add(`${base}.video.mkv`);
          pathsToDelete.add(`${base}.audio.m4a`);
        }
      }

      // 4. Support multi-file directory deletion
      if (allTargetFiles.length >= 1 && taskDir) {
        const normTaskDir = taskDir.replace(/\\/g, '/').replace(/\/+$/, '');
        const normTaskDirLower = normTaskDir.toLowerCase();
        const subDirs = new Set<string>();
        let hasRootFiles = false;

        for (const f of allTargetFiles) {
          if (f.path) {
            const normPath = f.path.replace(/\\/g, '/');
            const normPathLower = normPath.toLowerCase();
            const isSubPath = normPath.startsWith(normTaskDir + '/') ||
              (normTaskDir.includes(':') && normPathLower.startsWith(normTaskDirLower + '/'));

            if (isSubPath) {
              const rel = normPath.slice(normTaskDir.length + 1);
              const parts = rel.split('/');
              if (parts.length > 1) {
                subDirs.add(`${normTaskDir}/${parts[0]}`);
              } else {
                hasRootFiles = true;
              }
            }
          }
        }

        if (!hasRootFiles && subDirs.size === 1) {
          const multiFileFolder = Array.from(subDirs)[0];
          pathsToDelete.add(multiFileFolder);
        }
      }

      // 5. Delete all candidate files, folders, and .aria2 control files
      for (const filePath of Array.from(pathsToDelete)) {
        try {
          await invoke('delete_downloaded_file', { path: filePath, customDir: taskDir });
        } catch (e) {
          console.error('Failed to delete local file:', filePath, e);
        }
        try {
          await invoke('delete_downloaded_file', { path: `${filePath}.aria2`, customDir: taskDir });
        } catch {}
      }
    }

    const nextMeta = { ...get().downloadMetadata };
    delete nextMeta[gid];
    if (companionGid) {
      delete nextMeta[companionGid];
    }

    try {
      await metaStore.delete(gid);
      if (companionGid) {
        await metaStore.delete(companionGid);
      }
      await metaStore.save();
    } catch (e) {
      console.warn('Failed to delete metadata from store:', e);
    }

    if (mux) {
      set(s => ({
        pendingMuxes: s.pendingMuxes.filter(m => m !== mux),
        downloadMetadata: nextMeta
      }));
    } else {
      set({ downloadMetadata: nextMeta });
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
    const completedList = get().completed || [];
    const pendingMuxes = get().pendingMuxes || [];
    const pendingMuxGids = new Set(pendingMuxes.flatMap(m => [m.videoGid, m.audioGid]));

    // Identify completed downloads that are not currently part of an active mux merge
    const gidsToDelete = new Set<string>();
    for (const d of completedList) {
      if (!pendingMuxGids.has(d.gid)) {
        gidsToDelete.add(d.gid);
      }
    }

    await aria2Client.purgeDownloadResult();
    await get().fetchDownloads();

    try {
      const metaStore = await getMetaStore();

      if (typeof metaStore.keys === 'function') {
        const allKeys = await metaStore.keys();
        const activeOrWaitingGids = new Set([
          ...(get().active || []).map(d => d.gid),
          ...(get().failed || []).map(d => d.gid),
          ...pendingMuxGids,
        ]);
        for (const key of allKeys) {
          if (!activeOrWaitingGids.has(key)) {
            gidsToDelete.add(key);
          }
        }
      }

      // Explicitly protect any GIDs associated with in-flight pending muxes
      for (const gid of pendingMuxGids) {
        gidsToDelete.delete(gid);
      }

      if (gidsToDelete.size > 0) {
        for (const gid of gidsToDelete) {
          await metaStore.delete(gid);
        }
        await metaStore.save();

        const currentMeta = { ...get().downloadMetadata };
        for (const gid of gidsToDelete) {
          delete currentMeta[gid];
        }
        set({ downloadMetadata: currentMeta });
      }
    } catch (e) {
      console.warn('Failed to clean up completed downloads metadata from store:', e);
    }
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
