"use client";

import { useState, useEffect } from "react";
import { useDownloadStore } from "@/store/downloadStore";
import { open } from "@tauri-apps/plugin-dialog";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderOpen } from "lucide-react";

export function ConfirmDownloadModal() {
  const { stagedDownload, clearStagedDownload, addDownload } = useDownloadStore();
  const [saveDir, setSaveDir] = useState<string>("");
  const [displayFilename, setDisplayFilename] = useState<string>("Unknown");
  const [displaySize, setDisplaySize] = useState<string>("Unknown size");

  useEffect(() => {
    if (stagedDownload) {
      // In a real app we might fetch the OS default Downloads folder using @tauri-apps/plugin-path
      // For now, we'll leave it empty to use aria2's default if not specified
      setSaveDir(""); 

      // First, set what we currently know
      let name = stagedDownload.filename || "";
      if (name) name = name.split(/[/\\]/).pop() || name;
      else if (stagedDownload.url) {
        try {
          name = new URL(stagedDownload.url).pathname.split('/').pop() || "Unknown";
        } catch (e) { name = "Unknown"; }
      }
      setDisplayFilename(name || "Unknown");

      if (stagedDownload.fileSize && stagedDownload.fileSize > 0) {
        setDisplaySize(`${(stagedDownload.fileSize / (1024 * 1024)).toFixed(2)} MB`);
      } else {
        setDisplaySize("Unknown size");
        // Trigger background HEAD request to get real size and name
        tauriFetch(stagedDownload.url, { method: "HEAD" })
          .then(res => {
            const sizeHeader = res.headers.get("content-length");
            if (sizeHeader) {
              const bytes = parseInt(sizeHeader, 10);
              if (!isNaN(bytes)) {
                if (bytes > 1024 * 1024 * 1024) {
                  setDisplaySize(`${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`);
                } else if (bytes > 1024 * 1024) {
                  setDisplaySize(`${(bytes / (1024 * 1024)).toFixed(2)} MB`);
                } else if (bytes > 1024) {
                  setDisplaySize(`${(bytes / 1024).toFixed(2)} KB`);
                } else {
                  setDisplaySize(`${bytes} B`);
                }
              }
            }
            
            const dispHeader = res.headers.get("content-disposition");
            if (dispHeader) {
              const match = dispHeader.match(/filename="?([^"]+)"?/i);
              if (match && match[1]) {
                setDisplayFilename(match[1]);
              }
            }
          })
          .catch(e => console.warn("Failed to fetch HEAD metadata:", e));
      }
    }
  }, [stagedDownload]);

  const handleBrowse = async () => {
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Select Save Location"
      });
      if (selectedPath && typeof selectedPath === 'string') {
        setSaveDir(selectedPath);
      }
    } catch (e) {
      console.error("Failed to open dialog", e);
    }
  };

  const handleConfirm = () => {
    if (!stagedDownload) return;
    
    // Add the download with the selected directory (if any)
    addDownload(stagedDownload.url, stagedDownload.headers, saveDir || undefined);
    
    // Clear staged state to close modal
    clearStagedDownload();
  };

  if (!stagedDownload) return null;

  return (
    <Dialog open={!!stagedDownload} onOpenChange={(open) => !open && clearStagedDownload()}>
      <DialogContent className="sm:max-w-[500px] bg-zinc-950 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle>Confirm Download</DialogTitle>
          <DialogDescription className="text-zinc-400">
            A new download has been intercepted. Where would you like to save it?
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="space-y-1">
            <Label className="text-zinc-500 text-xs uppercase">URL</Label>
            <div className="text-sm font-medium break-all bg-zinc-900 p-2 rounded border border-zinc-800 max-h-24 overflow-y-auto">
              {stagedDownload.url}
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-zinc-500 text-xs uppercase">Filename</Label>
              <div className="text-sm font-medium break-all" title={displayFilename}>
                {displayFilename}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-zinc-500 text-xs uppercase">Size</Label>
              <div className="text-sm font-medium">
                {displaySize}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-zinc-500 text-xs uppercase">Save Location</Label>
            <div className="flex gap-2">
              <Input 
                value={saveDir} 
                onChange={(e) => setSaveDir(e.target.value)}
                placeholder="Default Downloads Folder" 
                className="bg-zinc-900 border-zinc-800 text-zinc-100"
              />
              <Button variant="outline" onClick={handleBrowse} className="shrink-0 border-zinc-700 hover:bg-zinc-800 text-zinc-100">
                <FolderOpen className="w-4 h-4 mr-2" />
                Browse
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={clearStagedDownload} className="text-zinc-400 hover:text-zinc-100">
            Cancel
          </Button>
          <Button onClick={handleConfirm} className="bg-indigo-600 hover:bg-indigo-700 text-white">
            Start Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
