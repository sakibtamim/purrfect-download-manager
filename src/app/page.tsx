"use client";

import { useDownloadStore } from "@/store/downloadStore";
import { DownloadCard } from "@/components/download-card";
import { List } from "lucide-react";

export default function AllDownloads() {
  const activeDownloads = useDownloadStore(state => state.active);
  const completedDownloads = useDownloadStore(state => state.completed);
  const failedDownloads = useDownloadStore(state => state.failed);
  const isPlayfulMode = useDownloadStore(state => state.isPlayfulMode);

  const allDownloads = [...activeDownloads, ...completedDownloads, ...failedDownloads];

  // Sort them so active ones are usually at the top, or maybe just sort by something if we have a timestamp.
  // We can just keep active at the top, then completed, then failed.
  // Actually, Aria2 usually returns them in a decent order, but combining them like this naturally puts active first, which is good.

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">All Downloads</h1>
        <p className="text-sm text-muted-foreground mt-1">
          A complete view of your active, completed, and failed downloads.
        </p>
      </div>

      {allDownloads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-border rounded-2xl bg-muted/30">
          <div className="p-4 bg-muted rounded-full mb-4">
            <List className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <h3 className="text-lg font-medium text-foreground">No downloads found</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
            {isPlayfulMode 
              ? "The hunting ground is empty! Give your cat a target." 
              : "You haven't started any downloads yet."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {allDownloads.map(download => (
            <DownloadCard key={download.gid} download={download} />
          ))}
        </div>
      )}
    </div>
  );
}
