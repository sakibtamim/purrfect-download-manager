"use client";

import { useDownloadStore } from "@/store/downloadStore";
import { Cat, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Settings() {
  const isPlayfulMode = useDownloadStore(state => state.isPlayfulMode);
  const togglePlayfulMode = useDownloadStore(state => state.togglePlayfulMode);

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Manage your application preferences.
        </p>
      </div>

      <div className="space-y-4">
        <div className="p-6 border border-zinc-800 rounded-xl bg-zinc-950 flex items-center justify-between">
          <div className="flex gap-4 items-start">
            <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400 shrink-0">
              <Cat className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-zinc-100">Playful Mode</h3>
              <p className="text-sm text-zinc-400 mt-1 max-w-md">
                Enable subtle cat-themed personality and playful copy throughout the application. Purrfect for a more enjoyable download experience.
              </p>
            </div>
          </div>
          <Button 
            variant={isPlayfulMode ? "default" : "outline"} 
            onClick={togglePlayfulMode}
            className={isPlayfulMode ? "bg-indigo-600 hover:bg-indigo-700" : "border-zinc-700 text-zinc-300"}
          >
            {isPlayfulMode ? "Enabled" : "Disabled"}
          </Button>
        </div>
      </div>
    </div>
  );
}
