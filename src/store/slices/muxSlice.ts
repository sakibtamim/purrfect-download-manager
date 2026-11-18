import { StateCreator } from 'zustand';
import { DownloadState, PendingMux } from '../types';

export interface MuxSlice {
  pendingMuxes: PendingMux[];
  setPendingMuxes: (muxes: PendingMux[]) => void;
  addPendingMux: (mux: PendingMux) => void;
  removePendingMux: (mux: PendingMux) => void;
}

export const createMuxSlice: StateCreator<DownloadState, [], [], MuxSlice> = (set) => ({
  pendingMuxes: [],
  setPendingMuxes: (muxes) => set({ pendingMuxes: muxes }),
  addPendingMux: (mux) => set((state) => ({ pendingMuxes: [...state.pendingMuxes, mux] })),
  removePendingMux: (mux) => set((state) => ({
    pendingMuxes: state.pendingMuxes.filter(
      (m) => !(m.videoGid === mux.videoGid && m.audioGid === mux.audioGid)
    ),
  })),
});
