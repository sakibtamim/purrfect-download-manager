import { describe, it, expect } from 'vitest';
import { calculateOptimalSplit } from './networkOptimizer';

describe('calculateOptimalSplit', () => {
  describe('Media and YouTube Streams', () => {
    it('allocates maximum 32 splits for YouTube URLs', () => {
      const result = calculateOptimalSplit({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        fileSize: 1024 * 1024 // Even small sizes should saturate
      });

      expect(result).toEqual({
        split: 32,
        maxConnectionPerServer: 16,
        minSplitSize: '1M'
      });
    });

    it('allocates 32 splits when sourceUrl is a YouTube URL', () => {
      const result = calculateOptimalSplit({
        url: 'https://cdn.example.com/video.mp4',
        sourceUrl: 'https://youtu.be/dQw4w9WgXcQ'
      });

      expect(result).toEqual({
        split: 32,
        maxConnectionPerServer: 16,
        minSplitSize: '1M'
      });
    });

    it('allocates 32 splits for GoogleVideo CDN chunks', () => {
      const result = calculateOptimalSplit({
        url: 'https://rr2---sn-4g5ednks.googlevideo.com/videoplayback?expire=12345'
      });

      expect(result).toEqual({
        split: 32,
        maxConnectionPerServer: 16,
        minSplitSize: '1M'
      });
    });

    it('allocates 32 splits for HLS and DASH manifests (.m3u8, .mpd)', () => {
      const m3u8Result = calculateOptimalSplit({
        url: 'https://stream.example.com/live/index.m3u8'
      });
      expect(m3u8Result.split).toBe(32);
      expect(m3u8Result.maxConnectionPerServer).toBe(16);

      const mpdResult = calculateOptimalSplit({
        url: 'https://stream.example.com/dash/manifest.mpd'
      });
      expect(mpdResult.split).toBe(32);
      expect(mpdResult.maxConnectionPerServer).toBe(16);
    });
  });

  describe('Unthrottled Maximum Speed Across All File Sizes', () => {
    it('allocates 32 connections for small files (< 5MB)', () => {
      const oneMb = calculateOptimalSplit({
        url: 'https://example.com/document.pdf',
        fileSize: 1024 * 1024
      });
      expect(oneMb).toEqual({
        split: 32,
        maxConnectionPerServer: 16,
        minSplitSize: '1M'
      });

      const justUnderFiveMb = calculateOptimalSplit({
        url: 'https://example.com/image.png',
        fileSize: 5 * 1024 * 1024 - 1
      });
      expect(justUnderFiveMb).toEqual({
        split: 32,
        maxConnectionPerServer: 16,
        minSplitSize: '1M'
      });
    });

    it('allocates 32 connections for medium files (5MB - 50MB)', () => {
      const exactFiveMb = calculateOptimalSplit({
        url: 'https://example.com/archive.zip',
        fileSize: 5 * 1024 * 1024
      });
      expect(exactFiveMb).toEqual({
        split: 32,
        maxConnectionPerServer: 16,
        minSplitSize: '1M'
      });

      const twentyMb = calculateOptimalSplit({
        url: 'https://example.com/audio.flac',
        fileSize: 20 * 1024 * 1024
      });
      expect(twentyMb).toEqual({
        split: 32,
        maxConnectionPerServer: 16,
        minSplitSize: '1M'
      });
    });

    it('allocates 32 connections for large and huge files (>= 50MB)', () => {
      const fiftyMb = calculateOptimalSplit({
        url: 'https://example.com/dataset.tar.gz',
        fileSize: 50 * 1024 * 1024
      });
      expect(fiftyMb).toEqual({
        split: 32,
        maxConnectionPerServer: 16,
        minSplitSize: '1M'
      });

      const fourGb = calculateOptimalSplit({
        url: 'https://example.com/game-backup.tar',
        fileSize: 4 * 1024 * 1024 * 1024
      });
      expect(fourGb).toEqual({
        split: 32,
        maxConnectionPerServer: 16,
        minSplitSize: '1M'
      });
    });

    it('allocates 32 connections when fileSize is missing, 0, or negative', () => {
      expect(calculateOptimalSplit({ url: 'https://example.com/file' })).toEqual({
        split: 32,
        maxConnectionPerServer: 16,
        minSplitSize: '1M'
      });

      expect(calculateOptimalSplit({ url: 'https://example.com/file', fileSize: 0 })).toEqual({
        split: 32,
        maxConnectionPerServer: 16,
        minSplitSize: '1M'
      });

      expect(calculateOptimalSplit({ url: 'https://example.com/file', fileSize: -1 })).toEqual({
        split: 32,
        maxConnectionPerServer: 16,
        minSplitSize: '1M'
      });
    });
  });

  describe('Manual Override (dynamicEnabled = false)', () => {
    it('honors user manual setting within bounds', () => {
      const result = calculateOptimalSplit({
        url: 'https://example.com/large.iso',
        fileSize: 10 * 1024 * 1024 * 1024,
        userSetting: 4,
        dynamicEnabled: false
      });

      expect(result).toEqual({
        split: 4,
        maxConnectionPerServer: 4,
        minSplitSize: '1M'
      });
    });

    it('caps maxConnectionPerServer to 16 even if user chooses up to 32', () => {
      const result = calculateOptimalSplit({
        url: 'https://example.com/file.bin',
        userSetting: 32,
        dynamicEnabled: false
      });

      expect(result).toEqual({
        split: 32,
        maxConnectionPerServer: 16,
        minSplitSize: '1M'
      });
    });

    it('clamps user settings between 1 and 32', () => {
      const belowMin = calculateOptimalSplit({
        url: 'https://example.com/file.bin',
        userSetting: 0,
        dynamicEnabled: false
      });
      expect(belowMin.split).toBe(1);
      expect(belowMin.maxConnectionPerServer).toBe(1);

      const aboveMax = calculateOptimalSplit({
        url: 'https://example.com/file.bin',
        userSetting: 64,
        dynamicEnabled: false
      });
      expect(aboveMax.split).toBe(32);
      expect(aboveMax.maxConnectionPerServer).toBe(16);
    });

    it('ignores YouTube detection when dynamic scaling is disabled', () => {
      const result = calculateOptimalSplit({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        userSetting: 6,
        dynamicEnabled: false
      });

      expect(result).toEqual({
        split: 6,
        maxConnectionPerServer: 6,
        minSplitSize: '1M'
      });
    });
  });
});
