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

export function calculateOptimalSplit(options: DynamicSplitOptions): SplitResult {
  const { userSetting = 16, dynamicEnabled = true } = options;
  // If dynamic is disabled by user, honor their manual setting
  if (!dynamicEnabled) {
    const fixed = Math.max(1, Math.min(32, userSetting));
    return {
      split: fixed,
      maxConnectionPerServer: Math.min(fixed, 16),
      minSplitSize: '1M'
    };
  }

  // Standardize to max 32 connections for full line speed and BDIX cache saturation
  return {
    split: 32,
    maxConnectionPerServer: 16,
    minSplitSize: '1M'
  };
}
