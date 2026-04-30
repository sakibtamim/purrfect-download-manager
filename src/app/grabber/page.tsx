"use client";

import { useState } from "react";
import { useDownloadStore } from "@/store/downloadStore";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { ytdlpClient, YtDlpVideoInfo } from "@/lib/ytdlpClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, Globe, PlayCircle, Image as ImageIcon, Link as LinkIcon, FileVideo, Activity } from "lucide-react";

type GrabbedLink = {
  url: string;
  type: 'image' | 'video' | 'link';
  text: string;
  selected: boolean;
};

export default function GrabberPage() {
  const [activeTab, setActiveTab] = useState<'media' | 'site'>('media');
  const { addDownload, stageDownload } = useDownloadStore();

  // Media Downloader State
  const [mediaUrl, setMediaUrl] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [mediaInfo, setMediaInfo] = useState<YtDlpVideoInfo | null>(null);
  const [mediaError, setMediaError] = useState("");

  // Site Grabber State
  const [siteUrl, setSiteUrl] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [grabbedLinks, setGrabbedLinks] = useState<GrabbedLink[]>([]);
  const [siteError, setSiteError] = useState("");

  // --- MEDIA DOWNLOADER HANDLERS ---
  const handleExtractMedia = async () => {
    if (!mediaUrl) return;
    setIsExtracting(true);
    setMediaError("");
    setMediaInfo(null);

    try {
      const info = await ytdlpClient.extractVideoInfo(mediaUrl);
      setMediaInfo(info);
    } catch (e: any) {
      setMediaError(e.message || "Failed to extract media. Make sure yt-dlp sidecar is installed.");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleDownloadMedia = () => {
    if (mediaInfo) {
      const sanitizedTitle = mediaInfo.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
      const filename = `${sanitizedTitle}.${mediaInfo.ext}`;
      
      stageDownload({
        url: mediaInfo.url,
        headers: [],
        filename: filename,
        fileSize: mediaInfo.fileSize,
        mediaFormats: mediaInfo.formats
      });
      
      setMediaInfo(null);
      setMediaUrl("");
    }
  };

  // --- SITE GRABBER HANDLERS ---
  const handleScanSite = async () => {
    if (!siteUrl) return;
    setIsScanning(true);
    setSiteError("");
    setGrabbedLinks([]);

    try {
      const res = await tauriFetch(siteUrl, { method: "GET" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const baseUrl = new URL(siteUrl).origin;

      const linksMap = new Map<string, GrabbedLink>();

      // Extract Images
      doc.querySelectorAll("img").forEach(img => {
        if (img.src) {
          try {
            const url = new URL(img.src, baseUrl).href;
            linksMap.set(url, { url, type: 'image', text: img.alt || "Image", selected: true });
          } catch (e) {}
        }
      });

      // Extract Videos
      doc.querySelectorAll("video, source").forEach(vid => {
        const src = (vid as any).src;
        if (src) {
          try {
            const url = new URL(src, baseUrl).href;
            linksMap.set(url, { url, type: 'video', text: "Video Source", selected: true });
          } catch (e) {}
        }
      });

      // Extract Links
      doc.querySelectorAll("a").forEach(a => {
        if (a.href && !a.href.startsWith("javascript:") && !a.href.startsWith("mailto:")) {
          try {
            const url = new URL(a.href, baseUrl).href;
            // Ignore anchors and pure page navigation if possible, but keep it simple
            if (!url.includes('#')) {
              linksMap.set(url, { url, type: 'link', text: a.textContent?.trim() || "Link", selected: false });
            }
          } catch (e) {}
        }
      });

      setGrabbedLinks(Array.from(linksMap.values()));
    } catch (e: any) {
      setSiteError(e.message || "Failed to scan site. Check the URL.");
    } finally {
      setIsScanning(false);
    }
  };

  const toggleLinkSelection = (index: number) => {
    const newLinks = [...grabbedLinks];
    newLinks[index].selected = !newLinks[index].selected;
    setGrabbedLinks(newLinks);
  };

  const selectAll = (type: 'all' | 'image' | 'video') => {
    setGrabbedLinks(links => links.map(l => ({
      ...l,
      selected: type === 'all' ? true : l.type === type
    })));
  };

  const deselectAll = () => {
    setGrabbedLinks(links => links.map(l => ({ ...l, selected: false })));
  };

  const handleDownloadSelected = () => {
    const selected = grabbedLinks.filter(l => l.selected);
    selected.forEach(link => {
      addDownload(link.url, [], undefined);
    });
    // Remove downloaded from list
    setGrabbedLinks(links => links.filter(l => !l.selected));
  };

  return (
    <div className="flex-1 p-8 pt-6 min-h-screen">
      <div className="flex items-center justify-between space-y-2 mb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-zinc-100 flex items-center gap-3">
            <Globe className="w-8 h-8 text-indigo-500" />
            Web Tools
          </h2>
          <p className="text-zinc-400 mt-1">Batch download from websites or extract media from streaming platforms.</p>
        </div>
      </div>

      {/* TABS */}
      <div className="flex space-x-1 bg-zinc-900/50 p-1 rounded-lg w-fit mb-6 border border-zinc-800">
        <button
          onClick={() => setActiveTab('media')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'media' ? 'bg-zinc-800 text-zinc-100 shadow' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <PlayCircle className="w-4 h-4" /> Media Downloader
        </button>
        <button
          onClick={() => setActiveTab('site')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'site' ? 'bg-zinc-800 text-zinc-100 shadow' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Globe className="w-4 h-4" /> Site Grabber
        </button>
      </div>

      {/* MEDIA DOWNLOADER TAB */}
      {activeTab === 'media' && (
        <div className="space-y-6 max-w-3xl">
          <Card className="bg-zinc-900/40 border-zinc-800 p-6">
            <h3 className="text-lg font-medium text-zinc-100 mb-2">Native Media Downloader</h3>
            <p className="text-sm text-zinc-400 mb-6">
              Paste a URL from YouTube, Twitter, TikTok, or other supported platforms. 
              Powered securely by yt-dlp to bypass bot detection.
            </p>
            
            <div className="flex gap-3">
              <Input
                placeholder="https://www.youtube.com/watch?v=..."
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                className="bg-zinc-950 border-zinc-800 text-zinc-100 h-12"
              />
              <Button 
                onClick={handleExtractMedia} 
                disabled={isExtracting || !mediaUrl}
                className="h-12 px-6 bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {isExtracting ? <Activity className="w-4 h-4 animate-spin mr-2" /> : <SearchIcon className="w-4 h-4 mr-2" />}
                Extract
              </Button>
            </div>
            
            {mediaError && (
              <p className="text-red-400 mt-4 text-sm bg-red-950/30 p-3 rounded border border-red-900">
                {mediaError}
              </p>
            )}
          </Card>

          {mediaInfo && (
            <Card className="bg-zinc-900/60 border-indigo-900/50 p-6 overflow-hidden relative">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500"></div>
              <div className="flex gap-6">
                {mediaInfo.thumbnail ? (
                  <img src={mediaInfo.thumbnail} alt="Thumbnail" className="w-48 h-32 object-cover rounded-md border border-zinc-800 shadow-xl" />
                ) : (
                  <div className="w-48 h-32 bg-zinc-800 rounded-md flex items-center justify-center">
                    <FileVideo className="w-8 h-8 text-zinc-600" />
                  </div>
                )}
                
                <div className="flex flex-col flex-1 py-1">
                  <h4 className="text-lg font-semibold text-zinc-100 line-clamp-2 leading-tight mb-2">
                    {mediaInfo.title}
                  </h4>
                  <div className="flex items-center gap-3 mb-auto">
                    {mediaInfo.fileSize > 0 && (
                      <Badge variant="outline" className="text-indigo-400 border-indigo-900/50">
                        {(mediaInfo.fileSize / (1024 * 1024)).toFixed(1)} MB
                      </Badge>
                    )}
                    {mediaInfo.duration > 0 && (
                      <Badge variant="outline" className="text-zinc-400 border-zinc-800">
                        {Math.floor(mediaInfo.duration / 60)}:{String(mediaInfo.duration % 60).padStart(2, '0')}
                      </Badge>
                    )}
                  </div>
                  
                  <div className="mt-4 flex items-center gap-3">
                    <Button onClick={handleDownloadMedia} className="bg-indigo-600 hover:bg-indigo-500 text-white w-full">
                      <Download className="w-4 h-4 mr-2" />
                      Add to Download Queue
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* SITE GRABBER TAB */}
      {activeTab === 'site' && (
        <div className="space-y-6">
          <Card className="bg-zinc-900/40 border-zinc-800 p-6 flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium text-zinc-300">Target Website URL</label>
              <Input
                placeholder="https://example.com/gallery"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                className="bg-zinc-950 border-zinc-800 text-zinc-100 h-10"
              />
            </div>
            <Button 
              onClick={handleScanSite} 
              disabled={isScanning || !siteUrl}
              className="bg-indigo-600 hover:bg-indigo-700 text-white h-10 px-8 shrink-0"
            >
              {isScanning ? <Activity className="w-4 h-4 animate-spin mr-2" /> : <SearchIcon className="w-4 h-4 mr-2" />}
              Scan Page
            </Button>
          </Card>

          {siteError && (
            <p className="text-red-400 mt-4 text-sm bg-red-950/30 p-3 rounded border border-red-900">
              {siteError}
            </p>
          )}

          {grabbedLinks.length > 0 && (
            <Card className="bg-zinc-900/40 border-zinc-800 flex flex-col h-[600px] overflow-hidden">
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/80">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="bg-zinc-800 text-zinc-300 hover:bg-zinc-700">
                    {grabbedLinks.length} Files Found
                  </Badge>
                  <Badge variant="outline" className="border-indigo-900/50 text-indigo-400">
                    {grabbedLinks.filter(l => l.selected).length} Selected
                  </Badge>
                </div>
                
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => selectAll('image')} className="h-8 border-zinc-700 text-zinc-300">
                    All Images
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => selectAll('video')} className="h-8 border-zinc-700 text-zinc-300">
                    All Videos
                  </Button>
                  <Button variant="outline" size="sm" onClick={deselectAll} className="h-8 border-zinc-700 text-zinc-300">
                    Clear
                  </Button>
                  <div className="w-px h-6 bg-zinc-800 mx-2"></div>
                  <Button 
                    size="sm" 
                    onClick={handleDownloadSelected} 
                    disabled={grabbedLinks.filter(l => l.selected).length === 0}
                    className="h-8 bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Selected
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-0">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-zinc-500 uppercase bg-zinc-900/90 sticky top-0 border-b border-zinc-800">
                    <tr>
                      <th className="px-4 py-3 w-12">
                        <input 
                          type="checkbox" 
                          className="rounded border-zinc-700 bg-zinc-900 text-indigo-600"
                          checked={grabbedLinks.length > 0 && grabbedLinks.every(l => l.selected)}
                          onChange={() => {
                            const allSelected = grabbedLinks.every(l => l.selected);
                            setGrabbedLinks(links => links.map(l => ({ ...l, selected: !allSelected })));
                          }}
                        />
                      </th>
                      <th className="px-4 py-3 w-24">Type</th>
                      <th className="px-4 py-3">File / Text</th>
                      <th className="px-4 py-3">URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grabbedLinks.map((link, idx) => (
                      <tr 
                        key={idx} 
                        className={`border-b border-zinc-800/50 transition-colors ${link.selected ? 'bg-indigo-900/10' : 'hover:bg-zinc-800/50'}`}
                        onClick={() => toggleLinkSelection(idx)}
                      >
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <input 
                            type="checkbox" 
                            className="rounded border-zinc-700 bg-zinc-900 text-indigo-600 focus:ring-offset-zinc-900"
                            checked={link.selected}
                            onChange={() => toggleLinkSelection(idx)}
                          />
                        </td>
                        <td className="px-4 py-3">
                          {link.type === 'image' && <Badge variant="outline" className="text-amber-400 border-amber-900/50 bg-amber-950/20"><ImageIcon className="w-3 h-3 mr-1"/> IMG</Badge>}
                          {link.type === 'video' && <Badge variant="outline" className="text-fuchsia-400 border-fuchsia-900/50 bg-fuchsia-950/20"><FileVideo className="w-3 h-3 mr-1"/> VID</Badge>}
                          {link.type === 'link' && <Badge variant="outline" className="text-sky-400 border-sky-900/50 bg-sky-950/20"><LinkIcon className="w-3 h-3 mr-1"/> LNK</Badge>}
                        </td>
                        <td className="px-4 py-3 text-zinc-300 truncate max-w-[200px]" title={link.text}>
                          {link.text || 'N/A'}
                        </td>
                        <td className="px-4 py-3 text-zinc-500 font-mono text-xs truncate max-w-[400px]" title={link.url}>
                          {link.url}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// Quick inline icon so I don't have to import it at the top
function SearchIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
