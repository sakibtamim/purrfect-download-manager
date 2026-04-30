"use client";

import { useDownloadStore } from "@/store/downloadStore";
import { DownloadCard } from "@/components/download-card";
import { Cat, CheckCircle2 } from "lucide-react";

export default function Completed() {
  const completedDownloads = useDownloadStore(state => state.completed);
  const isPlayfulMode = useDownloadStore(state => state.isPlayfulMode);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Completed Downloads</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Files that have successfully downloaded.
        </p>
      </div>

      {completedDownloads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-zinc-800/50 rounded-2xl bg-zinc-900/10">
          <div className="p-4 bg-zinc-900 rounded-full mb-4">
            <CheckCircle2 className="h-10 w-10 text-zinc-500" strokeWidth={1.5} />
          </div>
          <h3 className="text-lg font-medium text-zinc-200">No completed downloads</h3>
          <p className="text-sm text-zinc-500 mt-1 max-w-xs mx-auto">
            {isPlayfulMode 
              ? "No catches yet. Send your cat out to hunt!" 
              : "Completed files will appear here."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {completedDownloads.map(download => (
            <DownloadCard key={download.gid} download={download} />
          ))}
        </div>
      )}
    </div>
  );
}
