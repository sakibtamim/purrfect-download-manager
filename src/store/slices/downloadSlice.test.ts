import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { create, StoreApi } from 'zustand';
import { createDownloadSlice, DownloadDataSlice, getMetaStore, _resetMetaStoreForTesting, CachedMeta } from './downloadSlice';
import { createSettingsSlice, SettingsSlice } from './settingsSlice';
import { createUISlice, UISlice } from './uiSlice';
import { DownloadState, PendingMux, StagedDownload } from '../types';
import { aria2Client, Aria2Download } from '@/lib/aria2Client';
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
    _resetMetaStoreForTesting();
    vi.spyOn(aria2Client, 'tellActive').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellWaiting').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellStopped').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'getGlobalStat').mockResolvedValue({ downloadSpeed: '0', numActive: '0', numWaiting: '0', numStopped: '0' });
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

  it('sanitizes path traversal in dual-stream muxed download filenames', async () => {
    const addUriCalls: { uris: string[]; options?: Record<string, unknown> }[] = [];
    vi.spyOn(aria2Client, 'addUri').mockImplementation(async (uris, options) => {
      addUriCalls.push({ uris, options: options as Record<string, unknown> });
      return `gid-${addUriCalls.length}`;
    });

    const useTestStore = create<DownloadDataSlice & { pendingMuxes: PendingMux[] }>()((set, get, api) => ({
      ...createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>),
      pendingMuxes: []
    }));

    await useTestStore.getState().addDownload(
      'https://video.example.com/video.mp4',
      [],
      '/tmp/downloads',
      '../../etc/cron.d/hack.mp4',
      'https://video.example.com/audio.m4a',
      undefined,
      'https://youtube.com/watch?v=exploit'
    );

    expect(addUriCalls.length).toBe(2);
    expect(addUriCalls[0].options?.['out']).toBe('hack.video.mp4');
    expect(addUriCalls[1].options?.['out']).toBe('hack.audio.m4a');
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
    expect(useTestStore.getState().downloadMetadata['gid-m3u8']?.title).toBe('video.m3u8');
  });

  it('initializes engineStatus to connecting and updates to connected on successful fetch', async () => {
    vi.spyOn(aria2Client, 'tellActive').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellWaiting').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellStopped').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'getGlobalStat').mockResolvedValue({ downloadSpeed: '0', numActive: '0', numWaiting: '0', numStopped: '0' });

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    expect(useTestStore.getState().engineStatus).toBe('connecting');
    expect(useTestStore.getState().engineError).toBeNull();

    await useTestStore.getState().fetchDownloads();

    expect(useTestStore.getState().engineStatus).toBe('connected');
    expect(useTestStore.getState().engineError).toBeNull();
  });

  it('surfaces engineStatus error when aria2 connection fails rather than silently swallowing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(aria2Client, 'tellActive').mockRejectedValue(new Error('fetch failed: Connection refused (127.0.0.1:6800)'));

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await useTestStore.getState().fetchDownloads();

    expect(useTestStore.getState().engineStatus).toBe('error');
    expect(useTestStore.getState().engineError).toBe('fetch failed: Connection refused (127.0.0.1:6800)');
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to fetch aria2 status:',
      'fetch failed: Connection refused (127.0.0.1:6800)',
      expect.any(Error)
    );
  });

  it('allows updating engineStatus via setEngineStatus', () => {
    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    useTestStore.getState().setEngineStatus('error', 'Port collision on 6800');
    expect(useTestStore.getState().engineStatus).toBe('error');
    expect(useTestStore.getState().engineError).toBe('Port collision on 6800');

    useTestStore.getState().setEngineStatus('connected');
    expect(useTestStore.getState().engineStatus).toBe('connected');
    expect(useTestStore.getState().engineError).toBeNull();
  });

  it('preserves prior descriptive engineError when fetchDownloads catches connection failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(aria2Client, 'tellActive').mockRejectedValue(new Error('generic fetch failed'));

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    useTestStore.getState().setEngineStatus('error', 'Failed to find available port for aria2: all ports in range 6800-6820 are occupied');

    await useTestStore.getState().fetchDownloads();

    expect(useTestStore.getState().engineStatus).toBe('error');
    expect(useTestStore.getState().engineError).toBe('Failed to find available port for aria2: all ports in range 6800-6820 are occupied');
  });
});

