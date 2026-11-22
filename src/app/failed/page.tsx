"use client";

import { useFailedDownloads } from "@/store/selectors/downloadSelectors";
import { DownloadListView } from "@/components/download-list-view";
import { AlertCircle } from "lucide-react";

export default function FailedDownloadsPage() {
  const failedDownloads = useFailedDownloads();

  return (
    <DownloadListView
      title="Failed Downloads"
      description="Files that encountered errors or were cancelled."
      downloads={failedDownloads}
      emptyIcon={AlertCircle}
      emptyTitle="No failed downloads"
      emptyMessage="All clear! No failed or cancelled downloads recorded."
    />
  );
}
