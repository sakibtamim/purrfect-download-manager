import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create, StoreApi } from 'zustand';
import { createDownloadSlice, DownloadDataSlice } from './downloadSlice';
import { createSettingsSlice, SettingsSlice } from './settingsSlice';
import { createUISlice, UISlice } from './uiSlice';
import { DownloadState, PendingMux, StagedDownload } from '../types';
import { aria2Client } from '@/lib/aria2Client';
import { UserAttentionType } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

const mockWindow = {
  unminimize: vi.fn().mockResolvedValue(undefined),
  show: vi.fn().mockResolvedValue(undefined),
  setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
  setFocus: vi.fn().mockResolvedValue(undefined),
  requestUserAttention: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => mockWindow,
  UserAttentionType: {
    Critical: 1,
    Informational: 2,
  },
}));

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue('granted'),
  sendNotification: vi.fn(),
}));

describe('settingsSlice defaults', () => {
  it('initializes splitConnections to 32 and speedUnit to MBps by default', () => {
    const useTestStore = create<SettingsSlice>()((set, get, api) =>
      createSettingsSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    expect(useTestStore.getState().splitConnections).toBe(32);
    expect(useTestStore.getState().speedUnit).toBe('MBps');
    expect(useTestStore.getState().dynamicConnections).toBe(true);
    expect(useTestStore.getState().closeToTray).toBe(true);
    expect(useTestStore.getState().minimizeToTray).toBe(false);
    expect(useTestStore.getState().startMinimized).toBe(false);
    expect(useTestStore.getState().showTaskbarProgress).toBe(true);
  });
});

describe('uiSlice defaults and viewMode switcher', () => {
  it('initializes viewMode to table and allows switching to cards', () => {
    const useTestStore = create<UISlice>()((set, get, api) =>
      createUISlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    expect(useTestStore.getState().viewMode).toBe('table');
    useTestStore.getState().setViewMode('cards');
    expect(useTestStore.getState().viewMode).toBe('cards');
  });
});

describe('downloadSlice metadata tracking', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('stores sourceUrl and title in downloadMetadata on addDownload and clears on delete', async () => {
    let mockGidCounter = 1;
    vi.spyOn(aria2Client, 'addUri').mockImplementation(async () => `gid-${mockGidCounter++}`);
    vi.spyOn(aria2Client, 'tellActive').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellWaiting').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellStopped').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'getGlobalStat').mockResolvedValue({ downloadSpeed: '0', numActive: '0', numWaiting: '0', numStopped: '0' });

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    expect(useTestStore.getState().downloadMetadata).toEqual({});

    await useTestStore.getState().addDownload(
      'https://cdn.example.com/stream.mp4',
      [],
      '/tmp/downloads',
      'my-video.mp4',
      undefined,
      undefined,
      'https://youtube.com/watch?v=12345'
    );

    const meta = useTestStore.getState().downloadMetadata['gid-1'];
    expect(meta).toBeDefined();
    expect(meta?.sourceUrl).toBe('https://youtube.com/watch?v=12345');
    expect(meta?.title).toBe('my-video.mp4');

    // Simulate deleteDownload
    await useTestStore.getState().deleteDownload('gid-1', false);
    expect(useTestStore.getState().downloadMetadata['gid-1']).toBeUndefined();
  });

  it('respects manual splitConnections up to 32 when dynamic scaling is disabled', async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    vi.spyOn(aria2Client, 'addUri').mockImplementation(async (_uris, options) => {
      capturedOptions = options as Record<string, unknown>;
      return 'gid-32';
    });

    const useTestStore = create<DownloadDataSlice & { splitConnections?: number; dynamicConnections?: boolean }>()((set, get, api) => ({
      ...createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>),
      splitConnections: 32,
      dynamicConnections: false,
    }));

    await useTestStore.getState().addDownload(
      'https://cdn.example.com/gigabit-stream.bin',
      [],
      '/tmp/downloads',
      'gigabit.bin'
    );

    expect(capturedOptions?.['split']).toBe('32');
    expect(capturedOptions?.['max-connection-per-server']).toBe('16');
    expect(capturedOptions?.['min-split-size']).toBe('1M');
  });

  it('dynamically allocates 32 splits for YouTube streams', async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    vi.spyOn(aria2Client, 'addUri').mockImplementation(async (_uris, options) => {
      capturedOptions = options as Record<string, unknown>;
      return 'gid-yt';
    });

    const useTestStore = create<DownloadDataSlice & { splitConnections?: number; dynamicConnections?: boolean }>()((set, get, api) => ({
      ...createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>),
      splitConnections: 16,
      dynamicConnections: true,
    }));

    await useTestStore.getState().addDownload(
      'https://rr1---sn-4g5ednks.googlevideo.com/videoplayback',
      [],
      '/tmp/downloads',
      'video.mp4',
      undefined,
      undefined,
      'https://www.youtube.com/watch?v=123'
    );

    expect(capturedOptions?.['split']).toBe('32');
    expect(capturedOptions?.['max-connection-per-server']).toBe('16');
    expect(capturedOptions?.['min-split-size']).toBe('1M');
    expect((capturedOptions?.['header'] as string[])?.some(h => h.startsWith('User-Agent:'))).toBe(true);
  });

  it('allocates unthrottled 32 splits across all file sizes for line speed saturation', async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    vi.spyOn(aria2Client, 'addUri').mockImplementation(async (_uris, options) => {
      capturedOptions = options as Record<string, unknown>;
      return 'gid-size';
    });

    const useTestStore = create<DownloadDataSlice & { splitConnections?: number; dynamicConnections?: boolean }>()((set, get, api) => ({
      ...createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>),
      splitConnections: 16,
      dynamicConnections: true,
    }));

    // Small file (< 5MB) -> 32 connections for maximum BDIX / line speed saturation
    await useTestStore.getState().addDownload(
      'https://example.com/small.png',
      [],
      '/tmp/downloads',
      'small.png',
      undefined,
      undefined,
      undefined,
      1024 * 1024
    );
    expect(capturedOptions?.['split']).toBe('32');
    expect(capturedOptions?.['max-connection-per-server']).toBe('16');

    // Huge file (> 500MB) -> 32 connections
    await useTestStore.getState().addDownload(
      'https://example.com/huge.iso',
      [],
      '/tmp/downloads',
      'huge.iso',
      undefined,
      undefined,
      undefined,
      1024 * 1024 * 1024
    );
    expect(capturedOptions?.['split']).toBe('32');
    expect(capturedOptions?.['max-connection-per-server']).toBe('16');
  });

  it('logs warning when attempting to add HLS manifest (.m3u8)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(aria2Client, 'addUri').mockResolvedValue('gid-m3u8');

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await useTestStore.getState().addDownload(
      'https://manifest.googlevideo.com/playlist/index.m3u8',
      [],
      '/tmp',
      'video.m3u8'
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Attempted to download HLS manifest directly with aria2:'),
      'https://manifest.googlevideo.com/playlist/index.m3u8'
    );
  });
});

