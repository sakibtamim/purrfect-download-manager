"use client";

import { useCompletedDownloads } from "@/store/selectors/downloadSelectors";
import { DownloadListView } from "@/components/download-list-view";
import { CheckCircle2 } from "lucide-react";

export default function CompletedDownloadsPage() {
  const completedDownloads = useCompletedDownloads();

  return (
    <DownloadListView
      title="Completed Downloads"
      description="Files that have successfully downloaded."
      downloads={completedDownloads}
      emptyIcon={CheckCircle2}
      emptyTitle="No completed downloads"
      emptyMessage="Completed downloads will appear here once finished."
    />
  );
}