describe('Unified dual-stream encapsulation and tandem controls', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetMetaStoreForTesting();
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

  afterEach(() => {
    (globalThis as unknown as { window?: unknown }).window = originalWindow;
  });

  afterAll(() => {
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

describe('deleteDownload disk hygiene, mux stream cleanup, and directory removal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetMetaStoreForTesting();
    vi.mocked(invoke).mockResolvedValue(undefined);
    vi.spyOn(aria2Client, 'remove').mockResolvedValue('OK');
    vi.spyOn(aria2Client, 'removeDownloadResult').mockResolvedValue('OK');
    vi.spyOn(aria2Client, 'tellActive').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellWaiting').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellStopped').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'getGlobalStat').mockResolvedValue({ downloadSpeed: '0', numActive: '0', numWaiting: '0', numStopped: '0' });
  });

  it('deletes normal single file and control file with task directory when removeLocalFile is true', async () => {
    const mockDl = {
      gid: 'dl-1',
      status: 'active' as const,
      totalLength: '100',
      completedLength: '50',
      downloadSpeed: '0',
      dir: '/custom/storage',
      files: [{ path: '/custom/storage/doc.pdf', length: '100', completedLength: '50', uris: [] }]
    };

    const useTestStore = create<DownloadDataSlice>()((set, get, api) => {
      const slice = createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>);
      return {
        ...slice,
        active: [mockDl]
      };
    });

    expect(useTestStore.getState().active).toHaveLength(1);
    await useTestStore.getState().deleteDownload('dl-1', true);

    expect(invoke).toHaveBeenCalledWith('delete_downloaded_file', {
      path: '/custom/storage/doc.pdf',
      customDir: '/custom/storage'
    });
    expect(invoke).toHaveBeenCalledWith('delete_downloaded_file', {
      path: '/custom/storage/doc.pdf.aria2',
      customDir: '/custom/storage'
    });
    expect(useTestStore.getState().active).toHaveLength(0);
    expect(useTestStore.getState().downloadMetadata['dl-1']).toBe(undefined);
  });

  it('cleans up intermediate video and audio stream fragments when deleting pending muxed download', async () => {
    const mockVideo = {
      gid: 'vid-m1',
      status: 'active' as const,
      totalLength: '1000',
      completedLength: '500',
      downloadSpeed: '0',
      dir: '/media/videos',
      files: [{ path: '/media/videos/FullMovie.mp4', length: '1000', completedLength: '500', uris: [] }]
    };
    const mockAudio = {
      gid: 'aud-m1',
      status: 'active' as const,
      totalLength: '200',
      completedLength: '100',
      downloadSpeed: '0',
      dir: '/media/videos',
      files: [{ path: '/media/videos/FullMovie.audio.m4a', length: '200', completedLength: '100', uris: [] }]
    };

    const useTestStore = create<DownloadDataSlice & { pendingMuxes: PendingMux[] }>()((set, get, api) => {
      const slice = createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>);
      return {
        ...slice,
        active: [mockVideo],
        pendingMuxes: [{
          videoGid: 'vid-m1',
          audioGid: 'aud-m1',
          finalFilename: 'FullMovie.mp4',
          status: 'waiting'
        }]
      };
    });

    // Provide companion audio in allDownloads lookup
    vi.spyOn(aria2Client, 'tellActive').mockResolvedValue([mockVideo, mockAudio]);

    await useTestStore.getState().deleteDownload('vid-m1', true);

    const invokedCalls = vi.mocked(invoke).mock.calls
      .filter(call => call[0] === 'delete_downloaded_file')
      .map(call => (call[1] as { path: string; customDir: string }).path);

    expect(invokedCalls).toContain('/media/videos/FullMovie.mp4');
    expect(invokedCalls).toContain('/media/videos/FullMovie.video.mp4');
    expect(invokedCalls).toContain('/media/videos/FullMovie.audio.m4a');
    expect(invokedCalls).toContain('/media/videos/FullMovie.video.mp4.aria2');
    expect(invokedCalls).toContain('/media/videos/FullMovie.audio.m4a.aria2');
    expect(useTestStore.getState().pendingMuxes.some(m => m.videoGid === 'vid-m1')).toBe(false);
  });

  it('cleans up multi-file folder when multi-file download is deleted with removeLocalFile is true', async () => {
    const mockTorrent = {
      gid: 'torrent-1',
      status: 'complete' as const,
      totalLength: '5000',
      completedLength: '5000',
      downloadSpeed: '0',
      dir: '/downloads',
      files: [
        { path: '/downloads/Ubuntu-Release/ubuntu.iso', length: '4000', completedLength: '4000', uris: [] },
        { path: '/downloads/Ubuntu-Release/SHA256SUMS', length: '1000', completedLength: '1000', uris: [] }
      ]
    };

    const useTestStore = create<DownloadDataSlice>()((set, get, api) => {
      const slice = createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>);
      return {
        ...slice,
        completed: [mockTorrent]
      };
    });

    await useTestStore.getState().deleteDownload('torrent-1', true);

    const invokedCalls = vi.mocked(invoke).mock.calls
      .filter(call => call[0] === 'delete_downloaded_file')
      .map(call => (call[1] as { path: string; customDir: string }).path);

    expect(invokedCalls).toContain('/downloads/Ubuntu-Release/ubuntu.iso');
    expect(invokedCalls).toContain('/downloads/Ubuntu-Release/SHA256SUMS');
    expect(invokedCalls).toContain('/downloads/Ubuntu-Release');
    expect(useTestStore.getState().downloadMetadata['torrent-1']).toBeUndefined();
  });

  it('does not invoke delete_downloaded_file when removeLocalFile is false', async () => {
    const mockDl = {
      gid: 'dl-keep',
      status: 'complete' as const,
      totalLength: '100',
      completedLength: '100',
      downloadSpeed: '0',
      dir: '/downloads',
      files: [{ path: '/downloads/keep.txt', length: '100', completedLength: '100', uris: [] }]
    };

    const useTestStore = create<DownloadDataSlice>()((set, get, api) => {
      const slice = createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>);
      return {
        ...slice,
        completed: [mockDl]
      };
    });

    expect(useTestStore.getState().completed).toHaveLength(1);
    await useTestStore.getState().deleteDownload('dl-keep', false);

    expect(invoke).not.toHaveBeenCalledWith('delete_downloaded_file', expect.anything());
    expect(useTestStore.getState().completed).toHaveLength(0);
    expect(useTestStore.getState().downloadMetadata['dl-keep']).toBe(undefined);
  });

  it('cleans up multi-file folder when a download has a single file in a dedicated subfolder', async () => {
    const mockSingleFileTorrent = {
      gid: 'single-torrent',
      status: 'complete' as const,
      totalLength: '2000',
      completedLength: '2000',
      downloadSpeed: '0',
      dir: '/downloads',
      files: [
        { path: '/downloads/SingleRelease/movie.mkv', length: '2000', completedLength: '2000', uris: [] }
      ]
    };

    const useTestStore = create<DownloadDataSlice>()((set, get, api) => {
      const slice = createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>);
      return {
        ...slice,
        completed: [mockSingleFileTorrent]
      };
    });

    await useTestStore.getState().deleteDownload('single-torrent', true);

    const invokedCalls = vi.mocked(invoke).mock.calls
      .filter(call => call[0] === 'delete_downloaded_file')
      .map(call => (call[1] as { path: string; customDir: string }).path);

    expect(invokedCalls).toContain('/downloads/SingleRelease/movie.mkv');
    expect(invokedCalls).toContain('/downloads/SingleRelease');
    expect(useTestStore.getState().completed).toHaveLength(0);
    expect(useTestStore.getState().downloadMetadata['single-torrent']).toBeUndefined();
  });

  it('calls aria2 removeDownloadResult on active tasks to prevent task re-appearance in fetchDownloads', async () => {
    const mockActiveDl = {
      gid: 'active-task',
      status: 'active' as const,
      totalLength: '1000',
      completedLength: '200',
      downloadSpeed: '100',
      dir: '/downloads',
      files: [{ path: '/downloads/file.bin', length: '1000', completedLength: '200', uris: [] }]
    };

    const useTestStore = create<DownloadDataSlice>()((set, get, api) => {
      const slice = createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>);
      return {
        ...slice,
        active: [mockActiveDl]
      };
    });

    await useTestStore.getState().deleteDownload('active-task', false);

    expect(aria2Client.remove).toHaveBeenCalledWith('active-task');
    expect(aria2Client.removeDownloadResult).toHaveBeenCalledWith('active-task');
    expect(useTestStore.getState().active).toEqual([]);
    expect(useTestStore.getState().downloadMetadata['active-task']).toBeUndefined();
  });

  it('cleans up completed and orphaned metadata records on clearCompletedDownloads', async () => {
    vi.spyOn(aria2Client, 'purgeDownloadResult').mockResolvedValue('OK');
    vi.spyOn(aria2Client, 'tellActive').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellWaiting').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellStopped').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'getGlobalStat').mockResolvedValue({ downloadSpeed: '0', numActive: '0', numWaiting: '0', numStopped: '0' });

    const metaStore = await getMetaStore();
    await metaStore.set('completed-gid-1', { title: 'file1.zip', sourceUrl: 'https://example.com/1' });
    await metaStore.set('orphaned-gid-2', { title: 'file2.zip', sourceUrl: 'https://example.com/2' });
    await metaStore.save();

    const mockCompletedDl: Aria2Download = {
      gid: 'completed-gid-1',
      status: 'complete',
      totalLength: '1000',
      completedLength: '1000',
      downloadSpeed: '0',
      dir: '/downloads',
      files: [{ path: '/downloads/file1.zip', length: '1000', completedLength: '1000', uris: [] }],
    };

    const useTestStore = create<DownloadDataSlice>()((set, get, api) => {
      const slice = createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>);
      return {
        ...slice,
        completed: [mockCompletedDl],
        downloadMetadata: {
          'completed-gid-1': { title: 'file1.zip' },
          'orphaned-gid-2': { title: 'file2.zip' },
        },
      };
    });

    await useTestStore.getState().clearCompletedDownloads();

    expect(aria2Client.purgeDownloadResult).toHaveBeenCalled();
    expect(useTestStore.getState().downloadMetadata['completed-gid-1']).toBeUndefined();
    expect(useTestStore.getState().downloadMetadata['orphaned-gid-2']).toBeUndefined();
    expect(await metaStore.get('completed-gid-1')).toBeNull();
    expect(await metaStore.get('orphaned-gid-2')).toBeNull();
  });

  it('preserves in-flight pending mux downloads during clearCompletedDownloads', async () => {
    vi.spyOn(aria2Client, 'purgeDownloadResult').mockResolvedValue('OK');
    vi.spyOn(aria2Client, 'tellActive').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellWaiting').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellStopped').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'getGlobalStat').mockResolvedValue({ downloadSpeed: '0', numActive: '0', numWaiting: '0', numStopped: '0' });

    const metaStore = await getMetaStore();
    await metaStore.set('video-gid-100', { title: 'video.mp4', sourceUrl: 'https://youtube.com/v' });
    await metaStore.set('audio-gid-100', { title: 'audio.m4a', sourceUrl: 'https://youtube.com/a' });
    await metaStore.set('completed-clean-1', { title: 'other.iso' });
    await metaStore.save();

    const mockCompletedVideo: Aria2Download = {
      gid: 'video-gid-100',
      status: 'complete',
      totalLength: '2000',
      completedLength: '2000',
      downloadSpeed: '0',
      dir: '/downloads',
      files: [{ path: '/downloads/video.mp4', length: '2000', completedLength: '2000', uris: [] }],
    };

    const mockOtherCompleted: Aria2Download = {
      gid: 'completed-clean-1',
      status: 'complete',
      totalLength: '500',
      completedLength: '500',
      downloadSpeed: '0',
      dir: '/downloads',
      files: [{ path: '/downloads/other.iso', length: '500', completedLength: '500', uris: [] }],
    };

    const useTestStore = create<DownloadDataSlice>()((set, get, api) => {
      const slice = createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>);
      return {
        ...slice,
        completed: [mockCompletedVideo, mockOtherCompleted],
        pendingMuxes: [
          { videoGid: 'video-gid-100', audioGid: 'audio-gid-100', finalFilename: 'video_final.mp4', status: 'muxing' },
        ],
        downloadMetadata: {
          'video-gid-100': { title: 'video.mp4' },
          'audio-gid-100': { title: 'audio.m4a' },
          'completed-clean-1': { title: 'other.iso' },
        },
      };
    });

    await useTestStore.getState().clearCompletedDownloads();

    // The clean completed download was removed
    expect(useTestStore.getState().downloadMetadata['completed-clean-1']).toBeUndefined();
    expect(await metaStore.get('completed-clean-1')).toBeNull();

    // The in-flight pending mux video and audio downloads were preserved
    expect(useTestStore.getState().downloadMetadata['video-gid-100']).toEqual({ title: 'video.mp4' });
    expect(useTestStore.getState().downloadMetadata['audio-gid-100']).toEqual({ title: 'audio.m4a' });
    expect(await metaStore.get('video-gid-100')).not.toBeNull();
    expect(await metaStore.get('audio-gid-100')).not.toBeNull();
  });
});

