"use client";
/* eslint-disable @next/next/no-img-element */

import { useState, useMemo } from "react";
import { useDownloadStore } from "@/store/downloadStore";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { ytdlpClient, YtDlpVideoInfo, YtDlpFormat } from "@/lib/ytdlpClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  Globe,
  Film,
  Image as ImageIcon,
  Link as LinkIcon,
  FileVideo,
  Activity,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

type GrabbedLink = {
  url: string;
  type: "image" | "video" | "link";
  text: string;
  selected: boolean;
};

export default function GrabberPage() {
  const [activeTab, setActiveTab] = useState<"media" | "site">("media");
  const { addDownload, stageDownload } = useDownloadStore();

  // Media Downloader State
  const [mediaUrl, setMediaUrl] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [mediaInfo, setMediaInfo] = useState<YtDlpVideoInfo | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<YtDlpFormat | null>(null);
  const [mediaError, setMediaError] = useState("");

  // Site Grabber State
  const [siteUrl, setSiteUrl] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [grabbedLinks, setGrabbedLinks] = useState<GrabbedLink[]>([]);
  const [siteError, setSiteError] = useState("");

  // --- MEDIA DOWNLOADER HANDLERS ---
  const handleExtractMedia = async () => {
    if (!mediaUrl.trim()) return;
    setIsExtracting(true);
    setMediaError("");
    setMediaInfo(null);
    setSelectedFormat(null);

    try {
      const info = await ytdlpClient.extractVideoInfo(mediaUrl.trim());
      setMediaInfo(info);
      if (info.formats && info.formats.length > 0) {
        // Default to best format
        setSelectedFormat(info.formats[0]);
      }
    } catch (e: unknown) {
      setMediaError(
        e instanceof Error
          ? e.message
          : "Failed to extract media. Make sure yt-dlp sidecar is installed."
      );
    } finally {
      setIsExtracting(false);
    }
  };

  const handleDownloadMedia = () => {
    if (!mediaInfo) return;
    const sanitizedTitle = mediaInfo.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    const targetFormat = selectedFormat || (mediaInfo.formats && mediaInfo.formats[0]);
    const targetUrl = targetFormat?.url || mediaInfo.url;
    const targetExt = targetFormat?.ext || mediaInfo.ext || "mp4";
    const filename = `${sanitizedTitle}.${targetExt}`;

    stageDownload({
      url: targetUrl,
      sourceUrl: mediaUrl.trim(),
      headers: [],
      filename: filename,
      fileSize: targetFormat?.fileSize || mediaInfo.fileSize,
      mediaFormats: mediaInfo.formats,
    });

    setMediaInfo(null);
    setSelectedFormat(null);
    setMediaUrl("");
  };

  // Distinct resolution options derived from formats
  const resolutionChips = useMemo(() => {
    if (!mediaInfo?.formats) return [];
    const seen = new Set<string>();
    const chips: YtDlpFormat[] = [];

    // Sort formats from highest resolution to lowest
    const sorted = [...mediaInfo.formats].sort((a, b) => {
      const hA = a.height || parseInt(a.resolution) || 0;
      const hB = b.height || parseInt(b.resolution) || 0;
      return hB - hA;
    });

    for (const f of sorted) {
      const label = f.height ? `${f.height}p` : f.resolution || f.ext;
      if (!seen.has(label)) {
        seen.add(label);
        chips.push(f);
      }
    }
    return chips.slice(0, 8); // Top 8 distinct resolutions
  }, [mediaInfo]);

  // --- SITE GRABBER HANDLERS ---
  const handleScanSite = async () => {
    if (!siteUrl.trim()) return;
    setIsScanning(true);
    setSiteError("");
    setGrabbedLinks([]);

    try {
      const res = await tauriFetch(siteUrl.trim(), { method: "GET" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const baseUrl = new URL(siteUrl.trim()).origin;

      const linksMap = new Map<string, GrabbedLink>();

      // Extract Images
      doc.querySelectorAll("img").forEach((img) => {
        if (img.src) {
          try {
            const url = new URL(img.src, baseUrl).href;
            linksMap.set(url, {
              url,
              type: "image",
              text: img.alt || "Image",
              selected: true,
            });
          } catch {
            /* ignore */
          }
        }
      });

      // Extract Videos
      doc.querySelectorAll("video, source").forEach((vid) => {
        const src = (vid as HTMLVideoElement | HTMLSourceElement).src;
        if (src) {
          try {
            const url = new URL(src, baseUrl).href;
            linksMap.set(url, {
              url,
              type: "video",
              text: "Video Source",
              selected: true,
            });
          } catch {
            /* ignore */
          }
        }
      });

      // Extract Links
      doc.querySelectorAll("a").forEach((a) => {
        if (a.href && !a.href.startsWith("javascript:") && !a.href.startsWith("mailto:")) {
          try {
            const url = new URL(a.href, baseUrl).href;
            if (!url.includes("#")) {
              linksMap.set(url, {
                url,
                type: "link",
                text: a.textContent?.trim() || "Link",
                selected: false,
              });
            }
          } catch {
            /* ignore */
          }
        }
      });

      setGrabbedLinks(Array.from(linksMap.values()));
    } catch (e: unknown) {
      setSiteError(e instanceof Error ? e.message : "Failed to scan site. Check the URL.");
    } finally {
      setIsScanning(false);
    }
  };

  const toggleLinkSelection = (index: number) => {
    const newLinks = [...grabbedLinks];
    newLinks[index].selected = !newLinks[index].selected;
    setGrabbedLinks(newLinks);
  };

  const selectAll = (type: "all" | "image" | "video") => {
    setGrabbedLinks((links) =>
      links.map((l) => ({
        ...l,
        selected: type === "all" ? true : l.type === type,
      }))
    );
  };

  const deselectAll = () => {
    setGrabbedLinks((links) => links.map((l) => ({ ...l, selected: false })));
  };

  const handleDownloadSelected = () => {
    const selected = grabbedLinks.filter((l) => l.selected);
    selected.forEach((link) => {
      addDownload(link.url, [], undefined);
    });
    setGrabbedLinks((links) => links.filter((l) => !l.selected));
  };

  const selectedCount = grabbedLinks.filter((l) => l.selected).length;

  return (
    <div className="space-y-4 max-w-full">
      {/* Page Header + Segmented Pill Control */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/60">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Globe className="w-5 h-5 text-primary shrink-0" />
            Web Tools
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Extract streaming video, audio, and scrape website media.
          </p>
        </div>

        {/* Compact Segmented Pill Control */}
        <div role="tablist" aria-label="Web Tools Navigation" className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border h-8 shrink-0">
          <button
            type="button"
            role="tab"
            id="tab-media"
            aria-selected={activeTab === "media"}
            aria-controls="panel-media"
            onClick={() => setActiveTab("media")}
            className={cn(
              "flex items-center gap-1.5 px-3 h-7 rounded-md text-xs font-medium transition-colors",
              activeTab === "media"
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Film className="w-3.5 h-3.5" /> Media Downloader
          </button>
          <button
            type="button"
            role="tab"
            id="tab-site"
            aria-selected={activeTab === "site"}
            aria-controls="panel-site"
            onClick={() => setActiveTab("site")}
            className={cn(
              "flex items-center gap-1.5 px-3 h-7 rounded-md text-xs font-medium transition-colors",
              activeTab === "site"
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Globe className="w-3.5 h-3.5" /> Site Grabber
          </button>
        </div>
      </div>

      {/* MEDIA DOWNLOADER TAB */}
      {activeTab === "media" && (
        <div role="tabpanel" id="panel-media" aria-labelledby="tab-media" className="space-y-4 max-w-4xl">
          {/* Unified Inline Input Group */}
          <div className="bg-card/70 border border-border rounded-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 flex items-center bg-background rounded-lg border border-border px-3 h-9 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all text-xs">
                <LinkIcon className="w-3.5 h-3.5 text-muted-foreground mr-2 shrink-0" />
                <input
                  type="url"
                  placeholder="Paste YouTube, Twitter, TikTok, or streaming URL..."
                  aria-label="Target streaming video URL"
                  value={mediaUrl}
                  onChange={(e) => setMediaUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleExtractMedia();
                  }}
                  className="bg-transparent border-none outline-none text-xs text-foreground placeholder:text-muted-foreground/60 w-full"
                />
              </div>
              <Button
                onClick={handleExtractMedia}
                disabled={isExtracting || !mediaUrl.trim()}
                size="sm"
                className="h-9 px-4 gap-1.5 text-xs shrink-0 shadow-xs"
              >
                {isExtracting ? (
                  <Activity className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                Extract Media
              </Button>
            </div>

            {mediaError && (
              <p className="text-xs text-red-500 bg-red-500/10 p-2.5 rounded-lg border border-red-500/20">
                {mediaError}
              </p>
            )}
          </div>

          {/* Compact Video Preview Card */}
          {mediaInfo && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-3.5 animate-in fade-in duration-200">
              <div className="flex flex-col sm:flex-row gap-4">
                {mediaInfo.thumbnail ? (
                  <img
                    src={mediaInfo.thumbnail}
                    alt={mediaInfo.title}
                    className="w-full sm:w-44 h-28 object-cover rounded-lg border border-border shadow-xs shrink-0"
                  />
                ) : (
                  <div className="w-full sm:w-44 h-28 bg-muted rounded-lg flex items-center justify-center shrink-0">
                    <FileVideo className="w-8 h-8 text-muted-foreground" />
                  </div>
                )}

                <div className="flex-1 min-w-0 flex flex-col justify-between space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground line-clamp-2 leading-snug" title={mediaInfo.title}>
                      {mediaInfo.title}
                    </h3>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                      {mediaInfo.duration > 0 && (
                        <span>
                          {Math.floor(mediaInfo.duration / 60)}:
                          {String(mediaInfo.duration % 60).padStart(2, "0")}
                        </span>
                      )}
                      {mediaInfo.fileSize > 0 && (
                        <>
                          <span>•</span>
                          <span>{(mediaInfo.fileSize / (1024 * 1024)).toFixed(1)} MB</span>
                        </>
                      )}
                      <span>•</span>
                      <span className="uppercase text-[11px] font-mono">{mediaInfo.ext}</span>
                    </div>
                  </div>

                  {/* Resolution Chips */}
                  {resolutionChips.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Available Streams
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {resolutionChips.map((format) => {
                          const isSelected = selectedFormat?.format_id === format.format_id;
                          const label = format.height ? `${format.height}p` : format.resolution || format.ext;
                          return (
                            <button
                              key={format.format_id}
                              type="button"
                              onClick={() => setSelectedFormat(format)}
                              aria-pressed={isSelected}
                              aria-label={`Select stream ${label}`}
                              className={cn(
                                "px-2 py-0.5 rounded-md text-[11px] font-mono transition-colors border",
                                isSelected
                                  ? "bg-primary text-primary-foreground border-primary shadow-xs font-semibold"
                                  : "bg-muted/40 text-muted-foreground border-border hover:text-foreground hover:bg-muted"
                              )}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="pt-1">
                    <Button onClick={handleDownloadMedia} size="sm" className="h-8 gap-1.5 text-xs shadow-xs">
                      <Download className="w-3.5 h-3.5" />
                      Add to Download Queue
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SITE GRABBER TAB */}
      {activeTab === "site" && (
        <div role="tabpanel" id="panel-site" aria-labelledby="tab-site" className="space-y-4">
          {/* Unified Inline Input Group */}
          <div className="bg-card/70 border border-border rounded-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 flex items-center bg-background rounded-lg border border-border px-3 h-9 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all text-xs">
                <Globe className="w-3.5 h-3.5 text-muted-foreground mr-2 shrink-0" />
                <input
                  type="url"
                  placeholder="https://example.com/gallery or any webpage URL..."
                  aria-label="Target website URL to scrape"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleScanSite();
                  }}
                  className="bg-transparent border-none outline-none text-xs text-foreground placeholder:text-muted-foreground/60 w-full"
                />
              </div>
              <Button
                onClick={handleScanSite}
                disabled={isScanning || !siteUrl.trim()}
                size="sm"
                className="h-9 px-4 gap-1.5 text-xs shrink-0 shadow-xs"
              >
                {isScanning ? (
                  <Activity className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                Scan Page
              </Button>
            </div>

            {siteError && (
              <p className="text-xs text-red-500 bg-red-500/10 p-2.5 rounded-lg border border-red-500/20">
                {siteError}
              </p>
            )}
          </div>

          {/* High-Density Scraped Links Table */}
          {grabbedLinks.length > 0 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-xs">
              {/* Batch Controls Toolbar */}
              <div className="p-3 border-b border-border flex flex-wrap items-center justify-between gap-2 bg-muted/30">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs font-medium">
                    {grabbedLinks.length} Files Found
                  </Badge>
                  <Badge variant="outline" className="text-xs border-primary/30 text-primary">
                    {selectedCount} Selected
                  </Badge>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" size="xs" onClick={() => selectAll("image")} className="h-7 text-xs">
                    All Images
                  </Button>
                  <Button variant="ghost" size="xs" onClick={() => selectAll("video")} className="h-7 text-xs">
                    All Videos
                  </Button>
                  <Button variant="ghost" size="xs" onClick={() => selectAll("all")} className="h-7 text-xs">
                    Select All
                  </Button>
                  <Button variant="ghost" size="xs" onClick={deselectAll} className="h-7 text-xs text-muted-foreground">
                    Clear
                  </Button>
                  <div className="w-px h-4 bg-border mx-1" />
                  <Button
                    size="sm"
                    onClick={handleDownloadSelected}
                    disabled={selectedCount === 0}
                    className="h-7 gap-1.5 text-xs shadow-xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Selected ({selectedCount})
                  </Button>
                </div>
              </div>

              {/* Table */}
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-xs text-left">
                  <thead className="text-[11px] font-medium text-muted-foreground uppercase bg-muted/60 sticky top-0 border-b border-border select-none">
                    <tr>
                      <th className="px-3 py-2 w-10">
                        <input
                          type="checkbox"
                          aria-label="Select all links"
                          className="rounded border-border bg-background text-primary focus:ring-primary"
                          checked={grabbedLinks.length > 0 && grabbedLinks.every((l) => l.selected)}
                          onChange={() => {
                            const allSelected = grabbedLinks.every((l) => l.selected);
                            setGrabbedLinks((links) =>
                              links.map((l) => ({ ...l, selected: !allSelected }))
                            );
                          }}
                        />
                      </th>
                      <th className="px-3 py-2 w-20">Type</th>
                      <th className="px-3 py-2">File / Text</th>
                      <th className="px-3 py-2">URL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {grabbedLinks.map((link, idx) => (
                      <tr
                        key={idx}
                        className={cn(
                          "h-9 transition-colors cursor-pointer",
                          link.selected ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-muted/40"
                        )}
                        onClick={() => toggleLinkSelection(idx)}
                      >
                        <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select link ${link.text || link.url}`}
                            className="rounded border-border bg-background text-primary focus:ring-primary"
                            checked={link.selected}
                            onChange={() => toggleLinkSelection(idx)}
                          />
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {link.type === "image" && (
                            <Badge variant="outline" className="text-[10px] py-0 border-amber-500/30 text-amber-600 dark:text-amber-400">
                              <ImageIcon className="w-3 h-3 mr-1" /> IMG
                            </Badge>
                          )}
                          {link.type === "video" && (
                            <Badge variant="outline" className="text-[10px] py-0 border-blue-500/30 text-blue-600 dark:text-blue-400">
                              <FileVideo className="w-3 h-3 mr-1" /> VID
                            </Badge>
                          )}
                          {link.type === "link" && (
                            <Badge variant="outline" className="text-[10px] py-0 border-slate-500/30 text-slate-600 dark:text-slate-400">
                              <LinkIcon className="w-3 h-3 mr-1" /> LNK
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-foreground truncate max-w-[200px]" title={link.text}>
                          {link.text || "N/A"}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground font-mono text-[11px] truncate max-w-[320px]" title={link.url}>
                          {link.url}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
