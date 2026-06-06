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
  const [rawFilename, setRawFilename] = useState<string>("Unknown");
  const [displayFilename, setDisplayFilename] = useState<string>("Unknown");
  const [displaySize, setDisplaySize] = useState<string>("Unknown size");
  const [securityStatus, setSecurityStatus] = useState<'scanning' | 'safe' | 'unsafe' | 'no-key' | 'error'>('no-key');
  const [threatDetails, setThreatDetails] = useState<string>('');
  const [selectedFormatUrl, setSelectedFormatUrl] = useState<string>("");
  const [checksum, setChecksum] = useState<string>("");
  const [prevStagedDownload, setPrevStagedDownload] = useState<unknown>(null);

  // Synchronous state updates during render to avoid cascading updates in effect
  if (stagedDownload !== prevStagedDownload) {
    setPrevStagedDownload(stagedDownload);
    if (stagedDownload) {
      setSaveDir(""); 
      setChecksum(stagedDownload.checksum || "");
      
      const apiKey = useDownloadStore.getState().safeBrowsingApiKey;
      setSecurityStatus(apiKey ? 'scanning' : 'no-key');
      
      setThreatDetails('');
      setSelectedFormatUrl(stagedDownload.url);

      let name = stagedDownload.filename || "";
      if (name) name = name.split(/[/\\]/).pop() || name;
      else if (stagedDownload.url) {
        try {
          name = new URL(stagedDownload.url).pathname.split('/').pop() || "Unknown";
        } catch { name = "Unknown"; }
      }
      setRawFilename(name || "Unknown");

      if (stagedDownload.fileSize && stagedDownload.fileSize > 0) {
        setDisplaySize(`${(stagedDownload.fileSize / (1024 * 1024)).toFixed(2)} MB`);
      } else {
        setDisplaySize("Unknown size");
      }
    }
  }

  useEffect(() => {
    if (stagedDownload) {
      if (!stagedDownload.fileSize || stagedDownload.fileSize <= 0) {
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
                setRawFilename(match[1].split(/[\/\\]/).pop() || "Unknown");
              }
            }
          })
          .catch(e => console.warn("Failed to fetch HEAD metadata:", e));
      }

      // Perform Security Scan
      const apiKey = useDownloadStore.getState().safeBrowsingApiKey;
      if (apiKey) {
        tauriFetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client: { clientId: "purrfect-download-manager", clientVersion: "1.0.0" },
            threatInfo: {
              threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
              platformTypes: ["ANY_PLATFORM"],
              threatEntryTypes: ["URL"],
              threatEntries: [{ url: stagedDownload.url }]
            }
          })
        })
        .then(async res => {
          const data = await res.json();
          if (!res.ok || data.error) {
            throw new Error(data.error?.message || `API Error ${res.status}`);
          }
          return data;
        })
        .then(data => {
          if (data.matches && data.matches.length > 0) {
            setSecurityStatus('unsafe');
            setThreatDetails(data.matches[0].threatType);
          } else {
            setSecurityStatus('safe');
          }
        })
        .catch(e => {
          console.warn("Security scan failed:", e);
          setSecurityStatus('error');
          setThreatDetails(e.message || 'Scan failed');
        });
      }
    }
  }, [stagedDownload]);

  useEffect(() => {
    let active = true;
    const { getUniqueFilename } = useDownloadStore.getState();
    if (rawFilename) {
      getUniqueFilename(rawFilename, saveDir || undefined).then(uniqueName => {
        if (active) setDisplayFilename(uniqueName);
      }).catch(() => {
        if (active) setDisplayFilename(rawFilename);
      });
    }
    return () => { active = false; };
  }, [rawFilename, saveDir]);

  const handleFormatChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const url = e.target.value;
    setSelectedFormatUrl(url);
    if (stagedDownload && stagedDownload.mediaFormats) {
      const format = stagedDownload.mediaFormats.find(f => f.url === url);
      if (format) {
        let baseName = rawFilename;
        const lastDot = baseName.lastIndexOf('.');
        if (lastDot !== -1) {
          baseName = baseName.substring(0, lastDot);
        }
        setRawFilename(`${baseName}.${format.ext}`);
        
        if (format.fileSize > 0) {
          setDisplaySize(`${(format.fileSize / (1024 * 1024)).toFixed(2)} MB`);
        } else {
          setDisplaySize("Unknown size");
        }
      }
    }
  };

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

  const handleConfirm = async () => {
    if (!stagedDownload) return;
    
    const selectedFormat = stagedDownload.mediaFormats?.find(f => f.url === selectedFormatUrl);
    const urlToDownload = selectedFormatUrl || stagedDownload.url;
    const finalDir = saveDir || "";
    const audioUrl = selectedFormat?.audioUrl;

    if (selectedFormat) {
        const headers = stagedDownload.headers || [];
        await addDownload(urlToDownload, headers, finalDir, displayFilename, audioUrl, checksum);
      } else {
        await addDownload(urlToDownload, stagedDownload.headers || [], finalDir, displayFilename, undefined, checksum);
      }
      clearStagedDownload();
  };

  if (!stagedDownload) return null;

  return (
    <Dialog open={!!stagedDownload} onOpenChange={(open) => !open && clearStagedDownload()}>
      <DialogContent className="sm:max-w-125 bg-card border-border text-foreground">
        <DialogHeader>
          <DialogTitle>Confirm Download</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            A new download has been intercepted. Where would you like to save it?
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="space-y-1">
            <Label className="text-muted-foreground text-xs uppercase">URL</Label>
            <div className="text-xs font-mono break-all bg-background p-2 rounded border border-border max-h-24 overflow-y-auto">
              {selectedFormatUrl || stagedDownload.url}
            </div>
          </div>
          
          {stagedDownload.mediaFormats && stagedDownload.mediaFormats.length > 0 && (
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs uppercase">Quality / Resolution</Label>
              <select 
                value={selectedFormatUrl}
                onChange={handleFormatChange}
                className="w-full bg-background border border-border text-foreground rounded-md p-2 text-sm focus:ring-1 focus:ring-primary outline-none"
              >
                {stagedDownload.mediaFormats.map(format => (
                  <option key={format.format_id} value={format.url}>
                    {format.resolution} ({format.fileSize > 0 ? `${(format.fileSize / (1024 * 1024)).toFixed(1)} MB` : 'Unknown Size'}) - {format.ext.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          )}
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs uppercase">Filename</Label>
              <div className="text-sm font-medium break-all" title={displayFilename}>
                {displayFilename}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs uppercase">Size</Label>
              <div className="text-sm font-medium">
                {displaySize}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs uppercase">Save Location</Label>
            <div className="flex gap-2">
              <Input 
                value={saveDir} 
                onChange={(e) => setSaveDir(e.target.value)}
                placeholder="Default Downloads Folder" 
                className="bg-background border-border text-foreground"
              />
              <Button variant="outline" onClick={handleBrowse} className="shrink-0">
                <FolderOpen className="w-4 h-4 mr-2" />
                Browse
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs uppercase">Checksum (Hash) <span className="text-muted-foreground/60 lowercase font-normal ml-1">(Optional)</span></Label>
            <Input 
              value={checksum} 
              onChange={(e) => setChecksum(e.target.value)}
              placeholder="e.g. md5, sha1, sha256..." 
              className="bg-background border-border text-foreground font-mono text-sm"
            />
          </div>

          <div className="space-y-1 border-t border-border pt-4 mt-2">
            <Label className="text-muted-foreground text-xs uppercase">Security Status</Label>
            <div className="flex items-center gap-2 mt-1">
              {securityStatus === 'no-key' && (
                <span className="text-sm text-muted-foreground bg-muted px-2 py-1 rounded-md border border-border">
                  Scanning Disabled
                </span>
              )}
              {securityStatus === 'scanning' && (
                <span className="text-sm text-foreground bg-muted px-2 py-1 rounded-md border border-border animate-pulse">
                  Scanning...
                </span>
              )}
              {securityStatus === 'safe' && (
                <span className="text-sm text-emerald-700 dark:text-emerald-100 bg-emerald-100 dark:bg-emerald-950/50 px-2 py-1 rounded-md border border-emerald-200 dark:border-emerald-900 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Safe
                </span>
              )}
              {securityStatus === 'unsafe' && (
                <span className="text-sm text-red-700 dark:text-red-100 bg-red-100 dark:bg-red-950/50 px-2 py-1 rounded-md border border-red-200 dark:border-red-900 flex items-center gap-1 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span> {threatDetails || 'Malicious'}
                </span>
              )}
              {securityStatus === 'error' && (
                <span className="text-sm text-yellow-700 dark:text-yellow-100 bg-yellow-100 dark:bg-yellow-950/50 px-2 py-1 rounded-md border border-yellow-200 dark:border-yellow-900 flex items-center gap-1 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-yellow-500"></span> API Error
                </span>
              )}
            </div>
            {securityStatus === 'unsafe' && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                This URL has been flagged as highly dangerous. Downloading has been blocked to protect your system.
              </p>
            )}
            {securityStatus === 'error' && (
              <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                {threatDetails}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={clearStagedDownload} className="text-muted-foreground hover:text-foreground">
            Cancel
          </Button>
          <Button 
            onClick={handleConfirm} 
            disabled={securityStatus === 'unsafe'}
            className={securityStatus === 'unsafe' 
              ? "bg-red-900/50 text-red-500 cursor-not-allowed" 
              : ""
            }
          >
            Start Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
