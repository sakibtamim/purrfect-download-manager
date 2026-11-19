export interface DynamicSplitOptions {
  fileSize?: number;
  url: string;
  sourceUrl?: string;
  userSetting?: number;
  dynamicEnabled?: boolean;
}

export interface SplitResult {
  split: number;
  maxConnectionPerServer: number;
  minSplitSize: string;
}

export function calculateOptimalSplit({
  fileSize,
  url,
  sourceUrl,
  userSetting = 16,
  dynamicEnabled = true
}: DynamicSplitOptions): SplitResult {
  // If dynamic is disabled by user, honor their manual setting
  if (!dynamicEnabled) {
    const fixed = Math.max(1, Math.min(32, userSetting));
    return {
      split: fixed,
      maxConnectionPerServer: Math.min(fixed, 16),
      minSplitSize: '1M'
    };
  }

  const targetUrl = `${sourceUrl || ''} ${url}`.toLowerCase();
  const isMediaStream = (
    targetUrl.includes('googlevideo.com') ||
    targetUrl.includes('youtube.com') ||
    targetUrl.includes('youtu.be') ||
    targetUrl.includes('.m3u8') ||
    targetUrl.includes('.mpd')
  );

  // 1. YouTube & CDN Streaming: Max split to saturate BDIX cache and gigabit links
  if (isMediaStream) {
    return {
      split: 32,
      maxConnectionPerServer: 16,
      minSplitSize: '1M'
    };
  }

  // 2. File size tiering
  if (!fileSize || fileSize <= 0) {
    return { split: 8, maxConnectionPerServer: 8, minSplitSize: '1M' };
  }

  if (fileSize < 5 * 1024 * 1024) {
    return { split: 2, maxConnectionPerServer: 2, minSplitSize: '1M' };
  } else if (fileSize < 50 * 1024 * 1024) {
    return { split: 8, maxConnectionPerServer: 8, minSplitSize: '1M' };
  } else if (fileSize < 500 * 1024 * 1024) {
    return { split: 16, maxConnectionPerServer: 16, minSplitSize: '1M' };
  } else {
    return { split: 32, maxConnectionPerServer: 16, minSplitSize: '1M' };
  }
}
