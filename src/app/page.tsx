"use client";

import { useMemo } from "react";
import { useActiveDownloads, useCompletedDownloads, useFailedDownloads } from "@/store/selectors/downloadSelectors";
import { DownloadListView } from "@/components/download-list-view";
import { List } from "lucide-react";

export default function AllDownloads() {
  const activeDownloads = useActiveDownloads();
  const completedDownloads = useCompletedDownloads();
  const failedDownloads = useFailedDownloads();

  const allDownloads = useMemo(() => {
    return [...activeDownloads, ...completedDownloads, ...failedDownloads];
  }, [activeDownloads, completedDownloads, failedDownloads]);

  return (
    <DownloadListView
      title="All Downloads"
      description="A complete view of your active, completed, and failed downloads."
      downloads={allDownloads}
      emptyIcon={List}
      emptyTitle="No downloads found"
      emptyMessage="You haven't started any downloads yet. Add your first URL to begin!"
    />
  );
}
