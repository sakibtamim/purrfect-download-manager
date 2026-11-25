"use client";

import { useState } from "react";
import { useAppStore } from "@/store";
import { Aria2Download } from "@/lib/aria2Client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Play, Pause, X, FolderOpen, File, RefreshCw, Trash2, Film, Music, Archive, Code, FileText, Image as ImageIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { open } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { formatSpeed, decodeFilename, cn } from "@/lib/utils";

interface DownloadTableProps {
  downloads: Aria2Download[];
}

export function DownloadTable({ downloads }: DownloadTableProps) {
  const isPlayfulMode = useAppStore((state) => state.isPlayfulMode);
  const speedUnit = useAppStore((state) => state.speedUnit);
  const selectedDownloadId = useAppStore((state) => state.selectedDownloadId);
  const setSelectedDownload = useAppStore((state) => state.setSelectedDownload);
  const pauseDownload = useAppStore((state) => state.pauseDownload);
  const resumeDownload = useAppStore((state) => state.resumeDownload);
  const cancelDownload = useAppStore((state) => state.cancelDownload);
  const addDownload = useAppStore((state) => state.addDownload);
  const deleteDownload = useAppStore((state) => state.deleteDownload);

  const [deleteTargetGid, setDeleteTargetGid] = useState<string | null>(null);
  const [deleteLocalFile, setDeleteLocalFile] = useState(false);

  const handleDelete = async () => {
    if (deleteTargetGid) {
      if (selectedDownloadId === deleteTargetGid) {
        setSelectedDownload(null);
      }
      const targetGid = deleteTargetGid;
      const shouldDeleteLocal = deleteLocalFile;
      setDeleteTargetGid(null);
      setDeleteLocalFile(false);
      await deleteDownload(targetGid, shouldDeleteLocal);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "mp4": case "mkv": case "avi": case "webm": case "mov":
        return <Film className="h-3.5 w-3.5 text-blue-500 shrink-0" />;
      case "mp3": case "flac": case "wav": case "ogg": case "m4a":
        return <Music className="h-3.5 w-3.5 text-purple-500 shrink-0" />;
      case "zip": case "rar": case "7z": case "tar": case "gz":
        return <Archive className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
      case "jpg": case "jpeg": case "png": case "gif": case "webp": case "svg":
        return <ImageIcon className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
      case "js": case "ts": case "json": case "html": case "css": case "rs": case "py":
        return <Code className="h-3.5 w-3.5 text-yellow-500 shrink-0" />;
      case "pdf": case "doc": case "docx": case "txt": case "md":
        return <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0" />;
      default:
        return <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    }
  };

  const getStatusText = (status: string) => {
    if (isPlayfulMode) {
      switch (status) {
        case "muxing": return "Merging 🎬";
        case "active": return "Hunting 🐾";
        case "paused": return "Sleeping 💤";
        case "complete": return "Caught! 😻";
        case "error": return "Slipped 😿";
        case "removed": return "Lost 🐈";
        case "waiting": return "Waiting 🐈‍⬛";
        default: return "Observing";
      }
    } else {
      switch (status) {
        case "muxing": return "Merging";
        case "active": return "Downloading";
        case "paused": return "Paused";
        case "complete": return "Complete";
        case "error": return "Failed";
        case "removed": return "Cancelled";
        case "waiting": return "Waiting";
        default: return "Unknown";
      }
    }
  };

  const getStatusBadgeVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case "complete": return "default";
      case "error": case "removed": return "destructive";
      case "active": case "muxing": return "secondary";
      default: return "outline";
    }
  };

  return (
    <div className="w-full rounded-lg border border-border bg-card/60 overflow-hidden shadow-xs">
      <table className="table-fixed w-full text-left text-xs">
        <thead className="bg-muted/40 text-muted-foreground border-b border-border font-medium select-none">
          <tr>
            <th className="py-2 px-3 w-auto min-w-0">File Name</th>
            <th className="py-2 px-2.5 w-[80px]">Size</th>
            <th className="py-2 px-2.5 w-[100px] sm:w-[110px]">Progress</th>
            <th className="py-2 px-2.5 w-[96px] sm:w-[104px]">Speed</th>
            <th className="py-2 px-2.5 w-[64px] sm:w-[72px] hidden sm:table-cell">ETA</th>
            <th className="py-2 px-2.5 w-[100px] sm:w-[112px]">Status</th>
            <th className="py-2 pl-2 pr-3 w-[88px] sm:w-[96px] text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {downloads.map((download) => {
            const filePath = download.files[0]?.path || "Unknown File";
            const rawName = filePath.includes("/")
              ? filePath.split("/").pop()
              : filePath.split("\\").pop() || "Unknown File";
            const fileName = decodeFilename(rawName);

            const rawTotal = parseInt(download.totalLength, 10);
            const rawCompleted = parseInt(download.completedLength, 10);
            const fileTotal = download.files[0] ? parseInt(download.files[0].length, 10) : 0;
            const fileCompleted = download.files[0] ? parseInt(download.files[0].completedLength, 10) : 0;
            const totalLength = rawTotal > 0 ? rawTotal : fileTotal;
            const completedLength = rawCompleted > 0 ? rawCompleted : fileCompleted;
            const isMuxing = download.status === "muxing";
            const progress = isMuxing
              ? (download.muxProgress ?? 0)
              : (totalLength > 0 ? (completedLength / totalLength) * 100 : 0);
            const speed = parseInt(download.downloadSpeed, 10);
            const isSelected = selectedDownloadId === download.gid;

            let etaStr = "--";
            if (download.status === "active" && speed > 0 && totalLength > completedLength) {
              const remainingBytes = totalLength - completedLength;
              const seconds = Math.floor(remainingBytes / speed);
              if (isFinite(seconds)) {
                const h = Math.floor(seconds / 3600);
                const m = Math.floor((seconds % 3600) / 60);
                const s = seconds % 60;
                if (h > 0) etaStr = `${h}h ${m}m`;
                else if (m > 0) etaStr = `${m}m ${s}s`;
                else etaStr = `${s}s`;
              }
            }

            return (
              <tr
                key={download.gid}
                tabIndex={0}
                role="row"
                aria-selected={isSelected}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedDownload(isSelected ? null : download.gid);
                  }
                }}
                onClick={() => setSelectedDownload(isSelected ? null : download.gid)}
                className={cn(
                  "h-10 transition-colors cursor-pointer group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary",
                  isSelected
                    ? "bg-primary/10 hover:bg-primary/15"
                    : "hover:bg-muted/40"
                )}
              >
                {/* File Name */}
                <td className="py-1.5 px-3 w-auto min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    {getFileIcon(fileName || "")}
                    <span className="font-medium text-foreground min-w-0 flex-1 truncate" title={fileName}>
                      {fileName}
                    </span>
                  </div>
                </td>

                {/* Size */}
                <td className="py-1.5 px-2.5 w-[80px] text-muted-foreground whitespace-nowrap">
                  {formatBytes(completedLength)}
                  {totalLength > 0 && (
                    <span className="text-muted-foreground/60 text-[11px] block">
                      of {formatBytes(totalLength)}
                    </span>
                  )}
                </td>

                {/* Progress */}
                <td className="py-1.5 px-2.5 w-[100px] sm:w-[110px]">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
                      <span>{progress.toFixed(0)}%</span>
                      {isMuxing && <span className="text-primary font-sans text-[10px]">Merging {download.muxProgress ?? 0}%</span>}
                    </div>
                    <Progress value={progress} className="h-1 bg-muted" />
                  </div>
                </td>

                {/* Speed */}
                <td className="py-1.5 px-2.5 w-[96px] sm:w-[104px] whitespace-nowrap text-muted-foreground font-mono">
                  {download.status === "active" && speed > 0 ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      {formatSpeed(speed, speedUnit)}
                    </span>
                  ) : (
                    "--"
                  )}
                </td>

                {/* ETA */}
                <td className="py-1.5 px-2.5 w-[64px] sm:w-[72px] whitespace-nowrap text-muted-foreground font-mono text-[11px] hidden sm:table-cell">
                  {etaStr}
                </td>

                {/* Status */}
                <td className="py-1.5 px-2.5 w-[100px] sm:w-[112px] whitespace-nowrap">
                  <Badge
                    variant={getStatusBadgeVariant(download.status)}
                    className={cn(
                      "text-[10px] px-1.5 py-0 font-normal",
                      download.status === "active" && "bg-primary/15 text-primary border-primary/20",
                      download.status === "paused" && "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
                      download.status === "complete" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                    )}
                  >
                    {getStatusText(download.status)}
                  </Badge>
                </td>

                {/* Actions */}
                <td className="py-1.5 pl-2 pr-3 w-[88px] sm:w-[96px] whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                      {download.status === "active" && (
                        <Button
                          disabled={isMuxing}
                          variant="ghost"
                          size="icon-xs"
                          className="h-6 w-6 text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10"
                          title="Pause"
                          aria-label="Pause download"
                          onClick={() => { if (!isMuxing) pauseDownload(download.gid); }}
                        >
                          <Pause className="h-3 w-3" />
                        </Button>
                      )}

                      {download.status === "paused" && (
                        <Button
                          disabled={isMuxing}
                          variant="ghost"
                          size="icon-xs"
                          className="h-6 w-6 text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10"
                          title="Resume"
                          aria-label="Resume download"
                          onClick={() => { if (!isMuxing) resumeDownload(download.gid); }}
                        >
                          <Play className="h-3 w-3" />
                        </Button>
                      )}

                      {(download.status === "active" || download.status === "paused" || download.status === "waiting") && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="h-6 w-6 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                          title="Cancel"
                          aria-label="Cancel download"
                          onClick={() => cancelDownload(download.gid)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}

                      {download.status === "complete" && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="h-6 w-6 text-muted-foreground hover:text-primary hover:bg-primary/10"
                          title="Open Folder"
                          aria-label="Open download folder"
                          onClick={async () => {
                            const p = download.files[0]?.path;
                            if (p) {
                              try {
                                await invoke("reveal_in_folder", { path: p });
                              } catch (err) {
                                console.warn("Reveal in folder failed:", err);
                                if (download.dir) open(download.dir).catch(console.error);
                              }
                            } else if (download.dir) {
                              open(download.dir).catch(console.error);
                            }
                          }}
                        >
                          <FolderOpen className="h-3 w-3" />
                        </Button>
                      )}

                      {(download.status === "error" || download.status === "removed") && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="h-6 w-6 text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10"
                          title="Retry"
                          aria-label="Retry download"
                          onClick={() => {
                            const uri = download.files[0]?.uris[0]?.uri;
                            if (uri) {
                              addDownload(uri);
                              cancelDownload(download.gid);
                            }
                          }}
                        >
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="h-6 w-6 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                        title="Delete"
                        aria-label="Delete download"
                        onClick={() => {
                          setDeleteLocalFile(false);
                          setDeleteTargetGid(download.gid);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

      <Dialog
        open={!!deleteTargetGid}
        onOpenChange={(openState) => {
          if (!openState) {
            setDeleteTargetGid(null);
            setDeleteLocalFile(false);
          }
        }}
      >
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Remove Download</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove this download from the list?
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center space-x-2 py-4">
            <input
              type="checkbox"
              id="delete-local-table"
              checked={deleteLocalFile}
              onChange={(e) => setDeleteLocalFile(e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            <label htmlFor="delete-local-table" className="text-sm font-medium text-foreground">
              Also remove the downloaded file from local disk
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTargetGid(null);
                setDeleteLocalFile(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
