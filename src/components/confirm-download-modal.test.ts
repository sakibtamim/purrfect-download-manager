import { describe, it, expect } from 'vitest';
import { formatResolutionLabel, resolveInitialDownloadSelection } from './confirm-download-modal';
import { YtDlpFormat } from '@/lib/ytdlpClient';

describe('formatResolutionLabel', () => {
  it('formats 4K (2160p) resolutions properly', () => {
    const format4k: YtDlpFormat = {
      format_id: '137',
      ext: 'mp4',
      resolution: '3840x2026',
      width: 3840,
      height: 2026,
      fileSize: 2506.6 * 1024 * 1024,
      url: 'https://example.com/stream-4k'
    };
    expect(formatResolutionLabel(format4k)).toBe('4K (2160p) • 2506.6 MB • MP4');
  });

  it('formats 1440p (2K) resolutions properly', () => {
    const format2k: YtDlpFormat = {
      format_id: '271',
      ext: 'webm',
      resolution: '2560x1440',
      width: 2560,
      height: 1440,
      fileSize: 1200 * 1024 * 1024,
      url: 'https://example.com/stream-2k'
    };
    expect(formatResolutionLabel(format2k)).toBe('1440p (2K) • 1200.0 MB • WEBM');
  });

  it('formats 1080p (Full HD) resolutions properly', () => {
    const format1080: YtDlpFormat = {
      format_id: '137',
      ext: 'mp4',
      resolution: '1920x1080',
      width: 1920,
      height: 1080,
      fileSize: 381.0 * 1024 * 1024,
      url: 'https://example.com/stream-1080'
    };
    expect(formatResolutionLabel(format1080)).toBe('1080p (Full HD) • 381.0 MB • MP4');
  });

  it('formats 720p (HD) resolutions properly', () => {
    const format720: YtDlpFormat = {
      format_id: '22',
      ext: 'mp4',
      resolution: '1280x720',
      width: 1280,
      height: 720,
      fileSize: 150 * 1024 * 1024,
      url: 'https://example.com/stream-720'
    };
    expect(formatResolutionLabel(format720)).toBe('720p (HD) • 150.0 MB • MP4');
  });

  it('formats 480p and 360p resolutions properly', () => {
    const format480: YtDlpFormat = {
      format_id: '135',
      ext: 'mp4',
      resolution: '854x480',
      width: 854,
      height: 480,
      fileSize: 80 * 1024 * 1024,
      url: 'https://example.com/stream-480'
    };
    expect(formatResolutionLabel(format480)).toBe('480p • 80.0 MB • MP4');

    const format360: YtDlpFormat = {
      format_id: '134',
      ext: 'mp4',
      resolution: '640x360',
      width: 640,
      height: 360,
      fileSize: 40 * 1024 * 1024,
      url: 'https://example.com/stream-360'
    };
    expect(formatResolutionLabel(format360)).toBe('360p • 40.0 MB • MP4');
  });

  it('parses resolution string if width and height are absent', () => {
    const formatFromStr: YtDlpFormat = {
      format_id: 'custom',
      ext: 'mp4',
      resolution: '1920x1080',
      fileSize: 200 * 1024 * 1024,
      url: 'https://example.com/stream'
    };
    expect(formatResolutionLabel(formatFromStr)).toBe('1080p (Full HD) • 200.0 MB • MP4');

    const formatPStr: YtDlpFormat = {
      format_id: 'custom720',
      ext: 'mp4',
      resolution: '720p',
      fileSize: 100 * 1024 * 1024,
      url: 'https://example.com/stream'
    };
    expect(formatResolutionLabel(formatPStr)).toBe('720p (HD) • 100.0 MB • MP4');
  });

  it('handles unknown size and fallback resolution gracefully', () => {
    const formatAudio: YtDlpFormat = {
      format_id: '140',
      ext: 'm4a',
      resolution: 'audio only',
      fileSize: 0,
      url: 'https://example.com/audio'
    };
    expect(formatResolutionLabel(formatAudio)).toBe('audio only • Unknown Size • M4A');
  });
});

describe('resolveInitialDownloadSelection', () => {
  it('selects the first mediaFormat url and format size when mediaFormats are available', () => {
    const staged = {
      url: 'https://manifest.googlevideo.com/playlist/index.m3u8',
      fileSize: 2 * 1024 * 1024,
      mediaFormats: [
        {
          format_id: '137',
          ext: 'mp4',
          resolution: '1920x1080',
          fileSize: 1587.4 * 1024 * 1024,
          url: 'https://rr4---sn.googlevideo.com/videoplayback?itag=137'
        },
        {
          format_id: '22',
          ext: 'mp4',
          resolution: '1280x720',
          fileSize: 120 * 1024 * 1024,
          url: 'https://rr4---sn.googlevideo.com/videoplayback?itag=22'
        }
      ]
    };

    const result = resolveInitialDownloadSelection(staged);
    expect(result.selectedUrl).toBe('https://rr4---sn.googlevideo.com/videoplayback?itag=137');
    expect(result.selectedUrl).not.toBe(staged.url);
    expect(result.displaySize).toBe('1587.40 MB');
  });

  it('falls back to stagedDownload url and fileSize when mediaFormats is empty or absent', () => {
    const stagedDirect = {
      url: 'https://example.com/file.zip',
      fileSize: 50 * 1024 * 1024,
    };

    const result = resolveInitialDownloadSelection(stagedDirect);
    expect(result.selectedUrl).toBe('https://example.com/file.zip');
    expect(result.displaySize).toBe('50.00 MB');

    const stagedUnknown = {
      url: 'https://example.com/unknown.bin',
      fileSize: 0,
    };
    expect(resolveInitialDownloadSelection(stagedUnknown).displaySize).toBe('Unknown size');
  });
});
