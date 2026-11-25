"use client";

import { useAppStore } from "@/store";
import { useState, useEffect } from "react";
import { aria2Client } from "@/lib/aria2Client";
import {
  X,
  FileBox,
  FileArchive,
  FileImage,
  FileAudio,
  FileVideo,
  FileText,
  FileCode,
  FolderOpen,
  Trash2,
  Play,
  Copy,
  Check,
  ExternalLink
} from "lucide-react";
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

  const [activeTab, setActiveTab] = useState<'overview' | 'pieces' | 'network'>('overview');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteLocalFile, setDeleteLocalFile] = useState(false);
  const [checksumOpt, setChecksumOpt] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const showConnections = Boolean(
    download && (download.status === 'active' || download.status === 'waiting' || download.status === 'paused')
  );
  const currentTab = activeTab === 'network' && !showConnections ? 'overview' : activeTab;

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
      const shouldDelete = deleteLocalFile;
      setIsDeleteDialogOpen(false);
      setDeleteLocalFile(false);
      setSelectedDownload(null);
      await deleteDownload(download.gid, shouldDelete);
    }
  };
  
  const handleCopyPath = () => {
    if (filePath) {
      navigator.clipboard.writeText(filePath);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
    }
  };

  const metadata = downloadMetadata[download.gid];
  const sourceUrl = metadata?.sourceUrl;
  const rawUrl = download.files[0]?.uris[0]?.uri || "Unknown URL";
  const displayUrl = sourceUrl || rawUrl;

  const handleCopyUrl = () => {
    if (displayUrl) {
      navigator.clipboard.writeText(displayUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  };

  const getFileIcon = (className = "h-5 w-5") => {
    switch(ext) {
      case 'zip': case 'rar': case '7z': case 'tar': case 'gz': return <FileArchive className={`${className} text-amber-500`} />;
      case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'svg': return <FileImage className={`${className} text-emerald-500`} />;
      case 'mp3': case 'wav': case 'ogg': case 'flac': case 'm4a': return <FileAudio className={`${className} text-purple-500`} />;
      case 'mp4': case 'mkv': case 'avi': case 'webm': case 'mov': return <FileVideo className={`${className} text-blue-500`} />;
      case 'pdf': case 'txt': case 'doc': case 'docx': case 'md': return <FileText className={`${className} text-slate-500`} />;
      case 'js': case 'ts': case 'json': case 'html': case 'css': case 'rs': return <FileCode className={`${className} text-yellow-500`} />;
      default: return <FileBox className={`${className} text-primary`} />;
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
        case "active": return "Hunting 🐾";
        case "paused": return "Sleeping 💤";
        case "complete": return "Caught it! 😻";
        case "error": return "Slipped away 😿";
        case "removed": return "Lost interest 🐈";
        case "waiting": return "Waiting 🐈‍⬛";
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

  const formatTypeBadge = () => {
    if (ext === 'mp4' || ext === 'mkv' || ext === 'webm' || ext === 'avi' || ext === 'mov') {
      return `MP4 Video • ${totalLength > 0 ? formatBytes(totalLength) : 'HD'}`;
    }
    if (ext === 'mp3' || ext === 'wav' || ext === 'flac' || ext === 'm4a' || ext === 'ogg') {
      return `Audio Stream • ${totalLength > 0 ? formatBytes(totalLength) : 'HQ'}`;
    }
    if (ext === 'zip' || ext === 'rar' || ext === '7z' || ext === 'tar' || ext === 'gz') {
      return `Archive • ${totalLength > 0 ? formatBytes(totalLength) : 'Compressed'}`;
    }
    return `${ext ? ext.toUpperCase() : 'File'} • ${totalLength > 0 ? formatBytes(totalLength) : 'Binary'}`;
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

  const isChecksumError = download.status === 'error' && download.errorMessage?.toLowerCase().includes('checksum');
  let hashAlgo = "SHA-256";
  let hashDigest = "No hash specified";
  if (checksumOpt) {
    const parts = checksumOpt.split('=');
    hashAlgo = parts[0]?.toUpperCase() || 'HASH';
    hashDigest = parts.slice(1).join('=') || checksumOpt;
  }

  return (
    <section 
      role="region"
      aria-label="Download Details Inspector"
      className="h-[360px] max-h-[55vh] min-h-[280px] shrink-0 border-t border-border bg-card/95 backdrop-blur-xl shadow-2xl flex flex-col z-30 animate-in slide-in-from-bottom duration-200 ease-out overflow-hidden"
    >
      {/* HEADER SECTION (EXACT PROTOTYPE MATCH) */}
      <div className="px-4 py-3.5 border-b border-border bg-card/50 flex items-start justify-between gap-3 shrink-0">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {/* Large File Icon with glowing pill */}
          <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-500 shrink-0 shadow-inner">
            {getFileIcon("w-5 h-5")}
          </div>

          {/* Title & Meta Badges */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase border ${
                download.status === 'complete' 
                  ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' 
                  : download.status === 'active'
                  ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                  : download.status === 'error'
                  ? 'bg-red-500/15 text-red-500 border-red-500/30'
                  : download.status === 'paused'
                  ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
                  : 'bg-muted text-muted-foreground border-border'
              }`}>
                {getStatusText(download.status)}
              </span>

              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-background border border-border text-muted-foreground">
                {formatTypeBadge()}
              </span>

              {checksumOpt ? (
                isChecksumError ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-500 border border-red-500/20 flex items-center gap-1">
                    <X className="w-3 h-3" />
                    Integrity Mismatch
                  </span>
                ) : download.status === 'complete' ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Integrity Verified
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
                    Verifying Hash...
                  </span>
                )
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-background border border-border text-muted-foreground">
                  Checksum: Optional
                </span>
              )}
            </div>
            
            <h3 className="text-sm font-bold text-foreground tracking-tight truncate mt-1" title={fileName}>
              {fileName}
            </h3>
          </div>
        </div>

        {/* Top Close & Action Buttons */}
        <div className="flex items-center gap-1 shrink-0 pt-0.5">
          <button 
            type="button"
            title="Delete Download" 
            onClick={() => {
              setDeleteLocalFile(false);
              setIsDeleteDialogOpen(true);
            }}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button 
            type="button"
            title="Close (Esc)" 
            onClick={() => setSelectedDownload(null)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-background transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* TAB CONTROLLER (Pill Segmented Style) & QUICK ACTIONS */}
      <div className="px-4 py-2 border-b border-border bg-background/60 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-card border border-border text-xs">
          <button 
            type="button"
            onClick={() => setActiveTab('overview')} 
            className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
              currentTab === 'overview' 
                ? 'font-semibold text-blue-500 bg-blue-500/10' 
                : 'font-medium text-muted-foreground hover:text-foreground'
            }`}
          >
            Overview & Specs
          </button>
          <button 
            type="button"
            onClick={() => setActiveTab('pieces')} 
            className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
              currentTab === 'pieces' 
                ? 'font-semibold text-blue-500 bg-blue-500/10' 
                : 'font-medium text-muted-foreground hover:text-foreground'
            }`}
          >
            Chunk Map (Pieces)
          </button>
          {showConnections && (
            <button 
              type="button"
              onClick={() => setActiveTab('network')} 
              className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                currentTab === 'network' 
                  ? 'font-semibold text-blue-500 bg-blue-500/10' 
                  : 'font-medium text-muted-foreground hover:text-foreground'
              }`}
            >
              Sockets & Streams ({download.connections || "1"})
            </button>
          )}
        </div>

        {/* Quick Action Bar */}
        <div className="flex items-center gap-1.5">
          {download.status === 'complete' && (
            <button 
              type="button"
              onClick={async () => {
                const fp = download.files[0]?.path;
                if (fp) open(fp).catch(console.error);
              }}
              className="px-2.5 py-1 rounded-md text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Play File
            </button>
          )}
          <button 
            type="button"
            onClick={async () => {
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
            }}
            className="px-2.5 py-1 rounded-md text-xs font-medium bg-card hover:bg-muted border border-border text-foreground flex items-center gap-1 transition-colors cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
            Show in Folder
          </button>
        </div>
      </div>

      {/* TAB CONTENT SCROLL AREA */}
      <div className="p-4 overflow-y-auto space-y-3.5 flex-1 text-xs min-h-0">
        
        {/* ================= TAB 1: OVERVIEW & SPECS ================= */}
        {currentTab === 'overview' && (
          <div className="space-y-3">
            
            {/* Realtime Progress & Bandwidth Card */}
            <div className="p-3.5 rounded-xl bg-gradient-to-br from-blue-500/10 via-background to-background border border-blue-500/20 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm text-foreground">
                    {download.status === 'active' 
                      ? (speed > 0 ? formatSpeed(speed, speedUnit) : 'Connecting...') 
                      : download.status === 'complete' 
                      ? 'Finished' 
                      : download.status === 'paused' 
                      ? 'Paused' 
                      : 'Stopped'}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {download.status === 'active' && speed > 0
                      ? `• ${download.connections || 1} split connection${parseInt(download.connections || "1", 10) > 1 ? 's' : ''}`
                      : download.status === 'complete'
                      ? '• Status: Done'
                      : ''}
                  </span>
                </div>
                <div className="flex items-center gap-1 font-mono">
                  <span className="text-sm font-extrabold text-blue-500">{progress.toFixed(1)}%</span>
                </div>
              </div>

              {/* Sleek Linear Progress Bar with Gradient */}
              <div className="h-2 w-full bg-card rounded-full overflow-hidden border border-border">
                <div 
                  className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400 rounded-full transition-all duration-500" 
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1 text-[11px]">
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Downloaded</span>
                  <span className="font-mono font-bold text-foreground">{formatBytes(completedLength)} / {formatBytes(totalLength)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Elapsed / ETA</span>
                  <span className="font-mono font-medium text-foreground">
                    {download.status === 'complete' 
                      ? 'Completed' 
                      : (getETA() ? `${getETA()} remaining` : '--')}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Engine</span>
                  <span className="font-mono font-medium text-emerald-500">
                    {parseInt(download.connections || "0", 10) > 1 ? 'Aria2 Multi-Chunk' : 'Aria2 Direct Stream'}
                  </span>
                </div>
              </div>
            </div>

            {/* Storage & Origin Stacked (One per row) */}
            <div className="space-y-3">
              {/* Storage & Destination Card */}
              <div className="p-3 rounded-xl bg-background border border-border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Storage Location</span>
                  <span className="text-[10px] text-emerald-500 font-mono">
                    {ext ? `${ext.toUpperCase()} File` : 'Local Storage'}
                  </span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-lg bg-card border border-border font-mono text-[11px] text-foreground select-all">
                  <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="truncate flex-1" title={filePath}>{filePath}</span>
                  <button 
                    type="button"
                    title="Copy Path" 
                    onClick={handleCopyPath}
                    className="text-muted-foreground hover:text-foreground p-1 transition-colors cursor-pointer"
                  >
                    {copiedPath ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Source & Checksum Integrity Card */}
              <div className="p-3 rounded-xl bg-background border border-border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Origin & Integrity Check</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyUrl}
                      title="Copy URL"
                      className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      {copiedUrl ? <Check className="w-2.5 h-2.5 text-emerald-500" /> : <Copy className="w-2.5 h-2.5" />}
                      <span>{copiedUrl ? "Copied" : "Copy"}</span>
                    </button>
                    <a 
                      href={displayUrl} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                      title="Open in Browser"
                    >
                      Open <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                </div>
                
                {/* URL row */}
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-muted-foreground w-20 shrink-0 whitespace-nowrap font-medium">URL:</span>
                  <span className="text-blue-500 truncate flex-1 font-mono text-[11px]" title={displayUrl}>
                    {displayUrl}
                  </span>
                </div>

                {/* Hash row */}
                <div className="flex items-center gap-2 text-[11px] pt-1 border-t border-border/60">
                  <span className="text-muted-foreground w-20 shrink-0 whitespace-nowrap font-medium">{hashAlgo}:</span>
                  <span className="font-mono text-foreground truncate flex-1 opacity-80 text-[10px]" title={hashDigest}>
                    {hashDigest}
                  </span>
                  {checksumOpt ? (
                    isChecksumError ? (
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-red-500/10 text-red-500 font-bold border border-red-500/20">MISMATCH</span>
                    ) : download.status === 'complete' ? (
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-500/10 text-emerald-500 font-bold border border-emerald-500/20">MATCH</span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-blue-500/10 text-blue-400 font-bold border border-blue-500/20">CHECKING</span>
                    )
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-muted text-muted-foreground font-mono">OPTIONAL</span>
                  )}
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ================= TAB 2: CHUNK MAP (PIECES) ================= */}
        {currentTab === 'pieces' && (() => {
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
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-background border border-border space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground">Chunk Piece Bitfield</span>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {numPieces > 0 ? `${completedPieces} / ${numPieces} Blocks Downloaded (${formatBytes(pieceLength)}/piece)` : 'Continuous Stream'}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Visual representation of downloaded file chunks across multi-thread segments:
                </p>
                {numPieces > 0 ? (
                  <div className="flex flex-wrap gap-[3px] p-2.5 rounded-lg bg-card border border-border max-h-[160px] overflow-y-auto">
                    {displayPieces.map((isDownloaded, i) => (
                      <div 
                        key={i} 
                        className={`h-3 w-3 rounded-[2px] transition-colors ${isDownloaded ? 'bg-emerald-500 shadow-xs' : 'bg-muted border border-border/50'}`}
                        title={`Block #${i + 1} (${isDownloaded ? 'Downloaded' : 'Pending'})`}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="p-4 border border-dashed border-border rounded-lg bg-card/30 text-center">
                    <p className="text-xs text-muted-foreground">Direct streaming active. File downloaded as a continuous sequential byte-stream.</p>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ================= TAB 3: NETWORK & SOCKETS ================= */}
        {currentTab === 'network' && (() => {
          const uris = download.files[0]?.uris || [];
          const connCount = download.connections || "0";
          const numConn = parseInt(connCount, 10);

          return (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="bg-background border border-border rounded-lg px-3 py-1.5 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground uppercase font-semibold">Connections:</span>
                  <Badge variant="secondary" className="font-mono text-xs">
                    {numConn > 1 ? `${connCount} Parallel Streams (Split)` : `${connCount} Active Stream`}
                  </Badge>
                </div>
                <div className="bg-background border border-border rounded-lg px-3 py-1.5 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground uppercase font-semibold">Throughput:</span>
                  <Badge variant="outline" className="font-mono text-xs text-primary border-primary/30">
                    {speed > 0 ? formatSpeed(speed, speedUnit) : '--'}
                  </Badge>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full text-sm text-left">
                  <thead className="bg-background border-b border-border text-muted-foreground text-xs uppercase tracking-wider">
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
                            <td className="px-4 py-2 text-foreground font-mono text-xs truncate max-w-[240px]" title={h.host}>
                              {h.host}
                            </td>
                            <td className="px-4 py-2 text-foreground text-xs font-mono">
                              {h.protocol} / {h.port}
                            </td>
                            <td className="px-4 py-2 text-foreground font-mono text-xs">
                              <span className="font-semibold">{sockets}</span> socket{sockets > 1 ? 's' : ''}
                            </td>
                            <td className="px-4 py-2">
                              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] py-0 font-normal">
                                Established
                              </Badge>
                            </td>
                          </tr>
                        );
                      });
                    })() : (
                      <tr>
                        <td colSpan={4} className="px-4 py-4 text-center text-muted-foreground text-xs">
                          {numConn > 0 ? `${connCount} peer connections established` : 'No active connections'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

      </div>

      {/* FOOTER STATUS STRIP (EXACT PROTOTYPE MATCH) */}
      <div className="px-4 py-2 border-t border-border bg-background flex items-center justify-between text-[11px] text-muted-foreground shrink-0">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${
            download.status === 'complete' 
              ? 'bg-emerald-500' 
              : download.status === 'active' 
              ? 'bg-blue-500 animate-pulse' 
              : 'bg-amber-500'
          }`} />
          <span>
            Added at {formatAddedAt(download.addedAt)}
            {download.status === 'complete' && ' • Completed'}
          </span>
        </div>
        <div className="font-mono text-[10px] opacity-80">
          GID: {download.gid}
        </div>
      </div>

      {/* REMOVE DOWNLOAD CONFIRMATION DIALOG */}
      <Dialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open);
          if (!open) setDeleteLocalFile(false);
        }}
      >
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
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
            />
            <label htmlFor="delete-local-panel" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
              Also remove the downloaded file from local disk
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsDeleteDialogOpen(false);
                setDeleteLocalFile(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
