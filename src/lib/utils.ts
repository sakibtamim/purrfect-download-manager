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

export function formatChecksum(hash: string): string | undefined {
  if (!hash) return undefined;
  if (hash.includes('=')) return hash; // Already formatted e.g. sha-256=xxx
  
  const cleanHash = hash.replace(/[\s:-]/g, '').toLowerCase();
  
  switch (cleanHash.length) {
    case 32: return `md5=${cleanHash}`;
    case 40: return `sha-1=${cleanHash}`;
    case 56: return `sha-224=${cleanHash}`;
    case 64: return `sha-256=${cleanHash}`;
    case 96: return `sha-384=${cleanHash}`;
    case 128: return `sha-512=${cleanHash}`;
    case 8: return `crc32=${cleanHash}`; // Fallback for adler32/crc32, though less common
    default:
      // If we don't know, default to sha-256 just in case, though aria2 might reject
      return `sha-256=${cleanHash}`;
  }
}
