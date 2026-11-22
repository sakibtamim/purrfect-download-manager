"use client";

import { useAppStore } from "@/store";
import { useState, useEffect } from "react";
import { aria2Client } from "@/lib/aria2Client";
import { X, FileBox, FileArchive, FileImage, FileAudio, FileVideo, FileText, FileCode, FolderOpen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { open } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { formatSpeed, decodeFilename } from "@/lib/utils";

export function DownloadDetailsPanel() {
  const selectedDownloadId = useAppStore((state) => state.selectedDownloadId);
  if (!selectedDownloadId) return null;
  return <DownloadDetailsPanelContent selectedDownloadId={selectedDownloadId} />;
}

function DownloadDetailsPanelContent({ selectedDownloadId }: { selectedDownloadId: string }) {
  const setSelectedDownload = useAppStore((state) => state.setSelectedDownload);
  const deleteDownload = useAppStore((state) => state.deleteDownload);
  const isPlayfulMode = useAppStore((state) => state.isPlayfulMode);
  const speedUnit = useAppStore((state) => state.speedUnit);
  const downloadMetadata = useAppStore((state) => state.downloadMetadata);
  const download = useAppStore((state) =>
    [...state.active, ...state.completed, ...state.failed].find((d) => d.gid === selectedDownloadId)
  );

  const [activeTab, setActiveTab] = useState<'general' | 'progress' | 'connections'>('general');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteLocalFile, setDeleteLocalFile] = useState(false);
  const [checksumOpt, setChecksumOpt] = useState<string | null>(null);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedDownload(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setSelectedDownload]);

  if (!download) {
    return null;
  }

  const filePath = download.files[0]?.path || "Unknown File";
  const rawName = filePath.includes('/') ? filePath.split('/').pop() : filePath.split('\\').pop() || "Unknown File";
  const fileName = decodeFilename(rawName);
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
      case 'zip': case 'rar': case '7z': case 'tar': case 'gz': return <FileArchive className="h-9 w-9 text-amber-500" />;
      case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'svg': return <FileImage className="h-9 w-9 text-emerald-500" />;
      case 'mp3': case 'wav': case 'ogg': case 'flac': case 'm4a': return <FileAudio className="h-9 w-9 text-purple-500" />;
      case 'mp4': case 'mkv': case 'avi': case 'webm': case 'mov': return <FileVideo className="h-9 w-9 text-blue-500" />;
      case 'pdf': case 'txt': case 'doc': case 'docx': case 'md': return <FileText className="h-9 w-9 text-slate-500" />;
      case 'js': case 'ts': case 'json': case 'html': case 'css': case 'rs': return <FileCode className="h-9 w-9 text-yellow-500" />;
      default: return <FileBox className="h-9 w-9 text-primary" />;
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

  const metadata = download ? downloadMetadata[download.gid] : undefined;
  const sourceUrl = metadata?.sourceUrl;
  const rawUrl = download.files[0]?.uris[0]?.uri || "Unknown URL";
  const displayUrl = sourceUrl || rawUrl;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-background/50 backdrop-blur-[2px] z-40 transition-opacity animate-in fade-in duration-200"
        onClick={() => setSelectedDownload(null)}
      />

      {/* Slide-over Drawer */}
      <aside 
        role="dialog"
        aria-modal="true"
        aria-label="Download Details Inspector"
        className="fixed top-0 right-0 h-full w-[420px] max-w-[92vw] z-50 bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200 ease-out"
      >
        <div className="flex items-center justify-between px-3.5 h-12 border-b border-border shrink-0 bg-muted/20">
          <div role="tablist" aria-label="Inspector tabs" className="flex gap-1.5">
            <button 
              role="tab"
              aria-selected={currentTab === 'general'}
              className={`py-1 px-2.5 text-xs font-medium rounded-md transition-colors ${currentTab === 'general' ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setActiveTab('general')}
            >
              General
            </button>
            <button 
              role="tab"
              aria-selected={currentTab === 'progress'}
              className={`py-1 px-2.5 text-xs font-medium rounded-md transition-colors ${currentTab === 'progress' ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setActiveTab('progress')}
            >
              Progress
            </button>
            {showConnections && (
              <button 
                role="tab"
                aria-selected={currentTab === 'connections'}
                className={`py-1 px-2.5 text-xs font-medium rounded-md transition-colors ${currentTab === 'connections' ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setActiveTab('connections')}
              >
                Connections
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-xs" className="h-7 w-7 text-muted-foreground hover:text-red-500 hover:bg-red-500/10" title="Remove Download" aria-label="Remove download" onClick={() => setIsDeleteDialogOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon-xs" className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted" title="Close Panel (Esc)" aria-label="Close panel" onClick={() => setSelectedDownload(null)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {currentTab === 'general' && (
          <div className="space-y-3.5">
            <div className="flex items-start gap-3 bg-muted/20 p-3 rounded-lg border border-border">
              <div className="shrink-0 pt-0.5">
                {getFileIcon()}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-foreground break-all line-clamp-2" title={fileName || ""}>{fileName}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {getStatusText(download.status)}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-mono">
                    {progress.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            {(download.status === "active" || download.status === "paused" || download.status === "waiting") && (
              <div className="space-y-1.5 bg-muted/20 p-3 rounded-lg border border-border">
                <div className="flex justify-between text-xs text-muted-foreground mb-1 font-mono">
                  <span>{download.status === "active" && speed > 0 ? getETA() : getStatusText(download.status)}</span>
                  <span>{formatBytes(completedLength)} / {formatBytes(totalLength)}</span>
                </div>
                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${download.status === 'paused' ? 'bg-amber-500' : 'bg-primary'} transition-all duration-300 ease-out`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            <div className="space-y-2 text-xs bg-muted/20 p-3 rounded-lg border border-border">
              <div className="flex justify-between items-center py-1 border-b border-border/50">
                <span className="text-muted-foreground">Speed</span>
                <span className="font-mono font-medium text-foreground">{download.status === 'active' ? formatSpeed(speed, speedUnit) : '--'}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-border/50">
                <span className="text-muted-foreground">Downloaded</span>
                <span className="font-mono font-medium text-foreground">{formatBytes(completedLength)} of {formatBytes(totalLength)}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-muted-foreground">Added at</span>
                <span className="font-mono text-foreground">{formatAddedAt(download.addedAt)}</span>
              </div>
            </div>

            <div className="space-y-2 text-xs bg-muted/20 p-3 rounded-lg border border-border">
              <div className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">File Location</span>
                <button type="button" className="flex gap-2 items-center group cursor-pointer w-full text-left min-w-0" onClick={async () => {
                  const fp = download.files[0]?.path;
                  if (fp) {
                    try {
                      await invoke('reveal_in_folder', { path: fp });
                    } catch {
                      if (download.dir) open(download.dir).catch(console.error);
                    }
                  } else if (download.dir) {
                    open(download.dir).catch(console.error);
                  }
                }}>
                  <FolderOpen className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                  <span className="text-muted-foreground group-hover:text-primary transition-colors truncate flex-1 min-w-0 text-xs" title={filePath}>
                    {filePath}
                  </span>
                </button>
              </div>

              <div className="space-y-1 pt-2 border-t border-border/50">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">URL</span>
                <a href={displayUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate block text-xs" title={displayUrl}>
                  {displayUrl}
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
        )}

        {currentTab === 'progress' && (() => {
          const bitfieldStr = download.bitfield || "";
          const numPieces = parseInt(download.numPieces || "0", 10);
          const pieceLength = parseInt(download.pieceLength || "0", 10);
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
          const completedPieces = actualPieces.filter(p => p).length;

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
            <div className="h-full flex flex-col min-h-0 space-y-3">
              {/* Overall Progress Metrics Header Card */}
              <div className="bg-muted/30 border border-border rounded-lg p-3 space-y-2.5 shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant={download.status === 'complete' ? 'default' : download.status === 'error' ? 'destructive' : 'secondary'} className="capitalize text-xs font-medium">
                      {getStatusText(download.status)}
                    </Badge>
                    {download.status === 'active' && speed > 0 && (
                      <span className="text-xs font-semibold text-primary">{formatSpeed(speed, speedUnit)}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                    {getETA() && <span>ETA: {getETA()}</span>}
                    <span className="font-semibold text-foreground">{progress.toFixed(1)}%</span>
                  </div>
                </div>

                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${download.status === 'paused' ? 'bg-amber-500' : download.status === 'complete' ? 'bg-emerald-500' : download.status === 'error' ? 'bg-red-500' : 'bg-primary'} transition-all duration-300 ease-out`}
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-0.5">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Downloaded</span>
                    <span className="font-medium text-foreground">{formatBytes(completedLength)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Total Size</span>
                    <span className="font-medium text-foreground">{totalLength > 0 ? formatBytes(totalLength) : 'Unknown'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Speed</span>
                    <span className="font-medium text-foreground">{download.status === 'active' && speed > 0 ? formatSpeed(speed, speedUnit) : '--'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">{numPieces > 0 ? 'Pieces' : 'Mode'}</span>
                    <span className="font-medium text-foreground">
                      {numPieces > 0 ? `${completedPieces} / ${numPieces}` : 'Direct Stream'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Chunk Pieces or Streaming Card */}
              {numPieces > 0 ? (
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5 shrink-0">
                    <span>
                      Piece Distribution ({completedPieces} of {numPieces} completed{pieceLength > 0 ? ` • ${formatBytes(pieceLength)} per piece` : ''}):
                    </span>
                    <span className="text-[11px]">Green: Complete • Gray: Pending</span>
                  </div>
                  <div className="flex-1 overflow-y-auto min-h-0 pr-1">
                    <div className="flex flex-wrap gap-[2px] pb-2">
                      {displayPieces.map((isDownloaded, i) => (
                        <div 
                          key={i} 
                          className={`w-2.5 h-2.5 rounded-[1px] transition-colors ${isDownloaded ? 'bg-emerald-500' : 'bg-muted border border-border/50'}`}
                          title={numPieces > MAX_RENDERED_PIECES ? `Block ${i + 1} (${isDownloaded ? 'Complete' : 'Pending'})` : `Piece ${i + 1} (${isDownloaded ? 'Complete' : 'Pending'})`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-4 border border-dashed border-border rounded-lg bg-muted/10 text-center">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <h4 className="text-xs font-semibold text-foreground mb-1">
                    Direct HTTP Streaming Download
                  </h4>
                  <p className="text-[11px] text-muted-foreground max-w-sm mb-2">
                    This server is delivering a continuous data stream without piece-segmented bitfields. Download progress is tracked continuously by bytes transferred.
                  </p>
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-muted/40 rounded-full text-[11px] font-mono text-muted-foreground">
                    <span>{formatBytes(completedLength)}</span>
                    <span>/</span>
                    <span>{totalLength > 0 ? formatBytes(totalLength) : 'Streaming'}</span>
                    <span>({progress.toFixed(1)}%)</span>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {currentTab === 'connections' && (() => {
          const uris = download.files[0]?.uris || [];
          const connCount = download.connections || "0";
          const numConn = parseInt(connCount, 10);

          return (
            <div className="h-full flex flex-col min-h-0 space-y-3">
              {/* Top summary badges */}
              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <div className="bg-muted/30 border border-border rounded-lg px-3 py-1.5 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground uppercase font-semibold">Connections:</span>
                  <Badge variant="secondary" className="font-mono text-xs">
                    {numConn > 1
                      ? `${connCount} Parallel Streams (Split)`
                      : `${connCount} Active Stream`}
                  </Badge>
                </div>
                <div className="bg-muted/30 border border-border rounded-lg px-3 py-1.5 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground uppercase font-semibold">Throughput:</span>
                  <Badge variant="outline" className="font-mono text-xs text-primary border-primary/30">
                    {speed > 0 ? formatSpeed(speed, speedUnit) : '--'}
                  </Badge>
                </div>
              </div>

              {/* Detailed connection table */}
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 border-b border-border text-muted-foreground text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Host</th>
                      <th className="px-4 py-2 font-semibold">Protocol / Port</th>
                      <th className="px-4 py-2 font-semibold">Allocated Sockets</th>
                      <th className="px-4 py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {numConn > 0 && uris.length > 0 ? (() => {
                      const hostMap = new Map<string, { host: string; port: string; protocol: string; count: number }>();
                      uris.forEach(u => {
                        let host = "Unknown";
                        let port = "Unknown";
                        let protocol = "HTTP";
                        try {
                          const parsedUrl = new URL(u.uri);
                          host = parsedUrl.hostname;
                          protocol = parsedUrl.protocol.replace(':', '').toUpperCase();
                          port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80');
                        } catch {}
                        const key = `${host}:${port}`;
                        const existing = hostMap.get(key);
                        if (existing) {
                          existing.count++;
                        } else {
                          hostMap.set(key, { host, port, protocol, count: 1 });
                        }
                      });
                      const uniqueHosts = Array.from(hostMap.values());
                      return uniqueHosts.map((h, i) => {
                        const sockets = uniqueHosts.length === 1 
                          ? numConn 
                          : Math.max(1, Math.round((h.count / uris.length) * numConn));
                        return (
                          <tr key={i} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-2.5 text-foreground font-mono text-xs truncate max-w-[240px]" title={h.host}>
                              {h.host}
                            </td>
                            <td className="px-4 py-2.5 text-foreground text-xs font-mono">
                              {h.protocol} / {h.port}
                            </td>
                            <td className="px-4 py-2.5 text-foreground font-mono text-xs">
                              <span className="font-semibold">{sockets}</span> socket{sockets > 1 ? 's' : ''}
                            </td>
                            <td className="px-4 py-2.5">
                              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[11px] py-0 font-normal">
                                Established
                              </Badge>
                            </td>
                          </tr>
                        );
                      });
                    })() : numConn > 0 && uris.length === 0 ? (
                      <tr className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 text-foreground font-mono text-xs truncate max-w-[240px]">
                          P2P / BitTorrent Swarm
                        </td>
                        <td className="px-4 py-2.5 text-foreground text-xs font-mono">
                          TCP / UDP
                        </td>
                        <td className="px-4 py-2.5 text-foreground font-mono text-xs">
                          {connCount}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[11px] py-0 font-normal">
                            Active Peers
                          </Badge>
                        </td>
                      </tr>
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground text-xs">
                          No active connections
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {numConn === 1 && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 shrink-0">
                  <span>💡</span>
                  <span>Single connection active. Aria2 dynamically splits into up to 16 parallel connections when byte ranges (Accept-Ranges) are accepted by the server.</span>
                </p>
              )}
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
      </aside>
    </>
  );
}
