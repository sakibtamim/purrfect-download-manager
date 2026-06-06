import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export type FileCategory = "all" | "software" | "media" | "documents" | "archives" | "other";

export function getFileCategory(fileName: string): FileCategory {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  
  if (['exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'apk', 'app'].includes(ext)) return 'software';
  if (['mp4', 'mkv', 'avi', 'mov', 'mp3', 'wav', 'flac', 'jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'media';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv'].includes(ext)) return 'documents';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'iso'].includes(ext)) return 'archives';
  
  return 'other';
}

export type ChecksumAlgorithm = "md5" | "sha1" | "sha224" | "sha256" | "sha384" | "sha512";

export interface DetectedChecksum {
  algorithm: ChecksumAlgorithm;
  digest: string;
  source: "labeled" | "raw-length" | "manual" | "checksum-file";
}

const EXPECTED_LENGTHS: Record<ChecksumAlgorithm, number> = {
  md5: 32, sha1: 40, sha224: 56, sha256: 64, sha384: 96, sha512: 128
};

export function validateChecksum(c: DetectedChecksum): boolean {
  if (!c || !c.algorithm || !c.digest) return false;
  const expectedLen = EXPECTED_LENGTHS[c.algorithm];
  if (!expectedLen) return false;
  if (c.digest.length !== expectedLen) return false;
  if (!/^[a-fA-F0-9]+$/.test(c.digest)) return false;
  return true;
}

export function formatChecksum(c: DetectedChecksum | string | undefined): string | undefined {
  if (!c) return undefined;
  
  if (typeof c === 'string') {
    // Fallback for legacy raw strings
    if (c.includes('=')) return c;
    const cleanHash = c.replace(/[\s:-]/g, '').toLowerCase();
    switch (cleanHash.length) {
      case 32: return `md5=${cleanHash}`;
      case 40: return `sha-1=${cleanHash}`;
      case 56: return `sha-224=${cleanHash}`;
      case 64: return `sha-256=${cleanHash}`;
      case 96: return `sha-384=${cleanHash}`;
      case 128: return `sha-512=${cleanHash}`;
      default: return `sha-256=${cleanHash}`;
    }
  }

  // New structured format
  if (!validateChecksum(c)) return undefined;
  
  // aria2c expects "sha-256" not "sha256"
  const algoFormat = c.algorithm.replace("sha", "sha-");
  return `${algoFormat}=${c.digest.toLowerCase()}`;
}
