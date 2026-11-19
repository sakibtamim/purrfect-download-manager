import { YtDlpFormat } from '@/lib/ytdlpClient';
import { DetectedChecksum } from '@/lib/utils';
import { UISlice } from './slices/uiSlice';
import { SettingsSlice } from './slices/settingsSlice';
import { MuxSlice } from './slices/muxSlice';
import { DownloadDataSlice } from './slices/downloadSlice';

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

export type DownloadState = UISlice & SettingsSlice & MuxSlice & DownloadDataSlice;
