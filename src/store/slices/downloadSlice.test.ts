import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create, StoreApi } from 'zustand';
import { createDownloadSlice, DownloadDataSlice } from './downloadSlice';
import { createSettingsSlice, SettingsSlice } from './settingsSlice';
import { DownloadState } from '../types';
import { aria2Client } from '@/lib/aria2Client';

describe('settingsSlice defaults', () => {
  it('initializes splitConnections to 16 by default', () => {
    const useTestStore = create<SettingsSlice>()((set, get, api) =>
      createSettingsSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    expect(useTestStore.getState().splitConnections).toBe(16);
    expect(useTestStore.getState().dynamicConnections).toBe(true);
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
  });

  it('dynamically adapts connection splits based on file size', async () => {
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

    // Small file (< 5MB) -> 2 connections
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
    expect(capturedOptions?.['split']).toBe('2');
    expect(capturedOptions?.['max-connection-per-server']).toBe('2');

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
});
