"use client";

import { useState, useEffect } from "react";
import { useAppStore } from "@/store";
import { open } from "@tauri-apps/plugin-dialog";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, CheckCircle2, ChevronDown } from "lucide-react";
import { type ChecksumAlgorithm, type DetectedChecksum, validateChecksum } from "@/lib/utils";
import { type YtDlpFormat } from "@/lib/ytdlpClient";

export function formatResolutionLabel(format: YtDlpFormat): string {
  let width = format.width;
  let height = format.height;

  if ((!width || !height) && format.resolution) {
    const dimMatch = format.resolution.match(/(\d+)\s*[xX×]\s*(\d+)/);
    if (dimMatch) {
      width = parseInt(dimMatch[1], 10);
      height = parseInt(dimMatch[2], 10);
    } else {
      const pMatch = format.resolution.match(/(\d+)p/i);
      if (pMatch) {
        height = parseInt(pMatch[1], 10);
      }
    }
  }

  let label: string;
  if ((width && width >= 3840) || (height && height >= 2160)) {
    label = '4K (2160p)';
  } else if ((width && width >= 2560) || (height && height >= 1440)) {
    label = '1440p (2K)';
  } else if ((width && width >= 1920) || (height && height >= 1000)) {
    label = '1080p (Full HD)';
  } else if ((width && width >= 1280) || (height && height >= 700)) {
    label = '720p (HD)';
  } else if ((width && width >= 800) || (height && height >= 450)) {
    label = '480p';
  } else if ((width && width >= 600) || (height && height >= 300)) {
    label = '360p';
  } else {
    label = format.resolution || 'Standard Quality';
  }

  const sizeStr = format.fileSize > 0 
    ? `${(format.fileSize / (1024 * 1024)).toFixed(1)} MB` 
    : 'Unknown Size';

  return `${label} • ${sizeStr} • ${format.ext.toUpperCase()}`;
}

