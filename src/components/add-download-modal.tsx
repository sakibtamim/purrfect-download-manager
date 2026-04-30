"use client";

import { useState } from "react";
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
      <DialogTrigger render={<Button className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2" />}>
        <Plus className="h-4 w-4" />
        New Download
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] bg-zinc-950 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle>Add New Download</DialogTitle>
          <DialogDescription className="text-zinc-400">
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
                className="bg-zinc-900 border-zinc-800 focus-visible:ring-indigo-500"
                required
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="border-zinc-800 hover:bg-zinc-800 hover:text-zinc-100">
              Cancel
            </Button>
            <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white">
              Start Download
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
