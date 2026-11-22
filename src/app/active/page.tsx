"use client";

import { useActiveDownloads } from "@/store/selectors/downloadSelectors";
import { DownloadListView } from "@/components/download-list-view";
import { Cat } from "lucide-react";

export default function ActiveDownloadsPage() {
  const activeDownloads = useActiveDownloads();

  return (
    <DownloadListView
      title="Active Downloads"
      description="Currently downloading or waiting files."
      downloads={activeDownloads}
      emptyIcon={Cat}
      emptyTitle="No active downloads"
      emptyMessage="No files currently downloading. Start a new download to get going!"
    />
  );
}
