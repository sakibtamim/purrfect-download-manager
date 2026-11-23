import { YtDlpFormat } from '@/lib/ytdlpClient';
import { DetectedChecksum } from '@/lib/utils';
import { UISlice, ViewMode } from './slices/uiSlice';
import { SettingsSlice } from './slices/settingsSlice';
import { MuxSlice } from './slices/muxSlice';
import { DownloadDataSlice, EngineStatus } from './slices/downloadSlice';

export type { ViewMode, EngineStatus };

export interface StagedDownload {
  url: string;
  sourceUrl?: string;
  headers: string[];
  filename?: string;
  fileSize?: number;
  mediaFormats?: YtDlpFormat[];
  checksum?: DetectedChecksum;
}

export interface PendingMux {
  videoGid: string;
  audioGid: string;
  finalFilename: string;
  status: 'waiting' | 'muxing' | 'error';
}

export interface DownloadMetadata {
  sourceUrl?: string;
  title?: string;
}

export type SettingsState = SettingsSlice;

export type DownloadState = UISlice & SettingsSlice & MuxSlice & DownloadDataSlice;
