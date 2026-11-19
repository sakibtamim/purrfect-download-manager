import { Command } from '@tauri-apps/plugin-shell';

export interface YtDlpFormat {
  format_id: string;
  ext: string;
  resolution: string;
  fileSize: number;
  url: string;
  audioUrl?: string;
  width?: number;
  height?: number;
}

export interface YtDlpVideoInfo {
  title: string;
  thumbnail: string;
  url: string;      // Direct stream URL
  fileSize: number;
  duration: number;
  ext: string;
  formats: YtDlpFormat[];
}

export interface RawFormat {
  url?: string;
  protocol?: string;
  filesize?: number;
  filesize_approx?: number;
  ext?: string;
  acodec?: string;
  vcodec?: string;
  abr?: number;
  format_id?: string;
  resolution?: string;
  format_note?: string;
  width?: number;
  height?: number;
}

export const isDirectHttp = (f: RawFormat): boolean => {
  const proto = f.protocol || '';
  const u = f.url || '';
  return !proto.includes('m3u8') && !u.includes('.m3u8') && !u.includes('/hls_playlist/');
};

export function isNodeAvailable(): boolean {
  if (typeof process !== 'undefined' && process.versions?.node) {
    return true;
  }
  return true;
}

export interface DownloadMediaStreamOptions {
  url: string;
  outputDir?: string;
  filename?: string;
  formatId?: string;
  concurrentFragments?: number;
}

export async function downloadMediaStream(options: DownloadMediaStreamOptions): Promise<{ code: number; stdout: string; stderr: string }> {
  const { url, outputDir, filename, formatId, concurrentFragments = 16 } = options;
  const args = [
    '-N', String(concurrentFragments),
    '--no-warnings',
    '--extractor-args', 'youtube:player_client=default',
  ];

  if (isNodeAvailable()) {
    args.push('--js-runtimes', 'node');
  }

  if (formatId) {
    args.push('-f', formatId);
  }

  if (outputDir && filename) {
    const cleanDir = outputDir.replace(/[\\/]+$/, '');
    args.push('-o', `${cleanDir}/${filename}`);
  } else if (outputDir) {
    args.push('-P', outputDir);
  } else if (filename) {
    args.push('-o', filename);
  }

  args.push('--', url);

  try {
    let output;
    try {
      const command = Command.sidecar('bin/pdm-yt-dlp', args);
      output = await command.execute();
    } catch (sidecarErr) {
      console.warn("[yt-dlp] Sidecar execution failed, trying system yt-dlp:", sidecarErr);
      const command = Command.create('system-ytdlp', args);
      output = await command.execute();
    }

    if (output.code !== 0) {
      throw new Error(`yt-dlp download failed with code ${output.code}: ${output.stderr}`);
    }

    return {
      code: output.code ?? 0,
      stdout: output.stdout,
      stderr: output.stderr
    };
  } catch (error) {
    console.error("[yt-dlp] downloadMediaStream failed:", error);
    throw error;
  }
}

