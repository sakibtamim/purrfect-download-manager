"use client";

import { useDownloadStore } from "@/store/downloadStore";
import { DownloadCard } from "@/components/download-card";
import { Cat } from "lucide-react";

export default function Home() {
  const activeDownloads = useDownloadStore(state => state.active);
  const isPlayfulMode = useDownloadStore(state => state.isPlayfulMode);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Active Downloads</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Currently downloading or waiting files.
        </p>
      </div>

      {activeDownloads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-border rounded-2xl bg-muted/30">
          <div className="p-4 bg-muted rounded-full mb-4">
            <Cat className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <h3 className="text-lg font-medium text-foreground">No active downloads</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
            {isPlayfulMode 
              ? "Your cat is resting. Add a URL to start the hunt!" 
              : "Click the 'New Download' button to add a file."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {activeDownloads.map(download => (
            <DownloadCard key={download.gid} download={download} />
          ))}
        </div>
      )}
    </div>
  );
}
