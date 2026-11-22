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
import { FolderOpen, CheckCircle2, ChevronDown, ChevronRight, ShieldCheck, ShieldAlert, Shield } from "lucide-react";
import { type ChecksumAlgorithm, type DetectedChecksum, validateChecksum, decodeFilename, parseContentDispositionFilename } from "@/lib/utils";
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

export function resolveInitialDownloadSelection(staged: {
  url: string;
  fileSize?: number;
  mediaFormats?: YtDlpFormat[];
}): { selectedUrl: string; displaySize: string } {
  const topFormat = staged.mediaFormats && staged.mediaFormats.length > 0 ? staged.mediaFormats[0] : null;
  const selectedUrl = topFormat ? topFormat.url : staged.url;
  let displaySize: string;
  if (topFormat && topFormat.fileSize > 0) {
    displaySize = `${(topFormat.fileSize / (1024 * 1024)).toFixed(2)} MB`;
  } else if (staged.fileSize && staged.fileSize > 0) {
    displaySize = `${(staged.fileSize / (1024 * 1024)).toFixed(2)} MB`;
  } else {
    displaySize = "Unknown size";
  }
  return { selectedUrl, displaySize };
}

export function ConfirmDownloadModal() {
  const stagedDownload = useAppStore((state) => state.stagedDownload);
  const clearStagedDownload = useAppStore((state) => state.clearStagedDownload);
  const addDownload = useAppStore((state) => state.addDownload);
  const [saveDir, setSaveDir] = useState<string>("");
  const [rawFilename, setRawFilename] = useState<string>("Unknown");
  const [displayFilename, setDisplayFilename] = useState<string>("Unknown");
  const [isUserEditedFilename, setIsUserEditedFilename] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
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
      setIsUserEditedFilename(false);
      const hasChecksum = Boolean(stagedDownload.checksum);
      setIsAdvancedOpen(hasChecksum);
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

      const { selectedUrl, displaySize: initialSize } = resolveInitialDownloadSelection(stagedDownload);
      setSelectedFormatUrl(selectedUrl);
      setDisplaySize(initialSize);

      let name = stagedDownload.filename || "";
      if (name) name = decodeFilename(name);
      else if (stagedDownload.url) {
        try {
          const raw = new URL(stagedDownload.url).pathname.split('/').pop() || "Unknown";
          name = decodeFilename(raw);
        } catch { name = "Unknown"; }
      }
      setRawFilename(name || "Unknown");
    }
  }

  useEffect(() => {
    if (stagedDownload) {
      if ((!stagedDownload.fileSize || stagedDownload.fileSize <= 0) && (!stagedDownload.mediaFormats || stagedDownload.mediaFormats.length === 0)) {
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
              const parsedName = parseContentDispositionFilename(dispHeader);
              if (parsedName) {
                setRawFilename(parsedName);
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
    if (rawFilename && !isUserEditedFilename) {
      getUniqueFilename(rawFilename, saveDir || undefined).then((uniqueName: string) => {
        if (active) setDisplayFilename(uniqueName);
      }).catch(() => {
        if (active) setDisplayFilename(rawFilename);
      });
    }
    return () => { active = false; };
  }, [rawFilename, saveDir, isUserEditedFilename]);

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
      await addDownload(urlToDownload, headers, finalDir, displayFilename, audioUrl, finalChecksum, stagedDownload.sourceUrl, selectedFormat.fileSize || stagedDownload.fileSize);
    } else {
      await addDownload(urlToDownload, stagedDownload.headers || [], finalDir, displayFilename, undefined, finalChecksum, stagedDownload.sourceUrl, stagedDownload.fileSize);
    }
    clearStagedDownload();
  };

  if (!stagedDownload) return null;

  return (
    <Dialog open={!!stagedDownload} onOpenChange={(open) => !open && clearStagedDownload()}>
      <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto bg-card border-border text-foreground p-5 gap-3.5">
        <DialogHeader className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="text-base font-semibold">Confirm Download</DialogTitle>
            {securityStatus === 'scanning' && (
              <Badge variant="outline" className="text-xs py-0.5 px-2 font-normal text-muted-foreground animate-pulse border-border">
                <Shield className="w-3 h-3 mr-1 text-primary animate-spin" /> Scanning...
              </Badge>
            )}
            {securityStatus === 'safe' && (
              <Badge variant="outline" className="text-xs py-0.5 px-2 font-normal text-emerald-500 bg-emerald-500/10 border-emerald-500/20">
                <ShieldCheck className="w-3 h-3 mr-1 text-emerald-500" /> Safe
              </Badge>
            )}
            {securityStatus === 'unsafe' && (
              <Badge variant="destructive" className="text-xs py-0.5 px-2 font-medium">
                <ShieldAlert className="w-3 h-3 mr-1" /> Threat Detected
              </Badge>
            )}
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Review filename and destination before starting.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 min-w-0">
          {/* File Name & Size */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="staged-filename" className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                File Name
              </Label>
              <Badge variant="secondary" className="text-xs py-0 px-2 font-medium">
                {displaySize}
              </Badge>
            </div>
            <Input 
              id="staged-filename"
              value={displayFilename}
              onChange={(e) => {
                setDisplayFilename(e.target.value);
                setIsUserEditedFilename(true);
              }}
              placeholder="Filename"
              className="bg-background border-border text-foreground text-sm font-medium h-9"
            />
          </div>

          {/* Quality / Resolution (for video/audio streams) */}
          {stagedDownload.mediaFormats && stagedDownload.mediaFormats.length > 0 && (
            <div className="space-y-1">
              <Label htmlFor="staged-quality" className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Quality / Resolution
              </Label>
              <div className="relative">
                <select 
                  id="staged-quality"
                  value={selectedFormatUrl}
                  onChange={handleFormatChange}
                  style={{ colorScheme: 'dark' }}
                  className="w-full appearance-none bg-background border border-border text-foreground rounded-md px-3 py-1.5 pr-8 text-sm focus:ring-1 focus:ring-primary outline-none cursor-pointer h-9"
                >
                  {stagedDownload.mediaFormats.map(format => (
                    <option key={format.format_id} value={format.url} className="bg-card text-foreground py-1">
                      {formatResolutionLabel(format)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          )}

          {/* Save Location */}
          <div className="space-y-1">
            <Label htmlFor="staged-savedir" className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Save Location
            </Label>
            <div className="flex gap-2">
              <Input 
                id="staged-savedir"
                value={saveDir} 
                onChange={(e) => setSaveDir(e.target.value)}
                placeholder="Default Downloads Folder" 
                className="bg-background border-border text-foreground text-sm h-9"
              />
              <Button variant="outline" size="sm" onClick={handleBrowse} className="shrink-0 h-9 px-3 text-xs">
                <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
                Browse
              </Button>
            </div>
          </div>

          {/* Security Alert if unsafe */}
          {securityStatus === 'unsafe' && (
            <div className="p-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Malicious URL Blocked</p>
                <p className="text-[11px] opacity-90 mt-0.5">This URL is flagged as dangerous ({threatDetails}). Downloading has been blocked to protect your system.</p>
              </div>
            </div>
          )}

          {/* Advanced Disclosure (Checksum & Source URL) */}
          <div className="border-t border-border/60 pt-2">
            <button
              type="button"
              onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left py-1"
              aria-expanded={isAdvancedOpen}
            >
              {isAdvancedOpen ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
              <span>Advanced Options (Checksum, Source URL)</span>
              {checksumDigest && (
                <Badge variant="outline" className="ml-auto text-[10px] py-0 h-4 text-emerald-500 bg-emerald-500/10 border-emerald-500/20 font-normal">
                  Checksum set
                </Badge>
              )}
            </button>

            {isAdvancedOpen && (
              <div className="space-y-3 pt-2.5 pl-5">
                {/* Source URL */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="staged-source-url" className="text-muted-foreground text-[11px] uppercase tracking-wide">
                      Source URL
                    </Label>
                    <Badge variant="outline" className="text-[10px] py-0 h-4 font-normal text-muted-foreground">
                      {stagedDownload.sourceUrl ? "Source Page" : "Direct Stream"}
                    </Badge>
                  </div>
                  <div 
                    id="staged-source-url"
                    className="text-xs font-mono break-all bg-background/80 p-2 rounded border border-border max-h-16 overflow-y-auto select-all text-muted-foreground" 
                    title={stagedDownload.sourceUrl || selectedFormatUrl || stagedDownload.url}
                  >
                    {stagedDownload.sourceUrl || selectedFormatUrl || stagedDownload.url}
                  </div>
                </div>

                {/* Checksum */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="staged-checksum" className="text-muted-foreground text-[11px] uppercase tracking-wide">
                      Checksum (Hash)
                    </Label>
                    {checksumSource && checksumSource !== "manual" && (
                      <Badge variant="outline" className="text-emerald-500 bg-emerald-500/10 border-emerald-500/20 text-[10px] py-0 h-4">
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Auto-Detected
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <div className="relative shrink-0">
                      <select 
                        value={checksumAlgorithm}
                        onChange={e => {
                          setChecksumAlgorithm(e.target.value as ChecksumAlgorithm);
                          setChecksumSource("manual");
                        }}
                        aria-label="Checksum algorithm"
                        style={{ colorScheme: 'dark' }}
                        className="appearance-none bg-background border border-border text-foreground text-xs rounded-md pl-2.5 pr-7 py-1.5 h-8 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                      >
                        <option value="md5">MD5</option>
                        <option value="sha1">SHA-1</option>
                        <option value="sha224">SHA-224</option>
                        <option value="sha256">SHA-256</option>
                        <option value="sha384">SHA-384</option>
                        <option value="sha512">SHA-512</option>
                      </select>
                      <ChevronDown className="w-3 h-3 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                    <Input 
                      id="staged-checksum"
                      value={checksumDigest} 
                      onChange={(e) => {
                        setChecksumDigest(e.target.value);
                        setChecksumSource("manual");
                      }}
                      placeholder="Expected hash digest..." 
                      className="bg-background border-border text-foreground font-mono text-xs flex-1 h-8"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between border-t border-border pt-3 mt-1">
          <Button variant="ghost" size="sm" onClick={clearStagedDownload} className="text-muted-foreground hover:text-foreground h-8 text-xs">
            Cancel
          </Button>
          <Button 
            size="sm"
            onClick={handleConfirm} 
            disabled={securityStatus === 'unsafe'}
            className={securityStatus === 'unsafe' 
              ? "bg-red-900/50 text-red-500 cursor-not-allowed h-8 text-xs" 
              : "h-8 text-xs font-medium"
            }
          >
            Start Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
