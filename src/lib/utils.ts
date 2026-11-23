import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export type SpeedUnit = 'MBps' | 'Mbps';

export function formatSpeed(bytesPerSec: number | string, unit: SpeedUnit = 'MBps'): string {
  const speed = typeof bytesPerSec === 'string' ? parseFloat(bytesPerSec) : bytesPerSec;
  if (!speed || isNaN(speed) || speed <= 0) {
    return unit === 'Mbps' ? '0 bps' : '0 B/s';
  }

  if (unit === 'Mbps') {
    const bits = speed * 8;
    const sizes = ['bps', 'Kbps', 'Mbps', 'Gbps'];
    if (bits < 1000) {
      return `${parseFloat(bits.toFixed(2))} bps`;
    }
    const i = Math.min(Math.floor(Math.log10(bits) / 3), sizes.length - 1);
    const val = parseFloat((bits / Math.pow(1000, i)).toFixed(2));
    return `${val} ${sizes[i]}`;
  }

  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  if (speed < k) {
    return `${parseFloat(speed.toFixed(2))} B/s`;
  }
  const i = Math.min(Math.floor(Math.log(speed) / Math.log(k)), sizes.length - 1);
  const val = parseFloat((speed / Math.pow(k, i)).toFixed(2));
  return `${val} ${sizes[i]}`;
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

export interface SystemDrive {
  id: string;
  label: string;
  mount_point: string;
  free_space: number;
  total_space: number;
  is_removable: boolean;
}

export function formatDriveSpace(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B free";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1000) {
    const tb = gb / 1024;
    return `${tb >= 10 ? Math.round(tb) : tb.toFixed(1)} TB free`;
  }
  if (gb >= 1) {
    return `${Math.round(gb)} GB free`;
  }
  const mb = bytes / (1024 * 1024);
  return `${Math.round(mb)} MB free`;
}

/**
 * Safely decodes a URL percent-encoded filename (e.g. "Last%20Man%20in%20Tower%20%282026%29.mkv" -> "Last Man in Tower (2026).mkv")
 * and extracts the base name without leading directory separators or directory traversal sequences.
 */
export function decodeFilename(filename: string | undefined | null): string {
  if (!filename) return "Unknown";
  let name = filename;
  for (let i = 0; i < 2; i++) {
    try {
      const decoded = decodeURIComponent(name);
      if (decoded === name) break;
      name = decoded;
    } catch {
      break;
    }
  }
  name = name.replace(/[/\\]+$/, '');
  const segments = name.split(/[/\\]/).filter(Boolean);
  name = segments.pop() || "";
  name = name.replace(/^(\.\.[\/\\])+/, '').replace(/^\.+/, '');
  return name.trim() || "Unknown";
}

/**
 * Parses Content-Disposition header supporting both standard filename="..."
 * and RFC 5987 / RFC 6266 filename*=UTF-8''... percent-encoded formats.
 */
export function parseContentDispositionFilename(header: string | null | undefined): string | null {
  if (!header) return null;

  // RFC 5987 / RFC 6266: filename*=UTF-8''encoded_name
  const rfc5987Match = header.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;]+)/i);
  if (rfc5987Match && rfc5987Match[1]) {
    const raw = rfc5987Match[1].trim().replace(/^["']|["']$/g, '');
    return decodeFilename(raw);
  }

  // Standard: filename="name" or filename=name
  const standardMatch = header.match(/filename\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
  if (standardMatch) {
    const raw = standardMatch[1] || standardMatch[2];
    if (raw) return decodeFilename(raw.trim());
  }

  return null;
}

/**
 * Resolves a safe download folder for a given drive mount point.
 * Avoids setting system roots ('/', '/home', 'C:\') directly which fail with EACCES permissions
 * or compromise deletion safety boundaries.
 */
export function resolveSafeDriveDownloadPath(mountPoint: string, defaultDir?: string): string {
  if (!mountPoint) return defaultDir || ''; // agyis: no-mutant
  const norm = mountPoint.replace(/[\\/]+$/, '');
  const lower = norm.toLowerCase();
  if (!norm || norm === '/' || norm === '/home' || lower === 'c:' || lower === 'c:\\') { // agyis: no-mutant
    return defaultDir || ''; // agyis: no-mutant
  }
  return `${norm}/Downloads`;
}


