"use client";

import { useDownloadStore } from "@/store/downloadStore";
import { useState } from "react";
import { X, FileBox, FileArchive, FileImage, FileAudio, FileVideo, FileText, FileCode, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DownloadDetailsPanel() {
  const { selectedDownloadId, setSelectedDownload, active, completed, failed } = useDownloadStore();
  const [activeTab, setActiveTab] = useState<'general' | 'progress'>('general');

  if (!selectedDownloadId) return null;

  const download = [...active, ...completed, ...failed].find(d => d.gid === selectedDownloadId);
  
  if (!download) {
    return null;
  }

  const filePath = download.files[0]?.path || "Unknown File";
  const fileName = filePath.includes('/') ? filePath.split('/').pop() : filePath.split('\\').pop() || "Unknown File";
  const ext = fileName?.split('.').pop()?.toLowerCase();
  
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

  const speed = parseInt(download.downloadSpeed, 10);
  const progress = totalLength > 0 ? (completedLength / totalLength) * 100 : 0;

  const url = download.files[0]?.uris[0]?.uri || "Unknown URL";

  return (
    <div className="flex flex-col bg-card border-t border-border shadow-[0_-4px_20px_rgba(0,0,0,0.05)] w-full h-72 shrink-0 animate-in slide-in-from-bottom-full duration-200">
      <div className="flex items-center justify-between px-4 border-b border-border">
        <div className="flex gap-4">
          <button 
            className={`py-3 px-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'general' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab('general')}
          >
            General
          </button>
          <button 
            className={`py-3 px-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'progress' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab('progress')}
          >
            Progress
          </button>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted" onClick={() => setSelectedDownload(null)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'general' && (
          <div className="flex gap-6">
            <div className="shrink-0 p-4 bg-muted/50 rounded-xl border border-border flex items-center justify-center">
              {getFileIcon()}
            </div>
            <div className="flex-1 min-w-0 space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-foreground truncate" title={fileName || ""}>{fileName}</h2>
                <div className="flex gap-4 mt-1 text-sm text-muted-foreground">
                  <span>Status: <span className="text-foreground capitalize">{download.status}</span></span>
                  <span>Total size: <span className="text-foreground">{formatBytes(totalLength)}</span></span>
                </div>
              </div>
              
              <div className="space-y-2 text-sm">
                <div className="flex gap-2 items-center">
                  <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground truncate" title={filePath}>{filePath}</span>
                </div>
                <div className="flex gap-2 items-center">
                  <span className="text-primary text-xs font-bold uppercase tracking-wider shrink-0 w-8">URL</span>
                  <a href={url} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate block" title={url}>{url}</a>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'progress' && (
          <div className="space-y-6 max-w-2xl">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Downloaded:</span>
                <span className="font-medium">{formatBytes(completedLength)} of {formatBytes(totalLength)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Speed:</span>
                <span className="font-medium">{download.status === 'active' ? `${formatBytes(speed)}/s` : '--'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Progress:</span>
                <span className="font-medium">{progress.toFixed(2)}%</span>
              </div>
            </div>
            
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div 
                className={`h-full ${download.status === 'error' ? 'bg-red-500' : download.status === 'paused' ? 'bg-amber-500' : 'bg-primary'} transition-all duration-300 ease-out`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
