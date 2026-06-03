"use client";

import { useDownloadStore } from "@/store/downloadStore";
import { DownloadCard } from "@/components/download-card";
import { getFileCategory } from "@/lib/utils";
import { useParams } from "next/navigation";
import { Folder } from "lucide-react";
import { useMemo } from "react";

export function CategoryClient() {
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
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{categoryName}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Viewing all {categoryName.toLowerCase()} downloads.
        </p>
      </div>

      {filteredDownloads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-border rounded-2xl bg-muted/30">
          <div className="p-4 bg-muted rounded-full mb-4">
            <Folder className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <h3 className="text-lg font-medium text-foreground">No files found</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
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
