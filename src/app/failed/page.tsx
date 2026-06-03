"use client";

import { useDownloadStore } from "@/store/downloadStore";
import { DownloadCard } from "@/components/download-card";
import { AlertCircle } from "lucide-react";

export default function Failed() {
  const failedDownloads = useDownloadStore(state => state.failed);
  const isPlayfulMode = useDownloadStore(state => state.isPlayfulMode);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Failed Downloads</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Files that failed to download or were cancelled.
        </p>
      </div>

      {failedDownloads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-border rounded-2xl bg-muted/30">
          <div className="p-4 bg-muted rounded-full mb-4">
            <AlertCircle className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <h3 className="text-lg font-medium text-foreground">No failed downloads</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
            {isPlayfulMode 
              ? "All mice caught successfully! No escapes." 
              : "No failed or cancelled downloads found."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {failedDownloads.map(download => (
            <DownloadCard key={download.gid} download={download} />
          ))}
        </div>
      )}
    </div>
  );
}