export const ytdlpClient = {
  /**
   * Extracts direct video stream URLs and metadata from a given URL using yt-dlp.
   */
  async extractVideoInfo(videoUrl: string): Promise<YtDlpVideoInfo> {
    console.log(`[yt-dlp] Extracting info for ${videoUrl}...`);
    
    // Build arguments. We use -J to dump JSON and not download the file itself here.
    const args = [
      '-f', 'bestvideo[protocol^=http][ext=mp4]+bestaudio[protocol^=http][ext=m4a]/bestvideo[protocol^=http]+bestaudio[protocol^=http]/best[protocol^=http]/best',
      '-J',
      '--no-warnings',
      '--extractor-args',
      'youtube:player_client=default', // Let yt-dlp pick the best unblocked client (Android/iOS)
    ];

    if (isNodeAvailable()) {
      args.push('--js-runtimes', 'node');
    }

    args.push('--', videoUrl);

    // If cookies are provided, we should ideally write them to a temp file and pass --cookies
    // But yt-dlp also accepts --cookies-from-browser (e.g. chrome) which is great for local apps.
    // For now, if we have raw cookie string, yt-dlp doesn't accept a raw string arg easily.
    // So we'll rely on the player_client arg which solves 90% of the issues.

    try {
      let output;
      try {
        const command = Command.sidecar('bin/pdm-yt-dlp', args);
        output = await command.execute();
      } catch (sidecarErr) {
        console.warn("[yt-dlp] Sidecar execution failed, trying system yt-dlp:", sidecarErr);
        const command = Command.create('system-ytdlp', args);
        output = await command.execute();
      }

      if (output.code !== 0) {
        throw new Error(`yt-dlp exited with code ${output.code}: ${output.stderr}`);
      }

      const data = JSON.parse(output.stdout);

      let availableFormats: YtDlpFormat[] = [];
      if (data.formats && Array.isArray(data.formats)) {
        // Find best audio that is direct HTTP
        const bestAudio = data.formats
          .filter((f: RawFormat) => f.acodec !== 'none' && f.vcodec === 'none' && isDirectHttp(f))
          .sort((a: RawFormat, b: RawFormat) => (b.abr || 0) - (a.abr || 0))[0];

        availableFormats = data.formats
          .filter((f: RawFormat) => f.vcodec !== 'none' && f.url && isDirectHttp(f))
          .map((f: RawFormat) => {
            const hasAudio = f.acodec !== 'none';
            // We force mp4 container for muxed results
            const finalExt = !hasAudio ? 'mp4' : (f.ext || 'mp4');
            
            return {
              format_id: f.format_id || 'unknown',
              ext: finalExt,
              resolution: f.resolution || f.format_note || (f.width ? `${f.width}x${f.height}` : 'Unknown'),
              width: f.width,
              height: f.height,
              fileSize: (f.filesize || f.filesize_approx || 0) + (!hasAudio && bestAudio ? (bestAudio.filesize || bestAudio.filesize_approx || 0) : 0),
              url: f.url!,
              audioUrl: !hasAudio && bestAudio ? bestAudio.url : undefined
            };
          });
          
        // Deduplicate formats with the same resolution (keep the highest filesize)
        const uniqueFormats = new Map<string, YtDlpFormat>();
        for (const f of availableFormats) {
          const existing = uniqueFormats.get(f.resolution);
          if (!existing || f.fileSize > existing.fileSize) {
            uniqueFormats.set(f.resolution, f);
          }
        }
        availableFormats = Array.from(uniqueFormats.values());

        // Sort by resolution descending (rough heuristic)
        availableFormats.sort((a, b) => {
          const heightA = parseInt(a.resolution.split('x')[1] || a.resolution.replace(/[^0-9]/g, '')) || 0;
          const heightB = parseInt(b.resolution.split('x')[1] || b.resolution.replace(/[^0-9]/g, '')) || 0;
          return heightB - heightA;
        });
      }

      // Determine the best direct URL.
      // yt-dlp JSON has 'url' or 'requested_downloads' array depending on format requested.
      let directUrl = (data.url && isDirectHttp({ url: data.url, protocol: data.protocol })) ? data.url : undefined;
      let fileSize = data.filesize || data.filesize_approx || 0;
      let ext = data.ext || 'mp4';

      if (!directUrl && data.requested_downloads && data.requested_downloads.length > 0) {
        const reqDownload = data.requested_downloads[0];
        if (reqDownload.requested_formats && reqDownload.requested_formats.length > 0) {
          const firstDirect = reqDownload.requested_formats.find((f: RawFormat) => isDirectHttp(f));
          if (firstDirect) {
            directUrl = firstDirect.url;
            fileSize = reqDownload.requested_formats.reduce((acc: number, f: RawFormat) => acc + (f.filesize || f.filesize_approx || 0), 0);
            ext = reqDownload.ext || ext;
          }
        } else if (isDirectHttp(reqDownload)) {
          directUrl = reqDownload.url;
          fileSize = reqDownload.filesize || reqDownload.filesize_approx || fileSize;
          ext = reqDownload.ext || ext;
        }
      }

      // Fallback: If directUrl is missing or not direct http, fallback to availableFormats[0]?.url
      if (!directUrl && availableFormats.length > 0) {
        directUrl = availableFormats[0].url;
        fileSize = availableFormats[0].fileSize || fileSize;
        ext = availableFormats[0].ext || ext;
      }

      if (!directUrl) {
        throw new Error('Could not find a direct stream URL in the yt-dlp response.');
      }

      return {
        title: data.title || 'Unknown Video',
        thumbnail: data.thumbnail || '',
        url: directUrl,
        fileSize,
        duration: data.duration || 0,
        ext,
        formats: availableFormats
      };

    } catch (error) {
      console.error("[yt-dlp] Extraction failed:", error);
      throw error;
    }
  },
  downloadMediaStream
};
