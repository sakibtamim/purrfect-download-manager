"use client";

import { useDownloadStore } from "@/store/downloadStore";
import { useState, useEffect } from "react";
import { aria2Client } from "@/lib/aria2Client";
import { X, FileBox, FileArchive, FileImage, FileAudio, FileVideo, FileText, FileCode, FolderOpen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { open, Command } from "@tauri-apps/plugin-shell";

export function DownloadDetailsPanel() {
  const { selectedDownloadId, setSelectedDownload, active, completed, failed, deleteDownload, isPlayfulMode } = useDownloadStore();
  const [activeTab, setActiveTab] = useState<'general' | 'progress' | 'connections'>('general');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteLocalFile, setDeleteLocalFile] = useState(false);
  const [checksumOpt, setChecksumOpt] = useState<string | null>(null);

  const download = [...active, ...completed, ...failed].find(d => d.gid === selectedDownloadId);

  const showConnections = download && (download.status === 'active' || download.status === 'waiting' || download.status === 'paused');
  const currentTab = (activeTab === 'connections' && !showConnections) ? 'general' : activeTab;

  useEffect(() => {
    let isMounted = true;
    if (selectedDownloadId) {
      aria2Client.getOption(selectedDownloadId).then(options => {
        if (isMounted) setChecksumOpt(options.checksum || null);
      }).catch(err => {
         console.warn("Failed to get option", err);
         if (isMounted) setChecksumOpt(null);
      });
    } else {
      Promise.resolve().then(() => {
        if (isMounted) setChecksumOpt(null);
      });
    }
    return () => { isMounted = false; };
  }, [selectedDownloadId]);

  if (!selectedDownloadId) return null;
  
  if (!download) {
    return null;
  }

  const filePath = download.files[0]?.path || "Unknown File";
  const fileName = filePath.includes('/') ? filePath.split('/').pop() : filePath.split('\\').pop() || "Unknown File";
  const ext = fileName?.split('.').pop()?.toLowerCase();
  
  const handleDelete = async () => {
    if (download) {
      await deleteDownload(download.gid, deleteLocalFile);
      setIsDeleteDialogOpen(false);
      setSelectedDownload(null);
    }
  };
  
  const getFileIcon = () => {
    switch(ext) {
      case 'zip': case 'rar': case '7z': case 'tar': case 'gz': return <FileArchive className="h-16 w-16 text-amber-500" />;
      case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'svg': return <FileImage className="h-16 w-16 text-emerald-500" />;
      case 'mp3': case 'wav': case 'ogg': case 'flac': case 'm4a': return <FileAudio className="h-16 w-16 text-purple-500" />;
      case 'mp4': case 'mkv': case 'avi': case 'webm': case 'mov': return <FileVideo className="h-16 w-16 text-blue-500" />;
      case 'pdf': case 'txt': case 'doc': case 'docx': case 'md': return <FileText className="h-16 w-16 text-slate-500" />;
      case 'js': case 'ts': case 'json': case 'html': case 'css': case 'rs': return <FileCode className="h-16 w-16 text-yellow-500" />;
      default: return <FileBox className="h-16 w-16 text-primary" />;
    }
  };

  const rawTotal = parseInt(download.totalLength, 10);
  const rawCompleted = parseInt(download.completedLength, 10);
  const fileTotal = download.files[0] ? parseInt(download.files[0].length, 10) : 0;
  const fileCompleted = download.files[0] ? parseInt(download.files[0].completedLength, 10) : 0;
  const totalLength = rawTotal > 0 ? rawTotal : fileTotal;
  const completedLength = rawCompleted > 0 ? rawCompleted : fileCompleted;
  
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatAddedAt = (timestamp?: number) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleString();
  };

  const getStatusText = (status: string) => {
    if (isPlayfulMode) {
      switch (status) {
        case "active": return "Your cat is on the hunt 🐾";
        case "paused": return "Cat is sleeping 💤";
        case "complete": return "Caught it! 😻";
        case "error": return "Oops, slipped away 😿";
        case "removed": return "Lost interest 🐈";
        case "waiting": return "Waiting to pounce 🐈‍⬛";
        default: return "Observing...";
      }
    } else {
      switch (status) {
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

  const speed = parseInt(download.downloadSpeed, 10);
  const progress = totalLength > 0 ? (completedLength / totalLength) * 100 : 0;

  const getETA = () => {
    if (download.status !== "active" || speed === 0) return null;
    const remainingBytes = totalLength - completedLength;
    if (remainingBytes <= 0) return null;
    
    const seconds = Math.floor(remainingBytes / speed);
    if (!isFinite(seconds)) return null;
    
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const url = download.files[0]?.uris[0]?.uri || "Unknown URL";

  return (
    <div className="flex flex-col bg-card border-t border-border shadow-[0_-4px_20px_rgba(0,0,0,0.05)] w-full h-72 shrink-0 animate-in slide-in-from-bottom-full duration-200">
      <div className="flex items-center justify-between px-4 border-b border-border">
        <div className="flex gap-4">
          <button 
            className={`py-3 px-2 text-sm font-medium border-b-2 transition-colors ${currentTab === 'general' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab('general')}
          >
            General
          </button>
          <button 
            className={`py-3 px-2 text-sm font-medium border-b-2 transition-colors ${currentTab === 'progress' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab('progress')}
          >
            Progress
          </button>
          {showConnections && (
            <button 
              className={`py-3 px-2 text-sm font-medium border-b-2 transition-colors ${currentTab === 'connections' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              onClick={() => setActiveTab('connections')}
            >
              Connections
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500 hover:bg-red-500/10" title="Remove Download" onClick={() => setIsDeleteDialogOpen(true)}>
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted" onClick={() => setSelectedDownload(null)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {currentTab === 'general' && (
          <div className="flex gap-6">
            <div className="shrink-0 pt-2 flex items-start justify-center">
              {getFileIcon()}
            </div>
            <div className="flex-1 min-w-0 space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-foreground line-clamp-2 break-all" title={fileName || ""}>{fileName}</h2>
                {(download.status === "active" || download.status === "paused" || download.status === "waiting") && (
                  <div className="mt-2 space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{download.status === "active" && speed > 0 ? getETA() : getStatusText(download.status)}</span>
                      <span>{progress.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div 
                        className={`h-full ${download.status === 'paused' ? 'bg-amber-500' : 'bg-primary'} transition-all duration-300 ease-out`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm mt-4">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-20">Speed:</span>
                  <span className="text-foreground">{download.status === 'active' ? `${formatBytes(speed)}/s` : '--'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-24">Downloaded:</span>
                  <span className="text-foreground">{formatBytes(completedLength)} of {formatBytes(totalLength)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-20">Added at:</span>
                  <span className="text-foreground">{formatAddedAt(download.addedAt)}</span>
                </div>
              </div>
              
              <div className="space-y-2 text-sm pt-2 w-full min-w-0">
                <button type="button" className="flex gap-2 items-center group cursor-pointer w-full text-left min-w-0" onClick={async () => {
                  const fp = download.files[0]?.path;
                  if (fp) {
                    try {
                      const normalizedPath = fp.replace(/\//g, '\\');
                      await Command.create('explorer', [`/select,${normalizedPath}`]).execute();
                    } catch (err) {
                      if (download.dir) open(download.dir).catch(console.error);
                    }
                  } else if (download.dir) {
                    open(download.dir).catch(console.error);
                  }
                }}>
                  <FolderOpen className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                  <span className="text-muted-foreground group-hover:text-primary transition-colors truncate flex-1 min-w-0" title={filePath}>
                    {filePath.length > 60 ? '...' + filePath.substring(filePath.length - 55) : filePath}
                  </span>
                </button>
                <div className="flex gap-2 items-center min-w-0">
                  <span className="text-primary text-xs font-bold uppercase tracking-wider shrink-0 w-8">URL</span>
                  <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate block flex-1 min-w-0" title={url}>
                    {url.length > 60 ? url.substring(0, 35) + '...' + url.substring(url.length - 15) : url}
                  </a>
                </div>
                {checksumOpt && (() => {
                  const parts = checksumOpt.split('=');
                  const algo = parts[0]?.toUpperCase() || 'HASH';
                  const digest = parts.slice(1).join('=') || checksumOpt;
                  
                  return (
                    <div className="flex items-start gap-2 mt-2 bg-muted/30 p-2 rounded-md border border-border min-w-0">
                      <span className="text-primary text-xs font-bold uppercase tracking-wider shrink-0 w-8 mt-0.5">HASH</span>
                      <span className="text-muted-foreground font-mono text-xs break-all flex-1 min-w-0" title={digest}>
                        <span className="font-semibold text-foreground mr-1">{algo}:</span>
                        {digest}
                      </span>
                      {download.status === 'error' && download.errorMessage?.toLowerCase().includes('checksum') ? (
                        <span className="ml-2 text-xs bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full border border-red-500/20 whitespace-nowrap">Mismatch ❌</span>
                      ) : download.status === 'complete' ? (
                        <span className="ml-2 text-xs bg-green-500/10 text-green-500 px-2 py-0.5 rounded-full border border-green-500/20 whitespace-nowrap">Verified ✅</span>
                      ) : download.status === 'active' ? (
                        <span className="ml-2 text-xs bg-blue-500/10 text-blue-500 px-2 py-0.5 rounded-full border border-blue-500/20 whitespace-nowrap">Verifying... ⏳</span>
                      ) : null}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {currentTab === 'progress' && (() => {
          const bitfieldStr = download.bitfield || "";
          const numPieces = parseInt(download.numPieces || "0", 10);
          const pieces: boolean[] = [];
          if (bitfieldStr) {
            for (let i = 0; i < bitfieldStr.length; i++) {
              const val = parseInt(bitfieldStr[i], 16);
              pieces.push((val & 8) !== 0);
              pieces.push((val & 4) !== 0);
              pieces.push((val & 2) !== 0);
              pieces.push((val & 1) !== 0);
            }
          }
          const actualPieces = pieces.slice(0, numPieces);

          const MAX_RENDERED_PIECES = 1000;
          let displayPieces = actualPieces;
          if (numPieces > MAX_RENDERED_PIECES) {
            const chunkSize = Math.ceil(numPieces / MAX_RENDERED_PIECES);
            displayPieces = [];
            for (let i = 0; i < numPieces; i += chunkSize) {
              const chunk = actualPieces.slice(i, i + chunkSize);
              const downloadedCount = chunk.filter(p => p).length;
              displayPieces.push(downloadedCount > chunk.length / 2);
            }
          }

          return (
            <div className="h-full flex flex-col">
              <div className="flex justify-between text-sm mb-4">
                <span className="text-muted-foreground">Downloaded Pieces:</span>
                <span className="font-medium">{actualPieces.filter(p => p).length} / {numPieces}</span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {numPieces > 0 ? (
                  <div className="flex flex-wrap gap-[2px] pr-2 pb-2">
                    {displayPieces.map((isDownloaded, i) => (
                      <div 
                        key={i} 
                        className={`w-2.5 h-2.5 rounded-[1px] ${isDownloaded ? 'bg-blue-500/80' : 'bg-muted border border-border/50'}`}
                        title={numPieces > MAX_RENDERED_PIECES ? `Block ${i + 1}` : `Piece ${i + 1}`}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                    No piece information available
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {currentTab === 'connections' && (() => {
          const uris = download.files[0]?.uris || [];
          const connCount = download.connections || "0";

          return (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 border-b border-border text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Host</th>
                    <th className="px-4 py-2 font-medium">Port</th>
                    <th className="px-4 py-2 font-medium">Connection count</th>
                  </tr>
                </thead>
                <tbody>
                  {parseInt(connCount, 10) > 0 && uris.length > 0 ? (
                    uris.map((u, i) => {
                      let host = "Unknown";
                      let port = "Unknown";
                      try {
                        const parsedUrl = new URL(u.uri);
                        host = parsedUrl.hostname;
                        port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80');
                      } catch (e) {
                        // invalid url
                      }
                      return (
                        <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2 text-foreground truncate max-w-[200px]" title={host}>{host}</td>
                          <td className="px-4 py-2 text-foreground">{port}</td>
                          <td className="px-4 py-2 text-foreground">{i === 0 ? connCount : '-'}</td>
                        </tr>
                      );
                    })
                  ) : parseInt(connCount, 10) > 0 && uris.length === 0 ? (
                    <tr className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2 text-foreground truncate max-w-[200px]">P2P / Torrent</td>
                      <td className="px-4 py-2 text-foreground">-</td>
                      <td className="px-4 py-2 text-foreground">{connCount}</td>
                    </tr>
                  ) : (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                        No active connections
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Download</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove this download from the list?
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center space-x-2 py-4">
            <input 
              type="checkbox" 
              id="delete-local-panel" 
              checked={deleteLocalFile}
              onChange={(e) => setDeleteLocalFile(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="delete-local-panel" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Also remove the downloaded file from local disk
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