export function ConfirmDownloadModal() {
  const stagedDownload = useAppStore((state) => state.stagedDownload);
  const clearStagedDownload = useAppStore((state) => state.clearStagedDownload);
  const addDownload = useAppStore((state) => state.addDownload);
  const [saveDir, setSaveDir] = useState<string>("");
  const [rawFilename, setRawFilename] = useState<string>("Unknown");
  const [displayFilename, setDisplayFilename] = useState<string>("Unknown");
  const [displaySize, setDisplaySize] = useState<string>("Unknown size");
  const [securityStatus, setSecurityStatus] = useState<'scanning' | 'safe' | 'unsafe' | 'no-key' | 'error'>('no-key');
  const [threatDetails, setThreatDetails] = useState<string>('');
  const [selectedFormatUrl, setSelectedFormatUrl] = useState<string>("");
  const [checksumDigest, setChecksumDigest] = useState<string>("");
  const [checksumAlgorithm, setChecksumAlgorithm] = useState<ChecksumAlgorithm>("sha256");
  const [checksumSource, setChecksumSource] = useState<string>("");
  const [prevStagedDownload, setPrevStagedDownload] = useState<unknown>(null);

  // Synchronous state updates during render to avoid cascading updates in effect
  if (stagedDownload !== prevStagedDownload) {
    setPrevStagedDownload(stagedDownload);
    if (stagedDownload) {
      setSaveDir(""); 
      if (stagedDownload.checksum && typeof stagedDownload.checksum === 'object') {
        const c = stagedDownload.checksum as DetectedChecksum;
        setChecksumDigest(c.digest || "");
        setChecksumAlgorithm(c.algorithm || "sha256");
        setChecksumSource(c.source || "");
      } else if (typeof stagedDownload.checksum === 'string') {
        setChecksumDigest(stagedDownload.checksum);
        setChecksumAlgorithm("sha256");
        setChecksumSource("");
      } else {
        setChecksumDigest("");
        setChecksumAlgorithm("sha256");
        setChecksumSource("");
      }
      
      const apiKey = useAppStore.getState().safeBrowsingApiKey;
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
      const apiKey = useAppStore.getState().safeBrowsingApiKey;
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
    const { getUniqueFilename } = useAppStore.getState();
    if (rawFilename) {
      getUniqueFilename(rawFilename, saveDir || undefined).then((uniqueName: string) => {
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

    if (checksumDigest) {
      const c: DetectedChecksum = {
        algorithm: checksumAlgorithm,
        digest: checksumDigest,
        source: (checksumSource || "manual") as "manual"
      };
      if (!validateChecksum(c)) {
        window.alert(`Invalid ${checksumAlgorithm.toUpperCase()} checksum\nPlease check the length and format of your hash.`);
        return;
      }
    }
    
    const finalChecksum = checksumDigest ? { algorithm: checksumAlgorithm, digest: checksumDigest, source: checksumSource || "manual" } as DetectedChecksum : undefined;

    if (selectedFormat) {
      const headers = stagedDownload.headers || [];
      await addDownload(urlToDownload, headers, finalDir, displayFilename, audioUrl, finalChecksum, stagedDownload.sourceUrl, stagedDownload.fileSize);
    } else {
      await addDownload(urlToDownload, stagedDownload.headers || [], finalDir, displayFilename, undefined, finalChecksum, stagedDownload.sourceUrl, stagedDownload.fileSize);
    }
    clearStagedDownload();
  };

  if (!stagedDownload) return null;

  return (
    <Dialog open={!!stagedDownload} onOpenChange={(open) => !open && clearStagedDownload()}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto bg-card border-border text-foreground">
        <DialogHeader>
          <DialogTitle>Confirm Download</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            A new download has been intercepted. Where would you like to save it?
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4 min-w-0">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-muted-foreground text-xs uppercase">URL</Label>
              <Badge variant="outline" className="text-[10px] py-0 h-4 font-normal text-muted-foreground">
                {stagedDownload.sourceUrl ? "Source Page" : "Direct Stream"}
              </Badge>
            </div>
            <div 
              className="text-xs font-mono break-all bg-background p-2 rounded border border-border max-h-24 overflow-y-auto select-all" 
              title={stagedDownload.sourceUrl || selectedFormatUrl || stagedDownload.url}
            >
              {(() => {
                const u = stagedDownload.sourceUrl || selectedFormatUrl || stagedDownload.url || "";
                return u.length > 80 ? u.substring(0, 50) + '...' + u.substring(u.length - 20) : u;
              })()}
            </div>
          </div>
          
          {stagedDownload.mediaFormats && stagedDownload.mediaFormats.length > 0 && (
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs uppercase">Quality / Resolution</Label>
              <div className="relative">
                <select 
                  value={selectedFormatUrl}
                  onChange={handleFormatChange}
                  style={{ colorScheme: 'dark' }}
                  className="w-full appearance-none bg-card border border-border text-foreground rounded-md px-3 py-2 pr-10 text-sm focus:ring-1 focus:ring-primary outline-none cursor-pointer"
                >
                  {stagedDownload.mediaFormats.map(format => (
                    <option key={format.format_id} value={format.url} className="bg-card text-foreground py-1">
                      {formatResolutionLabel(format)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
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
            <Label className="text-muted-foreground text-xs uppercase flex items-center">
              Checksum (Hash) <span className="text-muted-foreground/60 lowercase font-normal mx-1">(Optional)</span>
              {checksumSource && checksumSource !== "manual" && (
                <Badge variant="outline" className="ml-auto text-green-500 bg-green-500/10 text-[10px] py-0 h-4">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Auto-Detected
                </Badge>
              )}
            </Label>
            <div className="flex gap-2">
              <div className="relative shrink-0">
                <select 
                  value={checksumAlgorithm}
                  onChange={e => {
                     setChecksumAlgorithm(e.target.value as ChecksumAlgorithm);
                     setChecksumSource("manual");
                  }}
                  style={{ colorScheme: 'dark' }}
                  className="appearance-none bg-card border border-border text-foreground text-sm rounded-md pl-3 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
                >
                  <option value="md5" className="bg-card text-foreground">MD5</option>
                  <option value="sha1" className="bg-card text-foreground">SHA-1</option>
                  <option value="sha224" className="bg-card text-foreground">SHA-224</option>
                  <option value="sha256" className="bg-card text-foreground">SHA-256</option>
                  <option value="sha384" className="bg-card text-foreground">SHA-384</option>
                  <option value="sha512" className="bg-card text-foreground">SHA-512</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              <Input 
                value={checksumDigest} 
                onChange={(e) => {
                  setChecksumDigest(e.target.value);
                  setChecksumSource("manual");
                }}
                placeholder="e.g. abc123..." 
                className="bg-background border-border text-foreground font-mono text-sm flex-1"
              />
            </div>
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
