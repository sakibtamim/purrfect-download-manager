import { StateCreator } from 'zustand';
import { DownloadState } from '../types';

export type ViewMode = 'table' | 'cards';

export interface UISlice {
  isPlayfulMode: boolean;
  selectedDownloadId: string | null;
  viewMode: ViewMode;
  togglePlayfulMode: () => void;
  setSelectedDownload: (gid: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
}

export const createUISlice: StateCreator<DownloadState, [], [], UISlice> = (set) => ({
  isPlayfulMode: false,
  selectedDownloadId: null,
  viewMode: 'table',
  togglePlayfulMode: () => set((state) => ({ isPlayfulMode: !state.isPlayfulMode })),
  setSelectedDownload: (gid) => set({ selectedDownloadId: gid }),
  setViewMode: (mode) => set({ viewMode: mode }),
});
