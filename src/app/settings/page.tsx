"use client";

import { useDownloadStore } from "@/store/downloadStore";
import { open } from "@tauri-apps/plugin-dialog";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FolderOpen, HardDrive, Rocket, Activity, Cat } from "lucide-react";

export default function SettingsPage() {
  const {
    defaultDownloadDir, setDefaultDownloadDir,
    maxConcurrentDownloads, setMaxConcurrentDownloads,
    splitConnections, setSplitConnections,
    autoStart, setAutoStart,
    isPlayfulMode, togglePlayfulMode
  } = useDownloadStore();

  const handleBrowseDefaultDir = async () => {
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Select Default Save Location"
      });
      if (selectedPath && typeof selectedPath === 'string') {
        setDefaultDownloadDir(selectedPath);
      }
    } catch (e) {
      console.error("Failed to open dialog", e);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-100">Settings</h1>
        <p className="text-zinc-400 mt-1">Configure your Purrfect Download Manager preferences.</p>
      </div>

      <div className="grid gap-8">
        
        {/* Storage Settings */}
        <section className="space-y-4 bg-zinc-900/40 border border-zinc-800 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4 text-indigo-400">
            <HardDrive className="h-5 w-5" />
            <h2 className="text-lg font-semibold text-zinc-100">Storage & Location</h2>
          </div>
          
          <div className="space-y-2">
            <Label className="text-zinc-300">Default Download Directory</Label>
            <p className="text-sm text-zinc-500">Where files will be saved if you don't pick a location manually.</p>
            <div className="flex gap-2 mt-2">
              <Input 
                value={defaultDownloadDir || "OS Default Downloads"} 
                readOnly
                className="bg-zinc-950 border-zinc-800 text-zinc-300 font-medium"
              />
              <Button onClick={handleBrowseDefaultDir} variant="outline" className="shrink-0 border-zinc-700 hover:bg-zinc-800 text-zinc-100">
                <FolderOpen className="w-4 h-4 mr-2" />
                Browse
              </Button>
            </div>
          </div>
        </section>

        {/* Network & Performance */}
        <section className="space-y-6 bg-zinc-900/40 border border-zinc-800 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4 text-emerald-400">
            <Rocket className="h-5 w-5" />
            <h2 className="text-lg font-semibold text-zinc-100">Network & Performance</h2>
          </div>
          
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <Label className="text-zinc-300">Max Concurrent Downloads</Label>
                <p className="text-sm text-zinc-500">How many files can download at the exact same time.</p>
              </div>
              <span className="text-xl font-bold text-zinc-100 bg-zinc-950 px-4 py-1 rounded-lg border border-zinc-800">
                {maxConcurrentDownloads}
              </span>
            </div>
            <Slider
              value={[maxConcurrentDownloads]}
              onValueChange={(vals) => setMaxConcurrentDownloads(vals[0])}
              max={16}
              min={1}
              step={1}
              className="py-4"
            />
          </div>

          <div className="pt-4 border-t border-zinc-800/50 space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <Label className="text-zinc-300">Connections Per File (Split)</Label>
                <p className="text-sm text-zinc-500">How many pieces a single file is split into to maximize bandwidth.</p>
              </div>
              <span className="text-xl font-bold text-zinc-100 bg-zinc-950 px-4 py-1 rounded-lg border border-zinc-800">
                {splitConnections}
              </span>
            </div>
            <Slider
              value={[splitConnections]}
              onValueChange={(vals) => setSplitConnections(vals[0])}
              max={16}
              min={1}
              step={1}
              className="py-4"
            />
          </div>
        </section>

        {/* System Integrations */}
        <section className="space-y-4 bg-zinc-900/40 border border-zinc-800 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4 text-amber-400">
            <Activity className="h-5 w-5" />
            <h2 className="text-lg font-semibold text-zinc-100">System Integrations</h2>
          </div>
          
          <div className="flex items-center justify-between py-2">
            <div className="space-y-0.5">
              <Label className="text-zinc-300">Launch on Startup</Label>
              <p className="text-sm text-zinc-500">Automatically open Purrfect DL in the system tray when Windows boots.</p>
            </div>
            <Switch
              checked={autoStart}
              onCheckedChange={setAutoStart}
            />
          </div>

          <div className="flex items-center justify-between py-2 pt-4 border-t border-zinc-800/50">
            <div className="space-y-0.5">
              <Label className="text-zinc-300 flex items-center gap-2">Playful Mode <Cat className="w-4 h-4 text-indigo-400" /></Label>
              <p className="text-sm text-zinc-500">Enable fun UI micro-animations and cat-themed placeholder texts.</p>
            </div>
            <Switch
              checked={isPlayfulMode}
              onCheckedChange={togglePlayfulMode}
            />
          </div>
        </section>

        {/* Security & Antivirus */}
        <section className="space-y-4 bg-zinc-900/40 border border-zinc-800 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4 text-red-400">
            <Activity className="h-5 w-5" />
            <h2 className="text-lg font-semibold text-zinc-100">Security & Antivirus</h2>
          </div>
          
          <div className="space-y-2">
            <Label className="text-zinc-300">Google Safe Browsing API Key</Label>
            <p className="text-sm text-zinc-500">
              Provide an API key to automatically scan URLs for malware and phishing before downloading. 
              Leave blank to disable security scanning.
            </p>
            <div className="mt-2">
              <Input 
                type="password"
                value={useDownloadStore(state => state.safeBrowsingApiKey) || ""}
                onChange={(e) => useDownloadStore.getState().setSafeBrowsingApiKey(e.target.value)}
                placeholder="AIzaSyB..."
                className="bg-zinc-950 border-zinc-800 text-zinc-300 font-mono"
              />
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
