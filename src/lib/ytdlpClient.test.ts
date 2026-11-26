import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ytdlpClient, downloadMediaStream, isDirectHttp, RawFormat } from './ytdlpClient';
import { Command } from '@tauri-apps/plugin-shell';

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: {
    sidecar: vi.fn(),
    create: vi.fn(),
  },
}));

describe('isDirectHttp', () => {
  it('returns true for progressive HTTP/HTTPS video formats', () => {
    const directFormat: RawFormat = {
      protocol: 'https',
      url: 'https://rr1---sn-4g5ednks.googlevideo.com/videoplayback?id=123',
    };
    expect(isDirectHttp(directFormat)).toBe(true);
  });

  it('rejects formats where protocol indicates m3u8 / m3u8_native', () => {
    const hlsFormat: RawFormat = {
      protocol: 'm3u8_native',
      url: 'https://manifest.googlevideo.com/api/manifest/hls_variant/video.m3u8',
    };
    expect(isDirectHttp(hlsFormat)).toBe(false);

    const m3u8Proto: RawFormat = {
      protocol: 'm3u8',
      url: 'https://example.com/playlist',
    };
    expect(isDirectHttp(m3u8Proto)).toBe(false);
  });

  it('rejects formats where URL contains .m3u8 or /hls_playlist/', () => {
    const m3u8Url: RawFormat = {
      protocol: 'https',
      url: 'https://rr4---sn-jpgjax-q5je.googlevideo.com/videoplayback/itag/616/playlist/index.m3u8',
    };
    expect(isDirectHttp(m3u8Url)).toBe(false);

    const hlsPlaylistUrl: RawFormat = {
      protocol: 'https',
      url: 'https://example.com/hls_playlist/master.txt',
    };
    expect(isDirectHttp(hlsPlaylistUrl)).toBe(false);
  });
});

