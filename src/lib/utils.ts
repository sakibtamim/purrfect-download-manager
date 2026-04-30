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
