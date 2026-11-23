import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create, StoreApi } from 'zustand';
import { createSettingsSlice, SettingsSlice, _resetSettingsStoreForTesting } from './settingsSlice';
import { DownloadState } from '../types';
import * as autostartPlugin from '@tauri-apps/plugin-autostart';
import * as coreApi from '@tauri-apps/api/core';

vi.mock('@tauri-apps/plugin-autostart', () => ({
  enable: vi.fn().mockResolvedValue(undefined),
  disable: vi.fn().mockResolvedValue(undefined),
  isEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/lib/aria2Client', () => ({
  aria2Client: {
    changeGlobalOption: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('settingsSlice - autostart sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSettingsStoreForTesting();
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('toggles autostart and notifies tray via sync_tray_autostart when in Tauri environment', async () => {
    (globalThis as unknown as { window: unknown }).window = { __TAURI_INTERNALS__: {} };

    const useTestStore = create<SettingsSlice>()((set, get, api) =>
      createSettingsSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await useTestStore.getState().setAutoStart(true);
    expect(autostartPlugin.enable).toHaveBeenCalled();
    expect(useTestStore.getState().autoStart).toBe(true);
    expect(coreApi.invoke).toHaveBeenCalledWith('sync_tray_autostart', { enabled: true });

    await useTestStore.getState().setAutoStart(false);
    expect(autostartPlugin.disable).toHaveBeenCalled();
    expect(useTestStore.getState().autoStart).toBe(false);
    expect(coreApi.invoke).toHaveBeenCalledWith('sync_tray_autostart', { enabled: false });
  });

  it('updates store without calling invoke when not in Tauri environment', async () => {
    delete (globalThis as unknown as { window?: unknown }).window;

    const useTestStore = create<SettingsSlice>()((set, get, api) =>
      createSettingsSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await useTestStore.getState().setAutoStart(true);
    expect(autostartPlugin.enable).toHaveBeenCalled();
    expect(useTestStore.getState().autoStart).toBe(true);
    expect(coreApi.invoke).not.toHaveBeenCalled();
  });

  it('syncs autostart state to tray on initSettings in Tauri environment', async () => {
    (globalThis as unknown as { window: unknown }).window = { __TAURI_INTERNALS__: {} };

    const useTestStore = create<SettingsSlice>()((set, get, api) =>
      createSettingsSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await useTestStore.getState().initSettings();
    expect(autostartPlugin.isEnabled).toHaveBeenCalled();
    expect(useTestStore.getState().autoStart).toBe(true);
    await vi.waitFor(() => {
      expect(coreApi.invoke).toHaveBeenCalledWith('sync_tray_autostart', { enabled: true });
    });
  });

  it('updates aria2 default download dir when setDefaultDownloadDir is called', async () => {
    const { aria2Client } = await import('@/lib/aria2Client');
    const useTestStore = create<SettingsSlice>()((set, get, api) =>
      createSettingsSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await useTestStore.getState().setDefaultDownloadDir('/home/user/Downloads/Custom');
    expect(useTestStore.getState().defaultDownloadDir).toBe('/home/user/Downloads/Custom');
    expect(aria2Client.changeGlobalOption).toHaveBeenCalledWith({
      dir: '/home/user/Downloads/Custom',
    });
  });

  it('applies dir to aria2 options on initSettings if stored in settings', async () => {
    (globalThis as unknown as { window: unknown }).window = { __TAURI_INTERNALS__: {} };
    const { aria2Client } = await import('@/lib/aria2Client');
    const storePlugin = await import('@tauri-apps/plugin-store');
    vi.mocked(storePlugin.load).mockResolvedValueOnce({
      get: vi.fn().mockImplementation(async (key: string) => {
        if (key === 'defaultDownloadDir') return '/my/stored/dir';
        return null;
      }),
      set: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof storePlugin.load>>);

    const useTestStore = create<SettingsSlice>()((set, get, api) =>
      createSettingsSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    await useTestStore.getState().initSettings();
    expect(useTestStore.getState().defaultDownloadDir).toBe('/my/stored/dir');
    expect(aria2Client.changeGlobalOption).toHaveBeenCalledWith(
      expect.objectContaining({ dir: '/my/stored/dir' })
    );
  });
});
