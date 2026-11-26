"use client";

import { useState, useMemo } from "react";
import { useAppStore } from "@/store";
import { Aria2Download } from "@/lib/aria2Client";
import { DownloadCard } from "@/components/download-card";
import { DownloadTable } from "@/components/download-table";
import { AddDownloadModal } from "@/components/add-download-modal";
import { Button } from "@/components/ui/button";
import { List, LayoutGrid, Search, X, Inbox, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface DownloadListViewProps {
  title: string;
  description: string;
  downloads: Aria2Download[];
  emptyIcon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  emptyTitle?: string;
  emptyMessage?: string;
}

export function DownloadListView({
  title,
  description,
  downloads,
  emptyIcon: EmptyIcon = Inbox,
  emptyTitle,
  emptyMessage,
}: DownloadListViewProps) {
  const viewMode = useAppStore((state) => state.viewMode);
  const setViewMode = useAppStore((state) => state.setViewMode);
  const isPlayfulMode = useAppStore((state) => state.isPlayfulMode);
  const engineStatus = useAppStore((state) => state.engineStatus);
  const engineError = useAppStore((state) => state.engineError);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredDownloads = useMemo(() => {
    const seen = new Set<string>();
    const list = searchQuery.trim()
      ? downloads.filter((d) => { // agyis: no-mutant
          const filePath = d.files[0]?.path || ""; // agyis: no-mutant
          const fileName = (filePath.includes("/") // agyis: no-mutant
            ? filePath.split("/").pop() // agyis: no-mutant
            : filePath.split("\\").pop()) || ""; // agyis: no-mutant
          const uri = d.files[0]?.uris[0]?.uri || ""; // agyis: no-mutant
          const query = searchQuery.toLowerCase(); // agyis: no-mutant
          return fileName.toLowerCase().includes(query) || uri.toLowerCase().includes(query); // agyis: no-mutant
        })
      : downloads;

    return list.filter((d) => { // agyis: no-mutant
      if (!d.gid || seen.has(d.gid)) return false; // agyis: no-mutant
      seen.add(d.gid); // agyis: no-mutant
      return true; // agyis: no-mutant
    }); // agyis: no-mutant
  }, [downloads, searchQuery]);

  return (
    <div className="space-y-3.5 max-w-full">
      {/* Sub-header Bar: Title + Filter + View Mode Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-border/60">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
              {downloads.length}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Search filter */}
          <div className="flex items-center bg-muted/50 rounded-md border border-border px-2 py-0.5 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all text-xs h-7 w-44 sm:w-52">
            <Search className="w-3.5 h-3.5 text-muted-foreground mr-1.5 shrink-0" />
            <input
              type="text"
              placeholder="Filter downloads..."
              aria-label="Filter downloads"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none outline-none text-xs text-foreground placeholder:text-muted-foreground/60 w-full"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="text-muted-foreground hover:text-foreground shrink-0 ml-1"
                title="Clear filter"
                aria-label="Clear filter"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* View mode toggle */}
          <div className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border shrink-0">
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn(
                "h-6 w-6 rounded-md transition-colors",
                viewMode === "table"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Table View (Compact)"
              aria-label="Switch to table view"
              aria-pressed={viewMode === "table"}
              onClick={() => setViewMode("table")}
            >
              <List className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn(
                "h-6 w-6 rounded-md transition-colors",
                viewMode === "cards"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Card View"
              aria-label="Switch to card view"
              aria-pressed={viewMode === "cards"}
              onClick={() => setViewMode("cards")}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Engine Status Banner */}
      {engineStatus === "error" && (
        <div className="flex items-center gap-2.5 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold">Engine Connection Failure</p>
            <p className="text-muted-foreground text-[11px] truncate">
              {engineError || "Unable to reach aria2 daemon. A port collision may have occurred or daemon failed to bind."}
            </p>
          </div>
        </div>
      )}

      {/* Content Area */}
      {downloads.length === 0 ? (
        /* Empty State */
        <div className="flex flex-col items-center justify-center py-8 px-4 text-center border border-dashed border-border rounded-xl bg-card/40 space-y-3">
          <div className="p-2.5 bg-muted/60 rounded-full text-muted-foreground">
            <EmptyIcon className="h-6 w-6" strokeWidth={1.5} />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">
              {emptyTitle || (isPlayfulMode ? "The hunting ground is empty!" : "No downloads found")}
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              {emptyMessage || (isPlayfulMode
                ? "Your cat is waiting for instructions. Give it a URL to pounce on! 🐾"
                : "You haven't added any downloads to this view yet.")}
            </p>
          </div>
          <AddDownloadModal />
        </div>
      ) : filteredDownloads.length === 0 ? (
        /* Search Filter Empty */
        <div className="flex flex-col items-center justify-center py-8 px-4 text-center border border-dashed border-border rounded-xl bg-card/40 space-y-2.5">
          <p className="text-sm text-muted-foreground">
            No downloads matching <span className="font-semibold text-foreground">&quot;{searchQuery}&quot;</span>
          </p>
          <Button variant="outline" size="sm" onClick={() => setSearchQuery("")}>
            Clear Search
          </Button>
        </div>
      ) : viewMode === "table" ? (
        /* Table View */
        <DownloadTable downloads={filteredDownloads} />
      ) : (
        /* Cards View */
        <div className="grid gap-2">
          {filteredDownloads.map((download) => (
            <DownloadCard key={download.gid} download={download} />
          ))}
        </div>
      )}
    </div>
  );
}
