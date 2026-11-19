import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../index';

export const useActiveDownloads = () =>
  useAppStore(useShallow((state) => state.active));

export const useCompletedDownloads = () =>
  useAppStore(useShallow((state) => state.completed));

export const useFailedDownloads = () =>
  useAppStore(useShallow((state) => state.failed));

export const useGlobalSpeed = () =>
  useAppStore((state) => state.globalSpeed);

export const usePlayfulMode = () =>
  useAppStore((state) => state.isPlayfulMode);

export const useSelectedDownloadId = () =>
  useAppStore((state) => state.selectedDownloadId);

export const useStagedDownload = () =>
  useAppStore((state) => state.stagedDownload);

export const usePendingMuxes = () =>
  useAppStore(useShallow((state) => state.pendingMuxes));

export const useDownloadSummary = () =>
  useAppStore(
    useShallow((state) => ({
      activeCount: state.active.length,
      completedCount: state.completed.length,
      failedCount: state.failed.length,
      globalSpeed: state.globalSpeed,
    }))
  );
