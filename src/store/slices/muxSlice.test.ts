import { describe, it, expect } from 'vitest';
import { create, StoreApi } from 'zustand';
import { createMuxSlice, MuxSlice } from './muxSlice';
import { PendingMux, DownloadState } from '../types';

describe('muxSlice', () => {
  it('adds and removes pending muxes using composite key matching', () => {
    const useTestStore = create<MuxSlice>()((set, get, api) =>
      createMuxSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    const mux1: PendingMux = {
      videoGid: 'vid-101',
      audioGid: 'aud-202',
      finalFilename: 'video1.mp4',
      status: 'waiting',
    };
    const mux2: PendingMux = {
      videoGid: 'vid-303',
      audioGid: 'aud-404',
      finalFilename: 'video2.mp4',
      status: 'waiting',
    };

    useTestStore.getState().addPendingMux(mux1);
    useTestStore.getState().addPendingMux(mux2);
    expect(useTestStore.getState().pendingMuxes).toHaveLength(2);

    // Remove using a cloned object with identical composite key (tests value equality)
    useTestStore.getState().removePendingMux({
      videoGid: 'vid-101',
      audioGid: 'aud-202',
      finalFilename: 'different-filename.mp4',
      status: 'muxing',
    });

    expect(useTestStore.getState().pendingMuxes).toHaveLength(1);
    expect(useTestStore.getState().pendingMuxes[0].videoGid).toBe('vid-303');
  });

  it('updates pending muxes list with setPendingMuxes', () => {
    const useTestStore = create<MuxSlice>()((set, get, api) =>
      createMuxSlice(set, get as () => DownloadState, api as unknown as StoreApi<DownloadState>)
    );

    const list: PendingMux[] = [
      {
        videoGid: 'v1',
        audioGid: 'a1',
        finalFilename: 'test.mp4',
        status: 'muxing',
      },
    ];

    useTestStore.getState().setPendingMuxes(list);
    expect(useTestStore.getState().pendingMuxes).toEqual(list);
  });
});