describe('Unified dual-stream encapsulation and tandem controls', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('filters companion audio tasks out of active/completed and combines metrics onto the video card', async () => {
    const mockVideo = {
      gid: 'vid-1',
      status: 'active' as const,
      totalLength: '1000',
      completedLength: '500',
      downloadSpeed: '200',
      dir: '/downloads',
      files: [{ path: '/downloads/Movie.video.mp4', length: '1000', completedLength: '500', uris: [] }]
    };
    const mockAudio = {
      gid: 'aud-1',
      status: 'active' as const,
      totalLength: '500',
      completedLength: '250',
      downloadSpeed: '100',
      dir: '/downloads',
      files: [{ path: '/downloads/Movie.audio.m4a', length: '500', completedLength: '250', uris: [] }]
    };

    vi.spyOn(aria2Client, 'tellActive').mockResolvedValue([mockVideo, mockAudio]);
    vi.spyOn(aria2Client, 'tellWaiting').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellStopped').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'getGlobalStat').mockResolvedValue({ downloadSpeed: '300', numActive: '2', numWaiting: '0', numStopped: '0' });

    const useTestStore = create<DownloadDataSlice & { pendingMuxes: PendingMux[] }>()((set, get, api) => ({
      ...createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>),
      pendingMuxes: [{
        videoGid: 'vid-1',
        audioGid: 'aud-1',
        finalFilename: 'Movie.mp4',
        status: 'waiting'
      }]
    }));

    await useTestStore.getState().fetchDownloads();

    const active = useTestStore.getState().active;
    // Audio task must be completely hidden!
    expect(active.some(d => d.gid === 'aud-1')).toBe(false);
    expect(active.length).toBe(1);

    const videoDl = active[0];
    expect(videoDl.gid).toBe('vid-1');
    // Combined metrics
    expect(videoDl.totalLength).toBe('1500'); // 1000 + 500
    expect(videoDl.completedLength).toBe('750'); // 500 + 250
    expect(videoDl.downloadSpeed).toBe('300'); // 200 + 100
    // Normalized file path ends with finalFilename (Movie.mp4, NOT .video.mp4)
    expect(videoDl.files[0].path).toBe('/downloads/Movie.mp4');
  });

  it('sets status to muxing when video and audio are completed and mux is active', async () => {
    const mockVideo = {
      gid: 'vid-2',
      status: 'complete' as const,
      totalLength: '2000',
      completedLength: '2000',
      downloadSpeed: '0',
      dir: '/downloads',
      files: [{ path: '/downloads/Clip.video.mp4', length: '2000', completedLength: '2000', uris: [] }]
    };
    const mockAudio = {
      gid: 'aud-2',
      status: 'complete' as const,
      totalLength: '500',
      completedLength: '500',
      downloadSpeed: '0',
      dir: '/downloads',
      files: [{ path: '/downloads/Clip.audio.m4a', length: '500', completedLength: '500', uris: [] }]
    };

    vi.spyOn(aria2Client, 'tellActive').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellWaiting').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellStopped').mockResolvedValue([mockVideo, mockAudio]);
    vi.spyOn(aria2Client, 'getGlobalStat').mockResolvedValue({ downloadSpeed: '0', numActive: '0', numWaiting: '0', numStopped: '2' });

    const useTestStore = create<DownloadDataSlice & { pendingMuxes: PendingMux[] }>()((set, get, api) => ({
      ...createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>),
      pendingMuxes: [{
        videoGid: 'vid-2',
        audioGid: 'aud-2',
        finalFilename: 'Clip.mp4',
        status: 'muxing'
      }]
    }));

    await useTestStore.getState().fetchDownloads();

    // Actively muxing downloads stay in active downloads with status "muxing"
    const active = useTestStore.getState().active;
    expect(active.length).toBe(1);
    expect(active[0].gid).toBe('vid-2');
    expect(active[0].status).toBe('muxing');
    expect(active[0].files[0].path).toBe('/downloads/Clip.mp4');
  });

  it('pauses, resumes, cancels, and deletes companion audio tasks in tandem with video tasks', async () => {
    const pauseSpy = vi.spyOn(aria2Client, 'pause').mockResolvedValue('OK');
    const unpauseSpy = vi.spyOn(aria2Client, 'unpause').mockResolvedValue('OK');
    const removeSpy = vi.spyOn(aria2Client, 'remove').mockResolvedValue('OK');
    vi.spyOn(aria2Client, 'tellActive').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellWaiting').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellStopped').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'getGlobalStat').mockResolvedValue({ downloadSpeed: '0', numActive: '0', numWaiting: '0', numStopped: '0' });

    const useTestStore = create<DownloadDataSlice & { pendingMuxes: PendingMux[] }>()((set, get, api) => ({
      ...createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>),
      pendingMuxes: [{
        videoGid: 'vid-3',
        audioGid: 'aud-3',
        finalFilename: 'Tandem.mp4',
        status: 'waiting'
      }]
    }));

    // Pause
    await useTestStore.getState().pauseDownload('vid-3');
    expect(pauseSpy).toHaveBeenCalledWith('vid-3');
    expect(pauseSpy).toHaveBeenCalledWith('aud-3');

    // Resume
    await useTestStore.getState().resumeDownload('vid-3');
    expect(unpauseSpy).toHaveBeenCalledWith('vid-3');
    expect(unpauseSpy).toHaveBeenCalledWith('aud-3');

    // Cancel
    await useTestStore.getState().cancelDownload('vid-3');
    expect(removeSpy).toHaveBeenCalledWith('vid-3');
    expect(removeSpy).toHaveBeenCalledWith('aud-3');
    expect(useTestStore.getState().pendingMuxes.some(m => m.videoGid === 'vid-3')).toBe(false);
  });
});

