"use client";

import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import { useDownloadStore } from "@/store/downloadStore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AddDownloadModal() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const addDownload = useDownloadStore(state => state.addDownload);

  useEffect(() => {
    let active = true;
    let unlistenFn: (() => void) | undefined;

    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      import('@tauri-apps/api/event').then(({ listen }) => {
        if (!active) return;
        listen('tray-new-download', () => {
          setOpen(true);
        }).then(f => {
          if (active) {
            unlistenFn = f;
          } else {
            f();
          }
        }).catch(console.warn);
      });
    }

    return () => {
      active = false;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    
    try {
      await addDownload(url);
      setUrl("");
      setOpen(false);
    } catch (error) {
      console.error("Failed to add download", error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="gap-2" />}>
        <Plus className="h-4 w-4" />
        New Download
      </DialogTrigger>
      <DialogContent className="sm:max-w-106.25 bg-card border-border text-foreground">
        <DialogHeader>
          <DialogTitle>Add New Download</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Paste the URL of the file you want to download.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Input
                id="url"
                type="url"
                placeholder="https://example.com/file.zip"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="bg-background border-border focus-visible:ring-primary"
                required
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">
              Start Download
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
