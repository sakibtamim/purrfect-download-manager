import { Command } from '@tauri-apps/plugin-shell';

export interface YtDlpVideoInfo {
  title: string;
  thumbnail: string;
  url: string;      // Direct stream URL
  fileSize: number;
  duration: number;
}

export const ytdlpClient = {
  /**
   * Extracts direct video stream URLs and metadata from a given URL using yt-dlp.
   */
  async extractVideoInfo(videoUrl: string, cookies?: string): Promise<YtDlpVideoInfo> {
    console.log(`[yt-dlp] Extracting info for ${videoUrl}...`);
    
    // Build arguments. We use -J to dump JSON and not download the file itself here.
    const args = [
      '-J',
      '--no-warnings',
      '--extractor-args',
      'youtube:player_client=web', // Bypass YouTube bot detection
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

      if (!directUrl && data.requested_downloads && data.requested_downloads.length > 0) {
        directUrl = data.requested_downloads[0].url;
        fileSize = data.requested_downloads[0].filesize || fileSize;
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
      };

    } catch (error) {
      console.error("[yt-dlp] Extraction failed:", error);
      throw error;
    }
  }
};
