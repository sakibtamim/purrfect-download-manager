import { StateCreator } from 'zustand';
import { Store, load } from '@tauri-apps/plugin-store';
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from '@tauri-apps/plugin-autostart';
import { aria2Client } from '@/lib/aria2Client';
import { DownloadState } from '../types';

const mockStore = new Map<string, unknown>();
let settingsStoreCache: Store | null = null;

export async function getSettingsStore(): Promise<Store> {
  if (!settingsStoreCache) {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      settingsStoreCache = await load('settings.json');
    } else {
      settingsStoreCache = {
        get: async <T>(key: string) => (mockStore.get(key) ?? null) as T | null,
        set: async (key: string, value: unknown) => { mockStore.set(key, value); },
        save: async () => {}
      } as unknown as Store;
    }
  }
  return settingsStoreCache;
}

export interface SettingsSlice {
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
}

export const createSettingsSlice: StateCreator<DownloadState, [], [], SettingsSlice> = (set) => ({
  defaultDownloadDir: '',
  maxConcurrentDownloads: 5,
  splitConnections: 16,
  autoStart: false,
  safeBrowsingApiKey: '',

  initSettings: async () => {
    const store = await getSettingsStore();
    const maxConcurrent = await store.get<number>('maxConcurrentDownloads') || 5;
    const split = await store.get<number>('splitConnections') || 16;
    const dir = await store.get<string>('defaultDownloadDir') || '';
    const apiKey = await store.get<string>('safeBrowsingApiKey') || '';

    let autoStartEnabled = false;
    try {
      autoStartEnabled = await isAutostartEnabled();
    } catch {}

    set({
      maxConcurrentDownloads: maxConcurrent,
      splitConnections: split,
      defaultDownloadDir: dir,
      autoStart: autoStartEnabled,
      safeBrowsingApiKey: apiKey
    });

    try {
      await aria2Client.changeGlobalOption({
        'max-concurrent-downloads': maxConcurrent.toString(),
        'split': split.toString(),
        'max-connection-per-server': split.toString(),
        'min-split-size': '1M'
      });
    } catch {}
  },

  setDefaultDownloadDir: async (dir: string) => {
    const store = await getSettingsStore();
    await store.set('defaultDownloadDir', dir);
    await store.save();
    set({ defaultDownloadDir: dir });
  },

  setMaxConcurrentDownloads: async (max: number) => {
    const store = await getSettingsStore();
    await store.set('maxConcurrentDownloads', max);
    await store.save();
    set({ maxConcurrentDownloads: max });
    try {
      await aria2Client.changeGlobalOption({ 'max-concurrent-downloads': max.toString() });
    } catch (err) {
      console.warn('Failed to update aria2 max-concurrent-downloads:', err);
    }
  },

  setSplitConnections: async (split: number) => {
    const store = await getSettingsStore();
    await store.set('splitConnections', split);
    await store.save();
    set({ splitConnections: split });
    try {
      await aria2Client.changeGlobalOption({
        'split': split.toString(),
        'max-connection-per-server': split.toString(),
        'min-split-size': '1M'
      });
    } catch (err) {
      console.warn('Failed to update aria2 split connections:', err);
    }
  },

  setAutoStart: async (enabled: boolean) => {
    try {
      if (enabled) {
        await enableAutostart();
      } else {
        await disableAutostart();
      }
      set({ autoStart: enabled });
    } catch (e) {
      console.error('Failed to toggle autostart', e);
    }
  },

  setSafeBrowsingApiKey: async (key: string) => {
    const store = await getSettingsStore();
    await store.set('safeBrowsingApiKey', key);
    await store.save();
    set({ safeBrowsingApiKey: key });
  },
});