describe('stageDownload and clearStagedDownload window elevation lifecycle', () => {
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { window?: unknown }).window = originalWindow;
  });

  const sampleStaged: StagedDownload = {
    url: 'https://example.com/archive.tar.gz',
    filename: 'archive.tar.gz',
    headers: ['User-Agent: Mozilla/5.0'],
  };

  it('stores stagedDownload and clears state in non-Tauri environment', async () => {
    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    expect(useTestStore.getState().stagedDownload).toBeNull();

    await useTestStore.getState().stageDownload(sampleStaged);
    expect(useTestStore.getState().stagedDownload).toEqual(sampleStaged);

    await useTestStore.getState().clearStagedDownload();
    expect(useTestStore.getState().stagedDownload).toBeNull();
  });

  it('unminimizes, shows, focuses, and elevates window without revoking alwaysOnTop while staged', async () => {
    (globalThis as unknown as { window: unknown }).window = {
      __TAURI_INTERNALS__: {},
    };

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await useTestStore.getState().stageDownload(sampleStaged);

    expect(invoke).toHaveBeenCalledWith('raise_window');
    expect(mockWindow.unminimize).toHaveBeenCalledTimes(1);
    expect(mockWindow.show).toHaveBeenCalledTimes(1);
    expect(mockWindow.setAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(mockWindow.setFocus).toHaveBeenCalledTimes(1);
    expect(mockWindow.requestUserAttention).toHaveBeenCalledWith(UserAttentionType.Critical);

    // Crucial check: setAlwaysOnTop(false) MUST NOT be called while download is still staged!
    expect(mockWindow.setAlwaysOnTop).not.toHaveBeenCalledWith(false);
    expect(useTestStore.getState().stagedDownload).toEqual(sampleStaged);
  });

  it('resets alwaysOnTop to false when clearStagedDownload is called', async () => {
    (globalThis as unknown as { window: unknown }).window = {
      __TAURI_INTERNALS__: {},
    };

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await useTestStore.getState().stageDownload(sampleStaged);
    expect(mockWindow.setAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(mockWindow.setAlwaysOnTop).not.toHaveBeenCalledWith(false);

    await useTestStore.getState().clearStagedDownload();
    expect(mockWindow.setAlwaysOnTop).toHaveBeenCalledWith(false);
    expect(useTestStore.getState().stagedDownload).toBeNull();
  });

  it('handles requestUserAttention rejection gracefully without throwing or blocking staging', async () => {
    (globalThis as unknown as { window: unknown }).window = {
      __TAURI_INTERNALS__: {},
    };
    mockWindow.requestUserAttention.mockRejectedValueOnce(new Error('Unsupported platform'));

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await expect(useTestStore.getState().stageDownload(sampleStaged)).resolves.not.toThrow();
    expect(useTestStore.getState().stagedDownload).toEqual(sampleStaged);
    expect(mockWindow.setAlwaysOnTop).toHaveBeenCalledWith(true);
  });

  it('handles window unminimize/focus failures gracefully without throwing', async () => {
    (globalThis as unknown as { window: unknown }).window = {
      __TAURI_INTERNALS__: {},
    };
    mockWindow.unminimize.mockRejectedValueOnce(new Error('Compositor error'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await expect(useTestStore.getState().stageDownload(sampleStaged)).resolves.not.toThrow();
    expect(useTestStore.getState().stagedDownload).toEqual(sampleStaged);
    expect(warnSpy).toHaveBeenCalledWith('Failed to focus window', expect.any(Error));
  });

  it('handles invoke(raise_window) failure gracefully and continues window elevation', async () => {
    (globalThis as unknown as { window: unknown }).window = {
      __TAURI_INTERNALS__: {},
    };
    vi.mocked(invoke).mockRejectedValueOnce(new Error('KWin DBus unavailable'));

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await expect(useTestStore.getState().stageDownload(sampleStaged)).resolves.not.toThrow();
    expect(mockWindow.unminimize).toHaveBeenCalledTimes(1);
    expect(mockWindow.show).toHaveBeenCalledTimes(1);
    expect(mockWindow.setAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(useTestStore.getState().stagedDownload).toEqual(sampleStaged);
  });
});