describe('Persistent completed download rehydration across app restarts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetMetaStoreForTesting();
    vi.mocked(invoke).mockResolvedValue(undefined);
    vi.spyOn(aria2Client, 'remove').mockResolvedValue('OK');
    vi.spyOn(aria2Client, 'removeDownloadResult').mockResolvedValue('OK');
    vi.spyOn(aria2Client, 'tellActive').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellWaiting').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellStopped').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'getGlobalStat').mockResolvedValue({ downloadSpeed: '0', numActive: '0', numWaiting: '0', numStopped: '0' });
  });

  it('rehydrates completed downloads from metaStore when aria2Client.tellStopped returns []', async () => {
    const metaStore = await getMetaStore();
    await metaStore.set('persisted-gid-1', {
      status: 'complete',
      totalLength: '10485760',
      completedLength: '10485760',
      title: 'archive.tar.gz',
      path: '/downloads/archive.tar.gz',
      dir: '/downloads',
      sourceUrl: 'https://example.com/archive.tar.gz',
      addedAt: 1700000000000,
      files: [{
        path: '/downloads/archive.tar.gz',
        length: '10485760',
        completedLength: '10485760',
        uris: [{ status: 'used', uri: 'https://example.com/archive.tar.gz' }],
      }],
    });
    // Incomplete download in metaStore should NOT be rehydrated
    await metaStore.set('incomplete-gid-2', {
      status: 'active',
      totalLength: '10000',
      completedLength: '5000',
      title: 'incomplete.iso',
      path: '/downloads/incomplete.iso',
    });
    await metaStore.save();

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await useTestStore.getState().fetchDownloads();

    const completed = useTestStore.getState().completed;
    expect(completed).toHaveLength(1);
    expect(completed[0].gid).toBe('persisted-gid-1');
    expect(completed[0].status).toBe('complete');
    expect(completed[0].totalLength).toBe('10485760');
    expect(completed[0].completedLength).toBe('10485760');
    expect(completed[0].downloadSpeed).toBe('0');
    expect(completed[0].dir).toBe('/downloads');
    expect(completed[0].files[0].path).toBe('/downloads/archive.tar.gz');
    expect(completed[0].addedAt).toBe(1700000000000);

    const meta = useTestStore.getState().downloadMetadata['persisted-gid-1'];
    expect(meta).toBeDefined();
    expect(meta?.title).toBe('archive.tar.gz');
    expect(meta?.sourceUrl).toBe('https://example.com/archive.tar.gz');

    // Incomplete task must not be in active or completed
    expect(useTestStore.getState().active).toEqual([]);
    expect(useTestStore.getState().downloadMetadata['incomplete-gid-2']).toBeUndefined();
  });

  it('rehydrates completed downloads matching totalLength === completedLength when status field was omitted', async () => {
    const metaStore = await getMetaStore();
    await metaStore.set('legacy-gid-1', {
      totalLength: '5000',
      completedLength: '5000',
      title: 'legacy.bin',
      path: '/downloads/legacy.bin',
      dir: '/downloads',
      addedAt: 1700000001000,
    });
    await metaStore.save();

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await useTestStore.getState().fetchDownloads();

    const completed = useTestStore.getState().completed;
    expect(completed).toHaveLength(1);
    expect(completed[0].gid).toBe('legacy-gid-1');
    expect(completed[0].status).toBe('complete');
    expect(completed[0].files[0].path).toBe('/downloads/legacy.bin');
  });

  it('preserves both live aria2 completed downloads and persisted rehydrated downloads without duplicates', async () => {
    const metaStore = await getMetaStore();
    await metaStore.set('persisted-gid-1', {
      status: 'complete',
      totalLength: '2000',
      completedLength: '2000',
      title: 'persisted.pdf',
      path: '/downloads/persisted.pdf',
      dir: '/downloads',
      addedAt: 1000,
    });
    await metaStore.set('live-gid-2', {
      status: 'complete',
      totalLength: '4000',
      completedLength: '4000',
      title: 'live.pdf',
      path: '/downloads/live.pdf',
      dir: '/downloads',
      addedAt: 2000,
    });
    await metaStore.save();

    const liveDl: Aria2Download = {
      gid: 'live-gid-2',
      status: 'complete',
      totalLength: '4000',
      completedLength: '4000',
      downloadSpeed: '0',
      dir: '/downloads',
      files: [{ path: '/downloads/live.pdf', length: '4000', completedLength: '4000', uris: [] }],
      addedAt: 2000,
    };
    vi.spyOn(aria2Client, 'tellStopped').mockResolvedValue([liveDl]);

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await useTestStore.getState().fetchDownloads();

    const completed = useTestStore.getState().completed;
    expect(completed).toHaveLength(2);
    // Verified no duplicate GIDs
    const gids = completed.map(d => d.gid);
    expect(gids).toContain('live-gid-2');
    expect(gids).toContain('persisted-gid-1');
    expect(new Set(gids).size).toBe(2);

    // Verified chronological sorting (addedAt descending: 2000 before 1000)
    expect(completed[0].gid).toBe('live-gid-2');
    expect(completed[1].gid).toBe('persisted-gid-1');
  });

  it('successfully deletes a rehydrated download and removes it from metaStore', async () => {
    const metaStore = await getMetaStore();
    await metaStore.set('to-delete-gid', {
      status: 'complete',
      totalLength: '8000',
      completedLength: '8000',
      title: 'remove-me.iso',
      path: '/downloads/remove-me.iso',
      dir: '/downloads',
      addedAt: 1500,
    });
    await metaStore.save();

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    // Rehydrate first
    await useTestStore.getState().fetchDownloads();
    expect(useTestStore.getState().completed).toHaveLength(1);
    expect(useTestStore.getState().completed[0].gid).toBe('to-delete-gid');

    // Delete with removeLocalFile = true
    await useTestStore.getState().deleteDownload('to-delete-gid', true);

    expect(invoke).toHaveBeenCalledWith('delete_downloaded_file', {
      path: '/downloads/remove-me.iso',
      customDir: '/downloads',
    });
    expect(await metaStore.get('to-delete-gid')).toBeNull();
    expect(useTestStore.getState().completed).toHaveLength(0);
    expect(useTestStore.getState().downloadMetadata['to-delete-gid']).toBeUndefined();
  });

  it('persists status: complete, dir, files, path, and title to metaStore when a live download completes', async () => {
    const completedAria2Task: Aria2Download = {
      gid: 'live-task-1',
      status: 'complete',
      totalLength: '123456',
      completedLength: '123456',
      downloadSpeed: '0',
      dir: '/media/downloads',
      files: [{
        path: '/media/downloads/song.flac',
        length: '123456',
        completedLength: '123456',
        uris: [{ status: 'used', uri: 'https://example.com/song.flac' }],
      }],
    };
    vi.spyOn(aria2Client, 'tellStopped').mockResolvedValue([completedAria2Task]);

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await useTestStore.getState().fetchDownloads();

    const metaStore = await getMetaStore();
    interface PersistedTaskMeta {
      status?: string;
      dir?: string;
      path?: string;
      title?: string;
      files?: { path: string }[];
    }
    const cached = await metaStore.get<PersistedTaskMeta>('live-task-1');
    expect(cached).toBeDefined();
    expect(cached?.status).toBe('complete');
    expect(cached?.dir).toBe('/media/downloads');
    expect(cached?.path).toBe('/media/downloads/song.flac');
    expect(cached?.title).toBe('song.flac');
    expect(cached?.files).toHaveLength(1);
    expect(cached?.files?.[0].path).toBe('/media/downloads/song.flac');
  });

  it('retains completed downloads in metaStore with fileMissing: true when file does not exist on disk in Tauri environment', async () => {
    const metaStore = await getMetaStore();
    await metaStore.set('missing-1', {
      status: 'complete',
      totalLength: '10000000',
      completedLength: '10000000',
      title: 'deleted-movie.mp4',
      path: '/downloads/deleted-movie.mp4',
      dir: '/downloads',
      sourceUrl: 'https://example.com/deleted-movie.mp4',
    });
    await metaStore.set('existing-1', {
      status: 'complete',
      totalLength: '20000000',
      completedLength: '20000000',
      title: 'real-movie.mp4',
      path: '/downloads/real-movie.mp4',
      dir: '/downloads',
      sourceUrl: 'https://example.com/real-movie.mp4',
    });
    await metaStore.save();

    const originalWindow = (globalThis as unknown as { window?: unknown }).window;
    (globalThis as unknown as { window: unknown }).window = {
      __TAURI_INTERNALS__: {},
    };

    try {

      vi.mocked(invoke).mockImplementation(async (cmd, args) => {
        if (cmd === 'check_downloaded_file_exists') {
          const p = (args as { path: string }).path;
          return p.includes('real-movie.mp4');
        }
        return undefined;
      });

      const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
        createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
      );

      await useTestStore.getState().fetchDownloads();

      // missing-1 is retained in completed list with fileMissing: true
      const completed = useTestStore.getState().completed;
      expect(completed).toHaveLength(2);
      const missingDl = completed.find(d => d.gid === 'missing-1');
      const existingDl = completed.find(d => d.gid === 'existing-1');
      expect(missingDl).toBeDefined();
      expect(missingDl?.fileMissing).toBe(true);
      expect(existingDl).toBeDefined();
      expect(existingDl?.fileMissing).toBe(false);

      // Verify metaStore retained the record with fileMissing: true
      const cachedMissing = await metaStore.get<{ fileMissing?: boolean }>('missing-1');
      expect(cachedMissing).not.toBeNull();
      expect(cachedMissing?.fileMissing).toBe(true);

      // Test redownload action for the missing file
      const addSpy = vi.spyOn(aria2Client, 'addUri').mockResolvedValue('new-gid-99');
      await useTestStore.getState().redownload('missing-1');
      expect(addSpy).toHaveBeenCalled();
      // After redownload, old missing record is cleaned up
      expect(await metaStore.get('missing-1')).toBeNull();
    } finally {
      (globalThis as unknown as { window?: unknown }).window = originalWindow;
    }
  });

  it('rehydrates cancelled downloads into the failed list with status removed across app restarts', async () => {
    const metaStore = await getMetaStore();
    await metaStore.set('cancelled-gid-1', {
      status: 'removed',
      totalLength: '50000',
      completedLength: '12000',
      title: 'cancelled-installer.exe',
      sourceUrl: 'https://example.com/cancelled.exe',
      addedAt: 1600000000000,
    });
    await metaStore.save();

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await useTestStore.getState().fetchDownloads();

    const failed = useTestStore.getState().failed;
    expect(failed).toHaveLength(1);
    expect(failed[0].gid).toBe('cancelled-gid-1');
    expect(failed[0].status).toBe('removed');
    expect(failed[0].errorMessage).toBe('Download was cancelled');
    expect(useTestStore.getState().downloadMetadata['cancelled-gid-1']?.title).toBe('cancelled-installer.exe');
  });

  it('updates muxProgress on video cards while actively muxing', async () => {
    const mockVideo = {
      gid: 'vid-mux-1',
      status: 'complete' as const,
      totalLength: '2000',
      completedLength: '2000',
      downloadSpeed: '0',
      dir: '/downloads',
      files: [{ path: '/downloads/Clip.video.mp4', length: '2000', completedLength: '2000', uris: [] }]
    };

    vi.spyOn(aria2Client, 'tellStopped').mockResolvedValue([mockVideo]);

    const useTestStore = create<DownloadDataSlice & { pendingMuxes: PendingMux[] }>()((set, get, api) => ({
      ...createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>),
      pendingMuxes: [{
        videoGid: 'vid-mux-1',
        audioGid: 'aud-mux-1',
        finalFilename: 'Clip.mp4',
        status: 'muxing',
        progress: 68
      }]
    }));

    await useTestStore.getState().fetchDownloads();

    const active = useTestStore.getState().active;
    expect(active).toHaveLength(1);
    expect(active[0].status).toBe('muxing');
    expect(active[0].muxProgress).toBe(68);
  });

  it('redownload uses direct downloadUrl over webpage sourceUrl and passes preserved headers', async () => {
    const metaStore = await getMetaStore();
    await metaStore.set('corrupt-or-webpage-gid', {
      status: 'complete',
      totalLength: '867',
      completedLength: '867',
      title: 'movie.mkv',
      path: '/downloads/movie.mkv',
      dir: '/downloads',
      sourceUrl: 'http://new.circleftp.net/content/106296',
      downloadUrl: 'http://new.circleftp.net/download/movie.mkv',
      headers: ['Cookie: session=secret123', 'Referer: http://new.circleftp.net/content/106296'],
      isCorrupted: true,
      fileMissing: true,
    });
    await metaStore.save();

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await useTestStore.getState().fetchDownloads();

    const addSpy = vi.spyOn(aria2Client, 'addUri').mockResolvedValue('new-gid-101');
    await useTestStore.getState().redownload('corrupt-or-webpage-gid');

    expect(addSpy).toHaveBeenCalledWith(
      ['http://new.circleftp.net/download/movie.mkv'],
      expect.objectContaining({
        header: expect.arrayContaining([
          'Cookie: session=secret123',
          'Referer: http://new.circleftp.net/content/106296',
        ]),
      })
    );

    expect(await metaStore.get('corrupt-or-webpage-gid')).toBeNull();
  });

  it('detects HTML trap: flags binary/media files under 4KB as corrupt and missing', async () => {
    vi.mocked(aria2Client.tellStopped).mockResolvedValueOnce([
      {
        gid: 'html-trap-gid',
        status: 'complete',
        totalLength: '867',
        completedLength: '867',
        downloadSpeed: '0',
        dir: '/downloads',
        files: [
          {
            path: '/downloads/blockbuster.mkv',
            length: '867',
            completedLength: '867',
            uris: [{ status: 'used', uri: 'http://new.circleftp.net/content/106296' }],
          },
        ],
      },
    ]);

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await useTestStore.getState().fetchDownloads();

    const completed = useTestStore.getState().completed;
    const trapDl = completed.find(d => d.gid === 'html-trap-gid');
    expect(trapDl).toBeDefined();
    expect(trapDl?.fileCorrupt).toBe(true);
    expect(trapDl?.fileMissing).toBe(true);

    const metaStore = await getMetaStore();
    const cached = await metaStore.get<CachedMeta>('html-trap-gid');
    expect(cached?.isCorrupted).toBe(true);
    expect(cached?.fileMissing).toBe(true);
  });

  it('addDownload stores downloadUrl and headers in metaStore', async () => {
    const metaStore = await getMetaStore();
    vi.spyOn(aria2Client, 'addUri').mockResolvedValue('new-gid-meta-check');

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await useTestStore.getState().addDownload(
      'https://example.com/stream/file.zip',
      ['Authorization: Bearer test-token', 'X-Custom-Header: value'],
      '/downloads',
      'archive.zip',
      undefined,
      undefined,
      'https://example.com/downloads/page/123'
    );

    const cached = await metaStore.get<CachedMeta>('new-gid-meta-check');
    expect(cached).toBeDefined();
    expect(cached?.downloadUrl).toBe('https://example.com/stream/file.zip');
    expect(cached?.sourceUrl).toBe('https://example.com/downloads/page/123');
    expect(cached?.headers).toEqual(['Authorization: Bearer test-token', 'X-Custom-Header: value']);
    expect(cached?.title).toBe('archive.zip');
  });

  it('fetchDownloads enforces strict mutual exclusivity and deduplication across active, completed, and failed', async () => {
    vi.spyOn(aria2Client, 'tellActive').mockResolvedValue([
      {
        gid: 'overlap-gid-1',
        status: 'active',
        totalLength: '1000',
        completedLength: '500',
        downloadSpeed: '100',
        dir: '/downloads',
        files: [{ path: '/downloads/active.zip', length: '1000', completedLength: '500', uris: [] }],
      },
      {
        gid: 'overlap-gid-1',
        status: 'active',
        totalLength: '1000',
        completedLength: '500',
        downloadSpeed: '100',
        dir: '/downloads',
        files: [{ path: '/downloads/active.zip', length: '1000', completedLength: '500', uris: [] }],
      },
    ]);

    vi.spyOn(aria2Client, 'tellWaiting').mockResolvedValue([]);

    vi.spyOn(aria2Client, 'tellStopped').mockResolvedValue([
      {
        gid: 'overlap-gid-1',
        status: 'complete',
        totalLength: '1000',
        completedLength: '1000',
        downloadSpeed: '0',
        dir: '/downloads',
        files: [{ path: '/downloads/active.zip', length: '1000', completedLength: '1000', uris: [] }],
      },
      {
        gid: 'overlap-gid-2',
        status: 'complete',
        totalLength: '2000',
        completedLength: '2000',
        downloadSpeed: '0',
        dir: '/downloads',
        files: [{ path: '/downloads/completed.zip', length: '2000', completedLength: '2000', uris: [] }],
      },
      {
        gid: 'overlap-gid-2',
        status: 'complete',
        totalLength: '2000',
        completedLength: '2000',
        downloadSpeed: '0',
        dir: '/downloads',
        files: [{ path: '/downloads/completed.zip', length: '2000', completedLength: '2000', uris: [] }],
      },
      {
        gid: 'overlap-gid-2',
        status: 'removed',
        totalLength: '2000',
        completedLength: '2000',
        downloadSpeed: '0',
        dir: '/downloads',
        files: [{ path: '/downloads/completed.zip', length: '2000', completedLength: '2000', uris: [] }],
      },
      {
        gid: 'overlap-gid-3',
        status: 'error',
        totalLength: '3000',
        completedLength: '0',
        downloadSpeed: '0',
        dir: '/downloads',
        files: [{ path: '/downloads/failed.zip', length: '3000', completedLength: '0', uris: [] }],
      },
      {
        gid: 'overlap-gid-3',
        status: 'error',
        totalLength: '3000',
        completedLength: '0',
        downloadSpeed: '0',
        dir: '/downloads',
        files: [{ path: '/downloads/failed.zip', length: '3000', completedLength: '0', uris: [] }],
      },
    ]);

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await useTestStore.getState().fetchDownloads();

    const { active, completed, failed } = useTestStore.getState();

    // overlap-gid-1 must be deduplicated and only in active
    expect(active.filter(d => d.gid === 'overlap-gid-1').length).toBe(1);
    expect(completed.some(d => d.gid === 'overlap-gid-1')).toBe(false);
    expect(failed.some(d => d.gid === 'overlap-gid-1')).toBe(false);

    // overlap-gid-2 must be deduplicated and only in completed
    expect(completed.filter(d => d.gid === 'overlap-gid-2').length).toBe(1);
    expect(failed.some(d => d.gid === 'overlap-gid-2')).toBe(false);

    // overlap-gid-3 must be deduplicated and only in failed
    expect(failed.filter(d => d.gid === 'overlap-gid-3').length).toBe(1);

    // Mutual exclusivity assertion
    const allGids = [...active.map(d => d.gid), ...completed.map(d => d.gid), ...failed.map(d => d.gid)];
    const uniqueGids = new Set(allGids);
    expect(allGids.length).toBe(3);
    expect(allGids.length).toBe(uniqueGids.size);
  });

  it('fetchDownloads does not rehydrate a removed download into completed when totalLength equals completedLength', async () => {
    vi.spyOn(aria2Client, 'tellActive').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellWaiting').mockResolvedValue([]);
    vi.spyOn(aria2Client, 'tellStopped').mockResolvedValue([]);

    const metaStore = await getMetaStore();
    await metaStore.set('cancelled-867-gid', {
      status: 'removed',
      title: 'cancelled-file.zip',
      totalLength: '867',
      completedLength: '867',
      addedAt: Date.now(),
    });
    await metaStore.save();

    const useTestStore = create<DownloadDataSlice>()((set, get, api) =>
      createDownloadSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await useTestStore.getState().fetchDownloads();

    const { completed, failed } = useTestStore.getState();
    expect(completed.some(d => d.gid === 'cancelled-867-gid')).toBe(false);
    expect(failed.some(d => d.gid === 'cancelled-867-gid')).toBe(true);
  });
});
