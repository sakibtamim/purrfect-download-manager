"use client";

import { useState, useEffect } from "react";
import { Plus, ChevronDown } from "lucide-react";
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
import { type ChecksumAlgorithm, type DetectedChecksum, validateChecksum } from "@/lib/utils";

export function AddDownloadModal() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [checksumDigest, setChecksumDigest] = useState("");
  const [checksumAlgorithm, setChecksumAlgorithm] = useState<ChecksumAlgorithm>("sha256");
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
      if (checksumDigest) {
        const c: DetectedChecksum = {
          algorithm: checksumAlgorithm,
          digest: checksumDigest,
          source: "manual"
        };
        if (!validateChecksum(c)) {
          window.alert(`Invalid ${checksumAlgorithm.toUpperCase()} checksum\nPlease check the length and format of your hash.`);
          return;
        }
        await addDownload(url, [], undefined, undefined, undefined, c);
      } else {
        await addDownload(url, [], undefined, undefined, undefined, undefined);
      }
      
      setUrl("");
      setChecksumDigest("");
      setChecksumAlgorithm("sha256");
      setOpen(false);
    } catch (error) {
      console.error("Failed to add download", error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" className="gap-1.5 shadow-sm text-xs" />}>
        <Plus className="h-3.5 w-3.5" />
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
            <div className="flex gap-2">
              <div className="relative shrink-0">
                <select 
                  value={checksumAlgorithm}
                  onChange={e => setChecksumAlgorithm(e.target.value as ChecksumAlgorithm)}
                  style={{ colorScheme: 'dark' }}
                  className="appearance-none bg-card border border-border text-foreground text-sm rounded-md pl-3 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
                >
                  <option value="md5" className="bg-card text-foreground">MD5</option>
                  <option value="sha1" className="bg-card text-foreground">SHA-1</option>
                  <option value="sha224" className="bg-card text-foreground">SHA-224</option>
                  <option value="sha256" className="bg-card text-foreground">SHA-256</option>
                  <option value="sha384" className="bg-card text-foreground">SHA-384</option>
                  <option value="sha512" className="bg-card text-foreground">SHA-512</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              <Input
                id="checksum"
                type="text"
                placeholder="Expected Checksum (Optional)"
                value={checksumDigest}
                onChange={(e) => setChecksumDigest(e.target.value)}
                className="bg-background border-border focus-visible:ring-primary font-mono text-sm flex-1"
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
