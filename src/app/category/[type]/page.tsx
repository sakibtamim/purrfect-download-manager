"use client";

import { useDownloadStore } from "@/store/downloadStore";
import { DownloadCard } from "@/components/download-card";
import { getFileCategory } from "@/lib/utils";
import { useParams } from "next/navigation";
import { Folder } from "lucide-react";
import { useMemo } from "react";

export default function CategoryPage() {
  const params = useParams();
  const type = params.type as string;
  
  const { active, completed, failed, isPlayfulMode } = useDownloadStore();

  const allDownloads = useMemo(() => {
    return [...active, ...completed, ...failed];
  }, [active, completed, failed]);

  const filteredDownloads = useMemo(() => {
    return allDownloads.filter(d => {
      const filePath = d.files[0]?.path || "";
      const category = getFileCategory(filePath);
      return category === type.toLowerCase();
    });
  }, [allDownloads, type]);

  const categoryName = type.charAt(0).toUpperCase() + type.slice(1);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{categoryName}</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Viewing all {categoryName.toLowerCase()} downloads.
        </p>
      </div>

      {filteredDownloads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-zinc-800/50 rounded-2xl bg-zinc-900/10">
          <div className="p-4 bg-zinc-900 rounded-full mb-4">
            <Folder className="h-10 w-10 text-zinc-500" strokeWidth={1.5} />
          </div>
          <h3 className="text-lg font-medium text-zinc-200">No files found</h3>
          <p className="text-sm text-zinc-500 mt-1 max-w-xs mx-auto">
            {isPlayfulMode 
              ? `No ${categoryName.toLowerCase()} mice caught yet!` 
              : `You haven't downloaded any ${categoryName.toLowerCase()} files.`}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredDownloads.map(download => (
            <DownloadCard key={download.gid} download={download} />
          ))}
        </div>
      )}
    </div>
  );
}
