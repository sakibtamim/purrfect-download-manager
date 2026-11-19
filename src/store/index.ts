import { create } from 'zustand';
import { DownloadState } from './types';
import { createUISlice } from './slices/uiSlice';
import { createSettingsSlice } from './slices/settingsSlice';
import { createMuxSlice } from './slices/muxSlice';
import { createDownloadSlice } from './slices/downloadSlice';

export * from './types';
export * from './slices/uiSlice';
export * from './slices/settingsSlice';
export * from './slices/muxSlice';
export * from './slices/downloadSlice';

export const useAppStore = create<DownloadState>((set, get, api) => ({
  ...createUISlice(set, get, api),
  ...createSettingsSlice(set, get, api),
  ...createMuxSlice(set, get, api),
  ...createDownloadSlice(set, get, api),
}));

// Backward-compatible alias
export const useDownloadStore = useAppStore;
