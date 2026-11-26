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

export interface CachedMeta {
  totalLength: string;
  completedLength: string;
  addedAt?: number;
  sourceUrl?: string;
  downloadUrl?: string;
  headers?: string[];
  isCorrupted?: boolean;
  fileCorrupt?: boolean;
  title?: string;
  path?: string;
  dir?: string;
  status?: string;
  fileMissing?: boolean;
  companionGid?: string;
  muxFinalFilename?: string;
  files?: { path: string; length: string; completedLength: string; uris: { status: string; uri: string }[] }[];
}

export const BINARY_MEDIA_EXTENSIONS = /\.(mkv|mp4|avi|mov|webm|flv|wmv|m4v|mpg|mpeg|zip|rar|7z|tar|gz|bz2|xz|exe|iso|dmg|bin|apk|msi)$/i;

const mockMetaStore = new Map<string, unknown>();
let metaStoreCache: Store | null = null;
let isInitialFetch = true;

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
  isInitialFetch = false;
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
  redownload: (gid: string) => Promise<void>;
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

      if (isInitialFetch) {
        isInitialFetch = false;
        if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && active.length > 0) {
          for (const dl of active) {
            try {
              await aria2Client.pause(dl.gid);
              dl.status = 'paused';
            } catch {}
          }
        }
      }

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

        if (dl.status === 'complete') {
          const resolvedDir = dl.dir || cached.dir;
          const resolvedFiles = (dl.files && dl.files.length > 0) ? dl.files : cached.files;
          const resolvedPath = cached.path || dl.files?.[0]?.path;
          const resolvedTitle = cached.title || (dl.files?.[0]?.path ? decodeFilename(dl.files[0].path.split(/[/\\]/).pop() || '') : undefined);
          const uriFromDl = dl.files?.[0]?.uris?.find(u => u.uri && !u.uri.includes('undefined') && u.uri !== 'Unknown URL')?.uri;
          const resolvedDownloadUrl = uriFromDl || cached.downloadUrl;
          const resolvedHeaders = cached.headers;

          // HTML Trap Detection: Check if media or binary file is under 4KB (masquerading HTML error page)
          const filePathOrTitle = resolvedPath || resolvedTitle || '';
          const totalBytes = parseInt(dl.totalLength || cached.totalLength || '0', 10);
          const isBinaryMedia = BINARY_MEDIA_EXTENSIONS.test(filePathOrTitle);
          const isHtmlTrap = isBinaryMedia && totalBytes > 0 && totalBytes < 4096;

          if (isHtmlTrap) {
            dl.fileCorrupt = true;
            dl.fileMissing = true;
            cached.isCorrupted = true;
            cached.fileCorrupt = true;
            cached.fileMissing = true;
          }

          if (
            cached.status !== 'complete' ||
            cached.dir !== resolvedDir ||
            cached.path !== resolvedPath ||
            cached.title !== resolvedTitle ||
            cached.downloadUrl !== resolvedDownloadUrl ||
            cached.isCorrupted !== (isHtmlTrap || Boolean(cached.isCorrupted)) ||
            (!cached.files && resolvedFiles) ||
            (resolvedFiles && cached.files && cached.files.length !== resolvedFiles.length)
          ) {
            cached = {
              ...cached,
              status: 'complete',
              dir: resolvedDir,
              files: resolvedFiles,
              path: resolvedPath,
              title: resolvedTitle,
              downloadUrl: resolvedDownloadUrl,
              headers: resolvedHeaders,
              isCorrupted: isHtmlTrap || Boolean(cached.isCorrupted),
              fileCorrupt: isHtmlTrap || Boolean(cached.fileCorrupt),
              fileMissing: isHtmlTrap ? true : cached.fileMissing,
            };
            await metaStore.set(dl.gid, cached);
            hasChanges = true;
          }
        }

        const targetPath = cached.path;
        if (targetPath && dl.files && dl.files.length > 0) {
          dl.files = dl.files.map(f => ({ ...f, path: targetPath }));
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
          cached = { ...cached, totalLength: dl.totalLength, completedLength: dl.completedLength };
          await metaStore.set(dl.gid, cached);
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

      const currentPendingMuxes = [...(get().pendingMuxes || [])];
      for (const dl of allDownloads) {
        const cached = await metaStore.get<CachedMeta>(dl.gid);
        if (cached?.companionGid && cached?.muxFinalFilename) { // agyis: no-mutant
          const alreadyTracked = currentPendingMuxes.some( // agyis: no-mutant
            m => (m.videoGid === dl.gid && m.audioGid === cached.companionGid) || // agyis: no-mutant
                 (m.videoGid === cached.companionGid && m.audioGid === dl.gid) // agyis: no-mutant
          );
          if (!alreadyTracked) {
            currentPendingMuxes.push({
              videoGid: dl.gid,
              audioGid: cached.companionGid,
              finalFilename: cached.muxFinalFilename,
              status: 'waiting',
            });
          }
        }
      }
      const pendingMuxes = currentPendingMuxes;
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

                const vTotal = parseInt(vComplete.totalLength || '0', 10);
                const aTotal = parseInt(aComplete.totalLength || '0', 10);
                const totalBytesToMux = (vTotal + aTotal) || 1;

                const ffmpegArgs = [
                  '-y',
                  '-progress', 'pipe:1',
                  '-i', vPath,
                  '-i', aPath,
                  '-c:v', 'copy',
                  '-c:a', 'copy',
                  finalPath
                ];

                const runFfmpeg = async (): Promise<{ code: number }> => {
                  return new Promise((resolve) => {
                    let cmd: Command<string>;
                    try {
                      cmd = Command.sidecar('bin/pdm-ffmpeg', ffmpegArgs);
                    } catch {
                      cmd = Command.create('system-ffmpeg', ffmpegArgs);
                    }

                    const onProgressData = (line: string) => {
                      const match = line.match(/total_size=(\d+)/);
                      if (match) {
                        const currentBytes = parseInt(match[1], 10);
                        if (!isNaN(currentBytes) && currentBytes > 0 && totalBytesToMux > 0) {
                          const pct = Math.min(99, Math.max(0, Math.round((currentBytes / totalBytesToMux) * 100)));
                          mux.progress = pct;
                          set(state => ({
                            pendingMuxes: state.pendingMuxes.map(m => m.videoGid === mux.videoGid ? { ...m, progress: pct } : m),
                            active: state.active.map(a => a.gid === mux.videoGid ? { ...a, muxProgress: pct } : a)
                          }));
                        }
                      }
                    };

                    cmd.stdout.on('data', onProgressData);
                    cmd.stderr.on('data', onProgressData);

                    cmd.on('close', data => {
                      resolve({ code: data.code ?? 0 });
                    });

                    cmd.on('error', err => {
                      console.error('FFmpeg error:', err);
                      resolve({ code: 1 });
                    });

                    cmd.spawn().catch(() => {
                      try {
                        const fallbackCmd = Command.create('system-ffmpeg', ffmpegArgs);
                        fallbackCmd.stdout.on('data', onProgressData);
                        fallbackCmd.stderr.on('data', onProgressData);
                        fallbackCmd.on('close', data => resolve({ code: data.code ?? 0 }));
                        fallbackCmd.on('error', () => resolve({ code: 1 }));
                        fallbackCmd.spawn().catch(() => resolve({ code: 1 }));
                      } catch {
                        resolve({ code: 1 });
                      }
                    });
                  });
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
                        const updatedFiles = cached.files && cached.files.length > 0
                          ? cached.files.map(f => ({ ...f, path: finalPath }))
                          : [{
                              path: finalPath,
                              length: cached.totalLength || '0',
                              completedLength: cached.completedLength || '0',
                              uris: cached.sourceUrl ? [{ status: 'used', uri: cached.sourceUrl }] : []
                            }];
                        const cachedUpdates: CachedMeta = {
                          ...cached,
                          status: 'complete',
                          path: finalPath,
                          title: mux.finalFilename,
                          files: updatedFiles,
                        };
                        delete cachedUpdates.companionGid;
                        delete cachedUpdates.muxFinalFilename;
                        await metaStore.set(mux.videoGid, cachedUpdates);
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
          dl.muxProgress = mux.progress ?? 0;
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

      if (typeof metaStore.keys === 'function') {
        const allStoreKeys = await metaStore.keys();
        const liveGids = new Set(allDownloads.map(d => d.gid));
        const pendingMuxGids = new Set(pendingMuxes.flatMap(m => [m.videoGid, m.audioGid]));
        const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
        let storeMutated = false;

        for (const key of allStoreKeys) {
          if (!liveGids.has(key) && !audioGidSet.has(key) && !pendingMuxGids.has(key)) {
            const cached = await metaStore.get<CachedMeta>(key);
            if (cached) {
              const isComplete = cached.status === 'complete' ||
                (!cached.status && Boolean(cached.totalLength) && cached.totalLength !== '0' && cached.totalLength === cached.completedLength);

              if (isComplete) {
                // Disk Reality Check: Verify candidate paths to ensure the file was not deleted from disk
                let resolvedFilePath: string | null = null;
                let resolvedDir = cached.dir;
                let isFileMissing = false;

                const checkPathOrTitle = cached.path || cached.title || '';
                const totalBytes = parseInt(cached.totalLength || '0', 10);
                const isBinaryMedia = BINARY_MEDIA_EXTENSIONS.test(checkPathOrTitle);
                const isHtmlTrap = isBinaryMedia && totalBytes > 0 && totalBytes < 4096;
                const isCorrupted = isHtmlTrap || Boolean(cached.isCorrupted || cached.fileCorrupt);

                if (isCorrupted) {
                  isFileMissing = true;
                  if (!cached.isCorrupted || !cached.fileMissing) {
                    cached.isCorrupted = true;
                    cached.fileCorrupt = true;
                    cached.fileMissing = true;
                    await metaStore.set(key, cached);
                    storeMutated = true;
                  }
                }

                if (isTauriEnv && !isCorrupted) {
                  const candidatePaths: string[] = [];
                  if (cached.path) {
                    candidatePaths.push(cached.path);
                  }
                  if (cached.dir && cached.title) {
                    const normDir = cached.dir.replace(/\\/g, '/').replace(/\/+$/, '');
                    candidatePaths.push(`${normDir}/${cached.title}`);
                  }
                  const defaultDir = (get().defaultDownloadDir || '').replace(/\\/g, '/').replace(/\/+$/, '');
                  if (defaultDir && cached.title) {
                    candidatePaths.push(`${defaultDir}/${cached.title}`);
                  }
                  if (cached.title) {
                    candidatePaths.push(`/mnt/WDC240/${cached.title}`);
                  }

                  for (const candPath of candidatePaths) {
                    try {
                      const exists = await invoke<boolean>('check_downloaded_file_exists', { path: candPath });
                      if (exists) {
                        resolvedFilePath = candPath;
                        const lastSlash = Math.max(candPath.lastIndexOf('/'), candPath.lastIndexOf('\\'));
                        resolvedDir = lastSlash !== -1 ? candPath.substring(0, lastSlash) : resolvedDir;
                        break;
                      }
                    } catch {}
                  }

                  // If candidate paths were checked and none exist on disk, the file was removed outside PDM!
                  // Retain in PDM with fileMissing: true instead of deleting metadata so user can redownload
                  if (!resolvedFilePath) {
                    isFileMissing = true;
                    resolvedFilePath = cached.path || (cached.title ? `${(get().defaultDownloadDir || '').replace(/\\/g, '/').replace(/\/+$/, '')}/${cached.title}` : '');
                    if (cached.fileMissing !== true) {
                      cached.fileMissing = true;
                      await metaStore.set(key, cached);
                      storeMutated = true;
                    }
                  } else {
                    let shouldUpdate = false;
                    if (cached.path !== resolvedFilePath || cached.dir !== resolvedDir) {
                      cached.path = resolvedFilePath;
                      cached.dir = resolvedDir;
                      shouldUpdate = true;
                    }
                    if (cached.fileMissing) {
                      delete cached.fileMissing;
                      shouldUpdate = true;
                    }
                    if (shouldUpdate) {
                      await metaStore.set(key, cached);
                      storeMutated = true;
                    }
                  }
                } else {
                  isFileMissing = Boolean(cached.fileMissing);
                  resolvedFilePath = cached.path || (cached.title ? `${(get().defaultDownloadDir || '').replace(/\\/g, '/').replace(/\/+$/, '')}/${cached.title}` : '');
                }

                const rehydratedDl: Aria2Download = {
                  gid: key,
                  status: 'complete',
                  fileMissing: isFileMissing,
                  fileCorrupt: isCorrupted,
                  totalLength: cached.totalLength,
                  completedLength: cached.completedLength,
                  downloadSpeed: '0',
                  dir: resolvedDir || (resolvedFilePath ? resolvedFilePath.substring(0, Math.max(resolvedFilePath.lastIndexOf('/'), resolvedFilePath.lastIndexOf('\\'))) : (get().defaultDownloadDir || '')),
                  files: cached.files && cached.files.length > 0
                    ? cached.files.map(f => resolvedFilePath ? { ...f, path: resolvedFilePath } : f)
                    : [{
                        path: resolvedFilePath || '',
                        length: cached.totalLength,
                        completedLength: cached.completedLength,
                        uris: (cached.downloadUrl || cached.sourceUrl) ? [{ status: 'used', uri: (cached.downloadUrl || cached.sourceUrl)! }] : []
                      }],
                  addedAt: cached.addedAt || Date.now(),
                };

                if (!filteredCompleted.some(d => d.gid === key)) {
                  filteredCompleted.push(rehydratedDl);
                }

                metadataUpdates[key] = {
                  sourceUrl: cached.sourceUrl,
                  title: cached.title,
                };
              } else if (cached.status === 'removed' || cached.status === 'error') {
                // Decision 2 - Option A: Retain cancelled & failed downloads in the Failed tab across restarts
                const rehydratedFailed: Aria2Download = {
                  gid: key,
                  status: cached.status as 'error' | 'removed',
                  totalLength: cached.totalLength || '0',
                  completedLength: cached.completedLength || '0',
                  downloadSpeed: '0',
                  dir: cached.dir || (get().defaultDownloadDir || ''),
                  files: cached.files && cached.files.length > 0
                    ? cached.files
                    : [{
                        path: cached.path || '',
                        length: cached.totalLength || '0',
                        completedLength: cached.completedLength || '0',
                        uris: cached.sourceUrl ? [{ status: 'used', uri: cached.sourceUrl }] : []
                      }],
                  addedAt: cached.addedAt || Date.now(),
                  errorMessage: cached.status === 'removed' ? 'Download was cancelled' : 'Download failed',
                };

                if (!filteredFailed.some(d => d.gid === key)) {
                  filteredFailed.push(rehydratedFailed);
                }

                if (cached.sourceUrl || cached.title) {
                  metadataUpdates[key] = {
                    sourceUrl: cached.sourceUrl,
                    title: cached.title,
                  };
                }
              }
            }
          }
        }

        if (storeMutated) {
          await metaStore.save();
        }

        filteredCompleted.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        filteredFailed.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      }

      // Live disk check for all completed downloads to catch deletions during active session
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        for (const dl of filteredCompleted) {
          const isPendingMux = pendingMuxes.some(m => m.videoGid === dl.gid); // agyis: no-mutant
          if (!isPendingMux && !dl.fileCorrupt) { // agyis: no-mutant
            const p = dl.files && dl.files[0] ? dl.files[0].path : null;
            if (p) {
              try {
                const exists = await invoke<boolean>('check_downloaded_file_exists', { path: p });
                dl.fileMissing = !exists;
              } catch {}
            }
          }
        }
      }

      // Deduplicate and enforce strict mutual exclusivity across active, completed, and failed lists
      const activeGids = new Set<string>();
      const uniqueActive: Aria2Download[] = [];
      for (const dl of filteredActive) {
        if (dl.gid && !activeGids.has(dl.gid)) {
          activeGids.add(dl.gid);
          uniqueActive.push(dl);
        }
      }

      const completedGids = new Set<string>();
      const uniqueCompleted: Aria2Download[] = [];
      for (const dl of filteredCompleted) {
        if (dl.gid && !activeGids.has(dl.gid) && !completedGids.has(dl.gid)) {
          completedGids.add(dl.gid);
          uniqueCompleted.push(dl);
        }
      }

      const uniqueFailed: Aria2Download[] = [];
      const failedGids = new Set<string>();
      for (const dl of filteredFailed) {
        if (dl.gid && !activeGids.has(dl.gid) && !completedGids.has(dl.gid) && !failedGids.has(dl.gid)) {
          failedGids.add(dl.gid);
          uniqueFailed.push(dl);
        }
      }

      set({
        active: uniqueActive,
        completed: uniqueCompleted,
        failed: uniqueFailed,
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

    const sanitizedFilename = filename ? decodeFilename(filename) : undefined;

    if (audioUrl && sanitizedFilename) { // agyis: no-mutant
      const lastDotIndex = sanitizedFilename.lastIndexOf('.');
      const hasExt = lastDotIndex !== -1;
      const base = hasExt ? sanitizedFilename.substring(0, lastDotIndex) : sanitizedFilename;
      const ext = hasExt ? sanitizedFilename.substring(lastDotIndex + 1) : 'mp4'; // agyis: no-mutant

      let videoFilename = `${base}.video.${ext}`;
      let audioFilename = `${base}.audio.m4a`;
      let finalFilename = sanitizedFilename;

      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        videoFilename = await get().getUniqueFilename(videoFilename, targetDir);
        audioFilename = await get().getUniqueFilename(audioFilename, targetDir);
        finalFilename = await get().getUniqueFilename(sanitizedFilename, targetDir);
      }

      const videoGid = await aria2Client.addUri([url], { ...options, out: videoFilename });
      const audioGid = await aria2Client.addUri([audioUrl], { ...options, out: audioFilename });

      const metaUpdates: Record<string, { sourceUrl?: string; title?: string }> = {};
      if (sourceUrl || sanitizedFilename) { // agyis: no-mutant
        metaUpdates[videoGid] = { sourceUrl, title: sanitizedFilename };
        metaUpdates[audioGid] = { sourceUrl, title: sanitizedFilename };
      }

      set(state => ({
        downloadMetadata: { ...state.downloadMetadata, ...metaUpdates },
        pendingMuxes: [...(state.pendingMuxes || []), {
          videoGid,
          audioGid,
          finalFilename: finalFilename,
          status: 'waiting'
        }]
      }));

      if (sourceUrl || sanitizedFilename) { // agyis: no-mutant
        try {
          const metaStore = await getMetaStore();
          await metaStore.set(videoGid, {
            sourceUrl,
            downloadUrl: url,
            headers: effectiveHeaders,
            title: sanitizedFilename,
            companionGid: audioGid,
            muxFinalFilename: finalFilename,
            totalLength: '0',
            completedLength: '0',
            addedAt: Date.now()
          }); // agyis: no-mutant
          await metaStore.set(audioGid, {
            sourceUrl,
            downloadUrl: audioUrl,
            headers: effectiveHeaders,
            title: sanitizedFilename,
            companionGid: videoGid,
            muxFinalFilename: finalFilename,
            totalLength: '0',
            completedLength: '0',
            addedAt: Date.now()
          }); // agyis: no-mutant
          await metaStore.save();
        } catch (e) {
          console.warn('Failed to save download meta to store', e);
        }
      }
    } else {
      let finalFilename = sanitizedFilename;

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
          await metaStore.set(gid, {
            sourceUrl,
            downloadUrl: url,
            headers,
            title: sanitizedFilename || finalFilename,
            totalLength: resolvedFileSize ? String(resolvedFileSize) : '0',
            completedLength: '0',
            addedAt: Date.now()
          });
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

    try {
      const metaStore = await getMetaStore();
      const cached = await metaStore.get<CachedMeta>(gid);
      if (cached) {
        await metaStore.set(gid, { ...cached, status: 'removed' });
        if (mux) {
          await metaStore.delete(mux.audioGid);
        }
        await metaStore.save();
      }
    } catch (e) {
      console.warn('Failed to persist cancelled status to metaStore', e);
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

    await get().fetchDownloads();
  },

  redownload: async (gid: string) => {
    const state = get();
    const allDownloads = [...state.active, ...state.completed, ...state.failed];
    const dl = allDownloads.find(d => d.gid === gid);
    if (!dl) return;

    const meta = state.downloadMetadata[gid];
    const metaStore = await getMetaStore();
    const cached = await metaStore.get<CachedMeta>(gid);

    const sourceUrl = meta?.sourceUrl || cached?.sourceUrl || dl.files?.[0]?.uris?.[0]?.uri;
    const rawPath = dl.files?.[0]?.path || cached?.path || '';
    const lastSlash = Math.max(rawPath.lastIndexOf('/'), rawPath.lastIndexOf('\\'));
    const fileName = meta?.title || cached?.title || (lastSlash !== -1 ? rawPath.substring(lastSlash + 1) : rawPath);
    const dir = dl.dir || cached?.dir || state.defaultDownloadDir || undefined;

    if (!sourceUrl && !cached?.downloadUrl && !dl.files?.[0]?.uris?.[0]?.uri) {
      console.warn('Cannot redownload: source URL not found for gid', gid);
      return;
    }

    // If it is a YouTube / stream URL, stage it or re-extract
    if (sourceUrl && (sourceUrl.includes('youtube.com') || sourceUrl.includes('youtu.be'))) {
      try {
        const { ytdlpClient } = await import('@/lib/ytdlpClient');
        const info = await ytdlpClient.extractVideoInfo(sourceUrl);
        if (info.formats && info.formats.length > 0) {
          await state.stageDownload({
            url: sourceUrl,
            sourceUrl,
            headers: cached?.headers || [],
            filename: fileName || info.title,
            mediaFormats: info.formats,
          });
          await state.deleteDownload(gid, false);
          return;
        }
      } catch (e) {
        console.warn('Failed to re-extract video info, falling back to direct add:', e);
      }
    }

    // For direct downloads:
    // Look for direct file URI:
    const directUrl = cached?.downloadUrl || dl.files?.[0]?.uris?.find(u => u.uri && !u.uri.includes('undefined'))?.uri || cached?.files?.[0]?.uris?.[0]?.uri;
    const urlToDownload = directUrl || sourceUrl;
    if (!urlToDownload) {
      console.warn('Cannot redownload: URL to download not found for gid', gid);
      return;
    }

    const headers = cached?.headers || [];
    const rawFileSize = cached?.totalLength ? parseInt(cached.totalLength, 10) : (dl.totalLength ? parseInt(dl.totalLength, 10) : undefined);
    const isCorruptedLength = rawFileSize !== undefined && rawFileSize > 0 && rawFileSize < 4096;
    const expectedFileSize = (!isCorruptedLength && rawFileSize && rawFileSize > 0) ? rawFileSize : undefined;

    await state.addDownload(urlToDownload, headers, dir, fileName, undefined, undefined, sourceUrl, expectedFileSize);
    await state.deleteDownload(gid, false);
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
