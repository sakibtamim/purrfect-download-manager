import { Command } from '@tauri-apps/plugin-shell';

export interface YtDlpFormat {
  format_id: string;
  ext: string;
  resolution: string;
  fileSize: number;
  url: string;
  audioUrl?: string;
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

interface RawFormat {
  url?: string;
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

export const ytdlpClient = {
  /**
   * Extracts direct video stream URLs and metadata from a given URL using yt-dlp.
   */
  async extractVideoInfo(videoUrl: string): Promise<YtDlpVideoInfo> {
    console.log(`[yt-dlp] Extracting info for ${videoUrl}...`);
    
    // Build arguments. We use -J to dump JSON and not download the file itself here.
    const args = [
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '-J',
      '--no-warnings',
      '--extractor-args',
      'youtube:player_client=default', // Let yt-dlp pick the best unblocked client (Android/iOS)
      videoUrl
    ];

    // If cookies are provided, we should ideally write them to a temp file and pass --cookies
    // But yt-dlp also accepts --cookies-from-browser (e.g. chrome) which is great for local apps.
    // For now, if we have raw cookie string, yt-dlp doesn't accept a raw string arg easily.
    // So we'll rely on the player_client arg which solves 90% of the issues.

    try {
      const command = Command.sidecar('bin/yt-dlp', args);
      const output = await command.execute();

      if (output.code !== 0) {
        throw new Error(`yt-dlp exited with code ${output.code}: ${output.stderr}`);
      }

      const data = JSON.parse(output.stdout);
      
      // Determine the best direct URL. 
      // yt-dlp JSON has 'url' or 'requested_downloads' array depending on format requested.
      let directUrl = data.url;
      let fileSize = data.filesize || data.filesize_approx || 0;
      let ext = data.ext || 'mp4';

      if (!directUrl && data.requested_downloads && data.requested_downloads.length > 0) {
        const reqDownload = data.requested_downloads[0];
        if (reqDownload.requested_formats && reqDownload.requested_formats.length > 0) {
          directUrl = reqDownload.requested_formats[0].url;
          fileSize = reqDownload.requested_formats.reduce((acc: number, f: RawFormat) => acc + (f.filesize || f.filesize_approx || 0), 0);
          ext = reqDownload.ext || ext;
        } else {
          directUrl = reqDownload.url;
          fileSize = reqDownload.filesize || reqDownload.filesize_approx || fileSize;
          ext = reqDownload.ext || ext;
        }
      }

      if (!directUrl) {
        throw new Error('Could not find a direct stream URL in the yt-dlp response.');
      }

      let availableFormats: YtDlpFormat[] = [];
      if (data.formats && Array.isArray(data.formats)) {
        // Find best audio
        const bestAudio = data.formats
          .filter((f: RawFormat) => f.acodec !== 'none' && f.vcodec === 'none')
          .sort((a: RawFormat, b: RawFormat) => (b.abr || 0) - (a.abr || 0))[0];

        availableFormats = data.formats
          .filter((f: RawFormat) => f.vcodec !== 'none' && f.url)
          .map((f: RawFormat) => {
            const hasAudio = f.acodec !== 'none';
            // We force mp4 container for muxed results
            const finalExt = !hasAudio ? 'mp4' : (f.ext || 'mp4');
            
            return {
              format_id: f.format_id || 'unknown',
              ext: finalExt,
              resolution: f.resolution || f.format_note || (f.width ? `${f.width}x${f.height}` : 'Unknown'),
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
  }
};
