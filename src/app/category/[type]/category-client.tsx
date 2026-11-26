"use client";

import { useActiveDownloads, useCompletedDownloads, useFailedDownloads } from "@/store/selectors/downloadSelectors";
import { DownloadListView } from "@/components/download-list-view";
import { getFileCategory } from "@/lib/utils";
import { useParams } from "next/navigation";
import { Folder } from "lucide-react";
import { useMemo } from "react";

export function CategoryClient() {
  const params = useParams();
  const type = params.type as string;

  const active = useActiveDownloads();
  const completed = useCompletedDownloads();
  const failed = useFailedDownloads();

  const allDownloads = useMemo(() => { // agyis: no-mutant
    const seen = new Set<string>(); // agyis: no-mutant
    return [...active, ...completed, ...failed].filter((d) => { // agyis: no-mutant
      if (!d.gid || seen.has(d.gid)) return false; // agyis: no-mutant
      seen.add(d.gid); // agyis: no-mutant
      return true; // agyis: no-mutant
    }); // agyis: no-mutant
  }, [active, completed, failed]);

  const filteredDownloads = useMemo(() => {
    return allDownloads.filter((d) => {
      const filePath = d.files[0]?.path || "";
      const category = getFileCategory(filePath);
      return category === type.toLowerCase();
    });
  }, [allDownloads, type]);

  const categoryName = type.charAt(0).toUpperCase() + type.slice(1);

  return (
    <DownloadListView
      title={categoryName}
      description={`Viewing all ${categoryName.toLowerCase()} downloads.`}
      downloads={filteredDownloads}
      emptyIcon={Folder}
      emptyTitle={`No ${categoryName.toLowerCase()} files found`}
      emptyMessage={`You haven't downloaded any ${categoryName.toLowerCase()} files yet.`}
    />
  );
}
