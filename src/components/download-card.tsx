"use client";

import { useState } from "react";
import { useDownloadStore } from "@/store/downloadStore";
import { Aria2Download } from "@/lib/aria2Client";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play, Pause, X, FolderOpen, File, RefreshCw, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { open, Command } from "@tauri-apps/plugin-shell";

export function DownloadCard({ download }: { download: Aria2Download }) {
  const { isPlayfulMode, pauseDownload, resumeDownload, cancelDownload, addDownload, selectedDownloadId, setSelectedDownload, deleteDownload } = useDownloadStore();

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteLocalFile, setDeleteLocalFile] = useState(false);

  const handleDelete = async () => {
    await deleteDownload(download.gid, deleteLocalFile);
    setIsDeleteDialogOpen(false);
  };

  const rawTotal = parseInt(download.totalLength, 10);
  const rawCompleted = parseInt(download.completedLength, 10);
  // Fallback to per-file lengths for session-restored paused downloads where top-level values are 0
  const fileTotal = download.files[0] ? parseInt(download.files[0].length, 10) : 0;
  const fileCompleted = download.files[0] ? parseInt(download.files[0].completedLength, 10) : 0;
  const totalLength = rawTotal > 0 ? rawTotal : fileTotal;
  const completedLength = rawCompleted > 0 ? rawCompleted : fileCompleted;
  const progress = totalLength > 0 ? (completedLength / totalLength) * 100 : 0;
  
  const speed = parseInt(download.downloadSpeed, 10);
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStatusText = () => {
    if (isPlayfulMode) {
      switch (download.status) {
        case "active": return "Your cat is on the hunt 🐾";
        case "paused": return "Cat is sleeping 💤";
        case "complete": return "Caught it! 😻";
        case "error": return "Oops, slipped away 😿";
        case "removed": return "Lost interest 🐈";
        case "waiting": return "Waiting to pounce 🐈‍⬛";
        default: return "Observing...";
      }
    } else {
      switch (download.status) {
        case "active": return "Downloading";
        case "paused": return "Paused";
        case "complete": return "Completed";
        case "error": return "Failed";
        case "removed": return "Cancelled";
        case "waiting": return "Waiting";
        default: return "Unknown";
      }
    }
  };

  const getETA = () => {
    if (download.status !== "active" || speed === 0) return null;
    const remainingBytes = totalLength - completedLength;
    if (remainingBytes <= 0) return null;
    
    const seconds = Math.floor(remainingBytes / speed);
    if (!isFinite(seconds)) return null;
    
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    
    if (h > 0) return `${h}h ${m}m left`;
    if (m > 0) return `${m}m ${s}s left`;
    return `${s}s left`;
  };

  const getStatusColor = () => {
    switch (download.status) {
      case "active": return "bg-primary/10 text-primary border-primary/20";
      case "paused": return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
      case "complete": return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
      case "error": 
      case "removed": return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
      default: return "bg-muted text-muted-foreground border-border";
    }
  };

  const getLeftBorderColor = () => {
    switch (download.status) {
      case "active": return "border-l-primary";
      case "paused": return "border-l-amber-500";
      case "complete": return "border-l-emerald-500";
      case "error":
      case "removed": return "border-l-red-500";
      default: return "border-l-muted-foreground";
    }
  };

  // Derive filename from path
  const filePath = download.files[0]?.path || "Unknown File";
  const fileName = filePath.includes('/') ? filePath.split('/').pop() : filePath.split('\\').pop() || "Unknown File";

  const isSelected = selectedDownloadId === download.gid;

  return (
    <Card 
      onClick={() => setSelectedDownload(isSelected ? null : download.gid)}
      className={`bg-card border hover:border-primary/50 transition-all duration-200 overflow-hidden group border-l-[3px] ${getLeftBorderColor()} cursor-pointer ${isSelected ? 'border-primary ring-1 ring-primary' : 'border-border'}`}
    >
      <CardContent className="p-5">
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-start gap-4">
            <div className="flex items-start gap-3 overflow-hidden">
              <div className="p-2 bg-muted rounded-lg mt-1 shrink-0">
                <File className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-medium text-foreground truncate" title={fileName}>
                  {fileName}
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className={`text-xs ${getStatusColor()} ${isPlayfulMode && download.status === "paused" ? "animate-breathe" : ""}`}>
                    {getStatusText()}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(completedLength)} / {formatBytes(totalLength)}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              {download.status === "active" && (
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-500/10" onClick={(e) => { e.stopPropagation(); pauseDownload(download.gid); }}>
                  <Pause className="h-4 w-4" />
                </Button>
              )}
              {download.status === "paused" && (
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-emerald-500 dark:hover:text-emerald-400 hover:bg-emerald-500/10" onClick={(e) => { e.stopPropagation(); resumeDownload(download.gid); }}>
                  <Play className="h-4 w-4" />
                </Button>
              )}
              {(download.status === "active" || download.status === "paused" || download.status === "waiting") && (
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10" onClick={(e) => { e.stopPropagation(); cancelDownload(download.gid); }}>
                  <X className="h-4 w-4" />
                </Button>
              )}
              {download.status === "complete" && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10" 
                  title="Open Folder" 
                  onClick={async (e) => {
                    e.stopPropagation();
                    const filePath = download.files[0]?.path;
                    if (filePath) {
                      try {
                        const normalizedPath = filePath.replace(/\//g, '\\');
                        await Command.create('explorer', ['/select,', normalizedPath]).execute();
                      } catch (err) {
                        console.error("Explorer failed:", err);
                        if (download.dir) open(download.dir).catch(console.error);
                      }
                    } else if (download.dir) {
                      open(download.dir).catch(console.error);
                    }
                  }}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              )}
              {(download.status === "error" || download.status === "removed") && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-muted-foreground hover:text-emerald-500 dark:hover:text-emerald-400 hover:bg-emerald-500/10" 
                  title="Retry Download"
                  onClick={(e) => {
                    e.stopPropagation();
                    const uri = download.files[0]?.uris[0]?.uri;
                    if (uri) {
                      addDownload(uri);
                      cancelDownload(download.gid); // Removes the failed record
                    }
                  }}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              )}
              <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-muted-foreground hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10" 
                  title="Remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsDeleteDialogOpen(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
            </div>
          </div>

          {(download.status === "active" || download.status === "paused" || download.status === "waiting") && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span>{download.status === "active" ? `${formatBytes(speed)}/s` : '--'}</span>
                  {download.status === "active" && speed > 0 && (
                    <span className="text-muted-foreground/60">
                      • {getETA()}
                    </span>
                  )}
                </div>
                <span>{progress.toFixed(1)}%</span>
              </div>
              <Progress value={progress} className="h-1.5 bg-muted" />
            </div>
          )}
        </div>
      </CardContent>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
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
              id="delete-local" 
              checked={deleteLocalFile}
              onChange={(e) => setDeleteLocalFile(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="delete-local" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Also remove the downloaded file from local disk
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
