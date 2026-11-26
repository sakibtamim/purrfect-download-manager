"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Aria2Download } from "@/lib/aria2Client";
import { useAppStore } from "@/store";
import {
  Play,
  Pause,
  FolderOpen,
  FileText,
  RefreshCw,
  Copy,
  Link,
  Info,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface Position {
  x: number;
  y: number;
}

export interface Dimensions {
  width: number;
  height: number;
}

export interface DownloadContextMenuProps {
  download: Aria2Download | null;
  position: Position | null;
  onClose: () => void;
  onPause?: (gid: string) => void;
  onResume?: (gid: string) => void;
  onOpenFile?: (filePath: string) => void;
  onOpenFolder?: (filePath: string) => void;
  onRedownload?: (gid: string) => void;
  onViewDetails?: (gid: string) => void;
  onCopyLink?: (url: string) => void;
  onCopyPath?: (path: string) => void;
  onDelete?: (gid: string) => void;
  isPlayfulMode?: boolean;
}

export function clampPosition(
  pos: Position,
  menuDimensions: Dimensions = { width: 220, height: 320 },
  viewport: Dimensions = {
    width: typeof window !== "undefined" ? window.innerWidth : 1024,
    height: typeof window !== "undefined" ? window.innerHeight : 768,
  },
  padding: number = 8
): Position {
  let x = pos.x;
  let y = pos.y;

  if (x + menuDimensions.width > viewport.width - padding) {
    x = Math.max(padding, viewport.width - menuDimensions.width - padding);
  }
  if (x < padding) {
    x = padding;
  }

  if (y + menuDimensions.height > viewport.height - padding) {
    y = Math.max(padding, viewport.height - menuDimensions.height - padding);
  }
  if (y < padding) {
    y = padding;
  }

  return { x, y };
}

export function getDownloadContextMenuActions(
  download: Aria2Download,
  options?: { isPlayfulMode?: boolean }
) {
  const isPlayful = options?.isPlayfulMode ?? false;
  const isMuxing = (download.status as string) === "muxing";
  const filePath = download.files?.[0]?.path || undefined;
  const rawUrl = download.files?.[0]?.uris?.[0]?.uri;
  const downloadUrl = rawUrl && rawUrl !== "Unknown URL" ? rawUrl : undefined;
  const hasMissingFile = Boolean(download.fileMissing);

  const canPause = download.status === "active" && !isMuxing;
  const canResume =
    (download.status === "paused" || download.status === "waiting") && !isMuxing;
  const canOpenFile = download.status === "complete" && !hasMissingFile && Boolean(filePath);
  const canOpenFolder = Boolean(filePath || download.dir);
  const canRedownload = true;

  const pauseLabel = isPlayful ? "Put to Sleep 💤" : "Pause";
  const resumeLabel = isPlayful ? "Wake Up & Pounce 🐾" : "Resume";
  const openFileLabel = isPlayful ? "Open File 😻" : "Open File";

  return {
    canPause,
    canResume,
    canOpenFile,
    canOpenFolder,
    canRedownload,
    pauseLabel,
    resumeLabel,
    openFileLabel,
    hasMissingFile,
    filePath,
    downloadUrl,
  };
}

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function DownloadContextMenu({
  download,
  position,
  onClose,
  onPause,
  onResume,
  onOpenFile,
  onOpenFolder,
  onRedownload,
  onViewDetails,
  onCopyLink,
  onCopyPath,
  onDelete,
  isPlayfulMode: propPlayfulMode,
}: DownloadContextMenuProps) {
  const storePlayfulMode = useAppStore((state) => state.isPlayfulMode);
  const downloadMetadata = useAppStore((state) => state.downloadMetadata);
  const isPlayful = propPlayfulMode ?? storePlayfulMode;

  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<Position>(() => {
    if (!position) return { x: 0, y: 0 };
    return clampPosition(position);
  });

  useIsomorphicLayoutEffect(() => {
    if (!position) return;
    const menuEl = menuRef.current;
    const width = menuEl ? menuEl.offsetWidth : 220;
    const height = menuEl ? menuEl.offsetHeight : 320;
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };
    setCoords(clampPosition(position, { width, height }, viewport));
  }, [position]);

  useEffect(() => {
    if (!position || !download) return;

    const handlePointerDown = (e: MouseEvent | PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleContextMenuCapture = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const handleBlur = () => {
      onClose();
    };

    const handleResize = () => {
      onClose();
    };

    const handleScroll = () => {
      onClose();
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("contextmenu", handleContextMenuCapture, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("contextmenu", handleContextMenuCapture, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [position, download, onClose]);

  if (!download || !position) return null;

  const metaUrl = downloadMetadata[download.gid]?.sourceUrl;
  const actions = getDownloadContextMenuActions(download, { isPlayfulMode: isPlayful });
  const finalDownloadUrl = metaUrl || actions.downloadUrl;
  const filePath = actions.filePath;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-orientation="vertical"
      tabIndex={-1}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{ left: `${coords.x}px`, top: `${coords.y}px` }}
      className="fixed z-50 min-w-[210px] max-w-[280px] rounded-xl border border-border/80 bg-popover/95 dark:bg-slate-900/95 backdrop-blur-md p-1.5 shadow-2xl text-popover-foreground text-xs animate-in fade-in-0 zoom-in-95 select-none"
    >
      {/* 1. Resume */}
      {actions.canResume && (
        <button
          type="button"
          role="menuitem"
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-medium text-foreground hover:bg-muted/80 focus:bg-muted/80 focus:outline-none transition-colors cursor-pointer"
          onClick={() => {
            onResume?.(download.gid);
            onClose();
          }}
        >
          <Play className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          <span className="truncate">{actions.resumeLabel}</span>
        </button>
      )}

      {/* 2. Pause */}
      {actions.canPause && (
        <button
          type="button"
          role="menuitem"
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-medium text-foreground hover:bg-muted/80 focus:bg-muted/80 focus:outline-none transition-colors cursor-pointer"
          onClick={() => {
            onPause?.(download.gid);
            onClose();
          }}
        >
          <Pause className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <span className="truncate">{actions.pauseLabel}</span>
        </button>
      )}

      {/* 3. Open File */}
      {actions.canOpenFile && (
        <button
          type="button"
          role="menuitem"
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-medium text-foreground hover:bg-muted/80 focus:bg-muted/80 focus:outline-none transition-colors cursor-pointer"
          onClick={() => {
            if (filePath) onOpenFile?.(filePath);
            onClose();
          }}
        >
          <FileText className="h-3.5 w-3.5 text-blue-500 shrink-0" />
          <span className="truncate">{actions.openFileLabel}</span>
        </button>
      )}

      {/* 4. Open Destination Folder */}
      <button
        type="button"
        role="menuitem"
        disabled={!actions.canOpenFolder}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-medium text-foreground hover:bg-muted/80 focus:bg-muted/80 focus:outline-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        onClick={() => {
          const target = filePath || download.dir;
          if (target) onOpenFolder?.(target);
          onClose();
        }}
      >
        <FolderOpen className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        <span className="truncate">Open Destination Folder</span>
      </button>

      {/* 5. Redownload */}
      <button
        type="button"
        role="menuitem"
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-medium text-foreground hover:bg-muted/80 focus:bg-muted/80 focus:outline-none transition-colors cursor-pointer"
        onClick={() => {
          onRedownload?.(download.gid);
          onClose();
        }}
      >
        <RefreshCw
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            actions.hasMissingFile ? "text-amber-500" : "text-muted-foreground"
          )}
        />
        <span className="flex-1 truncate">Redownload</span>
        {actions.hasMissingFile && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium shrink-0">
            Missing
          </span>
        )}
      </button>

      {/* Separator */}
      <div className="my-1 h-px bg-border/60" role="separator" />

      {/* 6. Copy Download Link */}
      <button
        type="button"
        role="menuitem"
        disabled={!finalDownloadUrl}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-medium text-foreground hover:bg-muted/80 focus:bg-muted/80 focus:outline-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        onClick={() => {
          if (finalDownloadUrl) {
            onCopyLink?.(finalDownloadUrl);
            if (!onCopyLink && typeof navigator !== "undefined" && navigator.clipboard) {
              navigator.clipboard.writeText(finalDownloadUrl);
            }
          }
          onClose();
        }}
      >
        <Link className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="truncate">Copy Download Link</span>
      </button>

      {/* 7. Copy File Path */}
      <button
        type="button"
        role="menuitem"
        disabled={!filePath}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-medium text-foreground hover:bg-muted/80 focus:bg-muted/80 focus:outline-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        onClick={() => {
          if (filePath) {
            onCopyPath?.(filePath);
            if (!onCopyPath && typeof navigator !== "undefined" && navigator.clipboard) {
              navigator.clipboard.writeText(filePath);
            }
          }
          onClose();
        }}
      >
        <Copy className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="truncate">Copy File Path</span>
      </button>

      {/* 8. View Details */}
      <button
        type="button"
        role="menuitem"
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-medium text-foreground hover:bg-muted/80 focus:bg-muted/80 focus:outline-none transition-colors cursor-pointer"
        onClick={() => {
          onViewDetails?.(download.gid);
          onClose();
        }}
      >
        <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="truncate">View Details</span>
      </button>

      {/* Separator */}
      <div className="my-1 h-px bg-border/60" role="separator" />

      {/* 9. Remove / Delete... */}
      <button
        type="button"
        role="menuitem"
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-medium text-destructive hover:bg-destructive/10 focus:bg-destructive/10 focus:outline-none transition-colors cursor-pointer"
        onClick={() => {
          onDelete?.(download.gid);
          onClose();
        }}
      >
        <Trash2 className="h-3.5 w-3.5 text-destructive shrink-0" />
        <span className="truncate">Remove / Delete...</span>
      </button>
    </div>
  );
}
