"use client";

import { useState } from "react";
import { useDownloadStore } from "@/store/downloadStore";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { open } from "@tauri-apps/plugin-dialog";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FolderOpen, HardDrive, Rocket, Activity, Cat, Globe } from "lucide-react";

export default function SettingsPage() {
  const {
    defaultDownloadDir, setDefaultDownloadDir,
    maxConcurrentDownloads, setMaxConcurrentDownloads,
    splitConnections, setSplitConnections,
    autoStart, setAutoStart,
    isPlayfulMode, togglePlayfulMode,
    safeBrowsingApiKey, setSafeBrowsingApiKey
  } = useDownloadStore();

  const [tempApiKey, setTempApiKey] = useState(safeBrowsingApiKey || "");
  const [apiKeyStatus, setApiKeyStatus] = useState<'idle' | 'validating' | 'success' | 'error'>('idle');
  const [apiErrorMessage, setApiErrorMessage] = useState("");

  const handleValidateApiKey = async () => {
    if (!tempApiKey.trim()) {
      setSafeBrowsingApiKey("");
      setApiKeyStatus('success');
      return;
    }
    
    setApiKeyStatus('validating');
    setApiErrorMessage('');
    
    try {
      const res = await tauriFetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${tempApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: { clientId: "purrfect-dl", clientVersion: "1.0.0" },
          threatInfo: {
            threatTypes: ["MALWARE"],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: [{ url: "http://example.com" }]
          }
        })
      });
      
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error?.message || `API Error ${res.status}`);
      }
      
      setSafeBrowsingApiKey(tempApiKey);
      setApiKeyStatus('success');
      
      // Reset success message after 3 seconds
      setTimeout(() => setApiKeyStatus('idle'), 3000);
    } catch (e: any) {
      setApiKeyStatus('error');
      setApiErrorMessage(e.message || 'Invalid API Key');
    }
  };

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
              onValueChange={(vals) => setMaxConcurrentDownloads(typeof vals === 'number' ? vals : vals[0])}
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
              onValueChange={(vals) => setSplitConnections(typeof vals === 'number' ? vals : vals[0])}
              max={16}
              min={1}
              step={1}
              className="py-4"
            />
          </div>
        </section>

        {/* Browser Integration */}
        <section className="space-y-4 bg-zinc-900/40 border border-zinc-800 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4 text-sky-400">
            <Globe className="h-5 w-5" />
            <h2 className="text-lg font-semibold text-zinc-100">Browser Integration</h2>
          </div>
          
          <div className="space-y-2">
            <Label className="text-zinc-300">Chrome / Edge Extension</Label>
            <p className="text-sm text-zinc-500">
              Install the companion extension to automatically intercept browser downloads and add a right-click "Download with Purrfect DL" context menu.
            </p>
            <div className="mt-4 bg-zinc-950 border border-zinc-800 rounded-md p-4 text-sm text-zinc-300 space-y-3">
              <p>1. Open your browser and navigate to <code className="text-indigo-400 bg-indigo-950/50 px-1 py-0.5 rounded">chrome://extensions</code> (or <code className="text-indigo-400 bg-indigo-950/50 px-1 py-0.5 rounded">edge://extensions</code>).</p>
              <p>2. Enable <strong className="text-zinc-100">Developer Mode</strong> in the top right corner.</p>
              <p>3. Click <strong className="text-zinc-100">Load unpacked</strong> and select the <code className="text-indigo-400 bg-indigo-950/50 px-1 py-0.5 rounded">extension</code> folder located inside your PDM directory.</p>
            </div>
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
            <div className="mt-2 flex gap-2">
              <Input 
                type="password"
                value={tempApiKey}
                onChange={(e) => {
                  setTempApiKey(e.target.value);
                  setApiKeyStatus('idle');
                }}
                placeholder="AIzaSyB..."
                className="bg-zinc-950 border-zinc-800 text-zinc-300 font-mono"
              />
              <Button 
                onClick={handleValidateApiKey}
                disabled={apiKeyStatus === 'validating'}
                className="shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {apiKeyStatus === 'validating' ? 'Validating...' : 'Save & Validate'}
              </Button>
            </div>
            {apiKeyStatus === 'error' && (
              <p className="text-sm text-red-400 mt-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                {apiErrorMessage}
              </p>
            )}
            {apiKeyStatus === 'success' && (
              <p className="text-sm text-emerald-400 mt-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                {tempApiKey ? 'API Key successfully validated and saved!' : 'Security scanning disabled.'}
              </p>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}
