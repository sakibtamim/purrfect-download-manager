import { StateCreator } from 'zustand';
import { DownloadState } from '../types';

export interface UISlice {
  isPlayfulMode: boolean;
  selectedDownloadId: string | null;
  togglePlayfulMode: () => void;
  setSelectedDownload: (gid: string | null) => void;
}

export const createUISlice: StateCreator<DownloadState, [], [], UISlice> = (set) => ({
  isPlayfulMode: false,
  selectedDownloadId: null,
  togglePlayfulMode: () => set((state) => ({ isPlayfulMode: !state.isPlayfulMode })),
  setSelectedDownload: (gid) => set({ selectedDownloadId: gid }),
});