describe('ytdlpClient.extractVideoInfo', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('filters out HLS/m3u8 streams and selects highest progressive HTTP stream', async () => {
    const mockOutput = {
      code: 0,
      stdout: JSON.stringify({
        title: 'LEO Official Trailer',
        thumbnail: 'https://i.ytimg.com/vi/trailer.jpg',
        url: 'https://rr4---sn-jpgjax-q5je.googlevideo.com/itag/616/playlist/index.m3u8',
        protocol: 'm3u8_native',
        duration: 165,
        formats: [
          // Format 616: 1080p Premium HLS (Must be filtered out)
          {
            format_id: '616',
            resolution: '1920x1080',
            width: 1920,
            height: 1080,
            vcodec: 'avc1.64002a',
            acodec: 'none',
            protocol: 'm3u8_native',
            url: 'https://rr4---sn-jpgjax-q5je.googlevideo.com/itag/616/playlist/index.m3u8',
            filesize_approx: 1587 * 1024 * 1024,
          },
          // Format 137: 1080p Direct HTTP Video (Valid)
          {
            format_id: '137',
            resolution: '1920x1080',
            width: 1920,
            height: 1080,
            vcodec: 'avc1.640028',
            acodec: 'none',
            protocol: 'https',
            url: 'https://rr4---sn-jpgjax-q5je.googlevideo.com/videoplayback?itag=137',
            filesize: 350 * 1024 * 1024,
          },
          // Format 22: 720p Direct HTTP with Audio (Valid)
          {
            format_id: '22',
            resolution: '1280x720',
            width: 1280,
            height: 720,
            vcodec: 'avc1.64001f',
            acodec: 'mp4a.40.2',
            protocol: 'https',
            url: 'https://rr4---sn-jpgjax-q5je.googlevideo.com/videoplayback?itag=22',
            filesize: 120 * 1024 * 1024,
          },
          // Format 95: HLS Audio (Must be filtered out)
          {
            format_id: '95',
            vcodec: 'none',
            acodec: 'mp4a.40.2',
            abr: 160,
            protocol: 'm3u8_native',
            url: 'https://rr4---sn-jpgjax-q5je.googlevideo.com/audio/index.m3u8',
            filesize_approx: 25 * 1024 * 1024,
          },
          // Format 140: Direct HTTP Audio (Valid)
          {
            format_id: '140',
            vcodec: 'none',
            acodec: 'mp4a.40.2',
            abr: 128,
            protocol: 'https',
            url: 'https://rr4---sn-jpgjax-q5je.googlevideo.com/videoplayback?itag=140',
            filesize: 15 * 1024 * 1024,
          },
        ],
      }),
      stderr: '',
    };

    (Command.sidecar as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      execute: vi.fn().mockResolvedValue(mockOutput),
    });

    const info = await ytdlpClient.extractVideoInfo('https://www.youtube.com/watch?v=mock');

    // directUrl should not be the m3u8 playlist; it must fall back to the top direct HTTP format (137)
    expect(info.url).toBe('https://rr4---sn-jpgjax-q5je.googlevideo.com/videoplayback?itag=137');
    expect(info.url).not.toContain('.m3u8');

    // Available formats must NOT include format 616 (HLS)
    expect(info.formats.find(f => f.format_id === '616')).toBeUndefined();

    // Available formats must include format 137 and format 22
    const format137 = info.formats.find(f => f.format_id === '137');
    expect(format137).toBeDefined();
    expect(format137?.audioUrl).toBe('https://rr4---sn-jpgjax-q5je.googlevideo.com/videoplayback?itag=140');
    // Ensure the audio URL is not the m3u8 audio
    expect(format137?.audioUrl).not.toContain('.m3u8');
  });

  it('prioritizes original / non-dubbed audio over higher-bitrate auto-dubbed audio', async () => {
    const mockOutput = {
      code: 0,
      stdout: JSON.stringify({
        title: 'Multi-language Audio Video',
        formats: [
          // Video only stream (1080p)
          {
            format_id: '137',
            resolution: '1920x1080',
            width: 1920,
            height: 1080,
            vcodec: 'avc1.640028',
            acodec: 'none',
            protocol: 'https',
            url: 'https://video.example.com/137.mp4',
            filesize: 300 * 1024 * 1024,
          },
          // Foreign auto-dubbed audio with higher bitrate (e.g. Malayalam 175 kbps, language_preference -10)
          {
            format_id: '251-dubbed-ml',
            format_note: 'medium, dubbed',
            vcodec: 'none',
            acodec: 'opus',
            abr: 175,
            language: 'ml',
            language_preference: -10,
            protocol: 'https',
            url: 'https://audio.example.com/foreign-dubbed.opus',
            filesize: 25 * 1024 * 1024,
          },
          // Original English audio with lower bitrate (137 kbps, language_preference 0)
          {
            format_id: '251-original-en',
            format_note: 'medium, original',
            vcodec: 'none',
            acodec: 'opus',
            abr: 137,
            language: 'en',
            language_preference: 0,
            protocol: 'https',
            url: 'https://audio.example.com/original-en.opus',
            filesize: 20 * 1024 * 1024,
          },
        ],
      }),
      stderr: '',
    };

    (Command.sidecar as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      execute: vi.fn().mockResolvedValue(mockOutput),
    });

    const info = await ytdlpClient.extractVideoInfo('https://www.youtube.com/watch?v=F_DVcBW3KAg');
    const format137 = info.formats.find(f => f.format_id === '137');
    expect(format137).toBeDefined();
    expect(format137?.audioUrl).toBe('https://audio.example.com/original-en.opus');
    expect(format137?.audioUrl).not.toBe('https://audio.example.com/foreign-dubbed.opus');
  });

  it('passes --js-runtimes node to yt-dlp arguments to solve YouTube n cipher challenge', async () => {
    const mockOutput = {
      code: 0,
      stdout: JSON.stringify({
        title: 'Test',
        url: 'https://example.com/video.mp4',
        formats: [],
      }),
      stderr: '',
    };

    const sidecarSpy = (Command.sidecar as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      execute: vi.fn().mockResolvedValue(mockOutput),
    });

    await ytdlpClient.extractVideoInfo('https://www.youtube.com/watch?v=cipher-test');

    expect(sidecarSpy).toHaveBeenCalled();
    const passedArgs = sidecarSpy.mock.calls[sidecarSpy.mock.calls.length - 1][1] as string[];
    expect(passedArgs).toContain('--js-runtimes');
    expect(passedArgs[passedArgs.indexOf('--js-runtimes') + 1]).toBe('node');
  });
});

describe('ytdlpClient.downloadMediaStream', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('invokes pdm-yt-dlp with -N 16 concurrent fragments and --js-runtimes node', async () => {
    const mockOutput = {
      code: 0,
      stdout: '[download] 100% of 50.00MiB in 00:01',
      stderr: '',
    };

    const sidecarSpy = (Command.sidecar as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      execute: vi.fn().mockResolvedValue(mockOutput),
    });

    const result = await downloadMediaStream({
      url: 'https://www.youtube.com/watch?v=stream-test',
      outputDir: '/downloads',
      filename: 'my-video.mp4',
      formatId: '137+140',
      concurrentFragments: 16,
    });

    expect(result.code).toBe(0);
    expect(sidecarSpy).toHaveBeenCalled();
    const passedArgs = sidecarSpy.mock.calls[0][1] as string[];
    expect(passedArgs).toContain('-N');
    expect(passedArgs[passedArgs.indexOf('-N') + 1]).toBe('16');
    expect(passedArgs).toContain('--js-runtimes');
    expect(passedArgs[passedArgs.indexOf('--js-runtimes') + 1]).toBe('node');
    expect(passedArgs).toContain('-f');
    expect(passedArgs[passedArgs.indexOf('-f') + 1]).toBe('137+140');
    expect(passedArgs).toContain('-o');
    expect(passedArgs[passedArgs.indexOf('-o') + 1]).toBe('/downloads/my-video.mp4');
    expect(passedArgs).toContain('https://www.youtube.com/watch?v=stream-test');
  });
});
