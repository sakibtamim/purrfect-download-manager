import { StateCreator } from 'zustand';
import { Store, load } from '@tauri-apps/plugin-store';
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from '@tauri-apps/plugin-autostart';
import { aria2Client } from '@/lib/aria2Client';
import { SpeedUnit } from '@/lib/utils';
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
  dynamicConnections: boolean;
  speedUnit: SpeedUnit;
  autoStart: boolean;
  safeBrowsingApiKey: string;
  closeToTray: boolean;
  minimizeToTray: boolean;
  startMinimized: boolean;
  showTaskbarProgress: boolean;

  initSettings: () => Promise<void>;
  setDefaultDownloadDir: (dir: string) => Promise<void>;
  setMaxConcurrentDownloads: (max: number) => Promise<void>;
  setSplitConnections: (split: number) => Promise<void>;
  setDynamicConnections: (enabled: boolean) => Promise<void>;
  setSpeedUnit: (unit: SpeedUnit) => Promise<void>;
  setAutoStart: (enabled: boolean) => Promise<void>;
  setSafeBrowsingApiKey: (key: string) => Promise<void>;
  setCloseToTray: (enabled: boolean) => Promise<void>;
  setMinimizeToTray: (enabled: boolean) => Promise<void>;
  setStartMinimized: (enabled: boolean) => Promise<void>;
  setShowTaskbarProgress: (enabled: boolean) => Promise<void>;
}

export const createSettingsSlice: StateCreator<DownloadState, [], [], SettingsSlice> = (set) => ({
  defaultDownloadDir: '',
  maxConcurrentDownloads: 5,
  splitConnections: 32,
  dynamicConnections: true,
  speedUnit: 'MBps',
  autoStart: false,
  safeBrowsingApiKey: '',
  closeToTray: true,
  minimizeToTray: false,
  startMinimized: false,
  showTaskbarProgress: true,

  initSettings: async () => {
    const store = await getSettingsStore();
    const maxConcurrent = await store.get<number>('maxConcurrentDownloads') || 5;
    const split = await store.get<number>('splitConnections') || 32;
    const storedDynamic = await store.get<boolean>('dynamicConnections');
    const dynamicConn = storedDynamic !== null && storedDynamic !== undefined ? storedDynamic : true;
    const storedSpeedUnit = await store.get<SpeedUnit>('speedUnit');
    const speedUnit: SpeedUnit = (storedSpeedUnit === 'Mbps' || storedSpeedUnit === 'MBps') ? storedSpeedUnit : 'MBps';
    const dir = await store.get<string>('defaultDownloadDir') || '';
    const apiKey = await store.get<string>('safeBrowsingApiKey') || '';

    const storedCloseToTray = await store.get<boolean>('closeToTray');
    const closeToTray = storedCloseToTray !== null && storedCloseToTray !== undefined ? storedCloseToTray : true;
    const storedMinimizeToTray = await store.get<boolean>('minimizeToTray');
    const minimizeToTray = storedMinimizeToTray !== null && storedMinimizeToTray !== undefined ? storedMinimizeToTray : false;
    const storedStartMinimized = await store.get<boolean>('startMinimized');
    const startMinimized = storedStartMinimized !== null && storedStartMinimized !== undefined ? storedStartMinimized : false;
    const storedShowTaskbarProgress = await store.get<boolean>('showTaskbarProgress');
    const showTaskbarProgress = storedShowTaskbarProgress !== null && storedShowTaskbarProgress !== undefined ? storedShowTaskbarProgress : true;

    let autoStartEnabled = false;
    try {
      autoStartEnabled = await isAutostartEnabled();
    } catch (err) {
      console.warn('Failed to check autostart status:', err);
    }

    set({
      maxConcurrentDownloads: maxConcurrent,
      splitConnections: split,
      dynamicConnections: dynamicConn,
      speedUnit: speedUnit,
      defaultDownloadDir: dir,
      autoStart: autoStartEnabled,
      safeBrowsingApiKey: apiKey,
      closeToTray,
      minimizeToTray,
      startMinimized,
      showTaskbarProgress,
    });

    try {
      await aria2Client.changeGlobalOption({
        'max-concurrent-downloads': maxConcurrent.toString(),
        'split': split.toString(),
        'max-connection-per-server': Math.min(split, 16).toString(),
        'min-split-size': '1M'
      });
    } catch (err) {
      console.warn('Failed to apply initial aria2 settings:', err);
    }
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
        'max-connection-per-server': Math.min(split, 16).toString(),
        'min-split-size': '1M'
      });
    } catch (err) {
      console.warn('Failed to update aria2 split connections:', err);
    }
  },

  setDynamicConnections: async (enabled: boolean) => {
    const store = await getSettingsStore();
    await store.set('dynamicConnections', enabled);
    await store.save();
    set({ dynamicConnections: enabled });
  },

  setSpeedUnit: async (unit: SpeedUnit) => {
    const store = await getSettingsStore();
    await store.set('speedUnit', unit);
    await store.save();
    set({ speedUnit: unit });
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

  setCloseToTray: async (enabled: boolean) => {
    const store = await getSettingsStore();
    await store.set('closeToTray', enabled);
    await store.save();
    set({ closeToTray: enabled });
  },

  setMinimizeToTray: async (enabled: boolean) => {
    const store = await getSettingsStore();
    await store.set('minimizeToTray', enabled);
    await store.save();
    set({ minimizeToTray: enabled });
  },

  setStartMinimized: async (enabled: boolean) => {
    const store = await getSettingsStore();
    await store.set('startMinimized', enabled);
    await store.save();
    set({ startMinimized: enabled });
  },

  setShowTaskbarProgress: async (enabled: boolean) => {
    const store = await getSettingsStore();
    await store.set('showTaskbarProgress', enabled);
    await store.save();
    set({ showTaskbarProgress: enabled });
  },
});
