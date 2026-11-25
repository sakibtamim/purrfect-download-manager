"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";
import { Minus, Plus, Copy, X } from "lucide-react";

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const isTogglingRef = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupWindow = async () => {
      try {
        if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const appWindow = getCurrentWindow();

          setIsMaximized(await appWindow.isMaximized());

          unlisten = await appWindow.onResized(async () => {
            setIsMaximized(await appWindow.isMaximized());
          });
        }
      } catch (err) {
        console.warn("Tauri window APIs not available:", err);
      }
    };

    setupWindow();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const handleMinimize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch (err) {
      console.warn("Minimize error:", err);
    }
  };

  const handleToggleMaximize = async () => {
    if (isTogglingRef.current) return;
    isTogglingRef.current = true;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      setIsMaximized(await appWindow.isMaximized());
    } catch (err) {
      console.warn("Toggle maximize error:", err);
    } finally {
      setTimeout(() => {
        isTogglingRef.current = false;
      }, 350);
    }
  };

  const handleClose = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (err) {
      console.warn("Close error:", err);
    }
  };

  return (
    <header
      data-tauri-drag-region
      className="h-9.5 shrink-0 flex items-center justify-between px-3 bg-sidebar/95 glass border-b border-border/70 select-none z-50 text-foreground transition-colors"
    >
      {/* Left: PDM Stylized Brand Logo */}
      <div className="flex items-center gap-2 shrink-0 pointer-events-none" data-tauri-drag-region>
        <Image
          src="/pdm_logo.png"
          alt="PDM - Purrfect Download Manager"
          width={130}
          height={36}
          priority
          className="h-7 w-auto object-contain transition-all hover:brightness-110 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
        />
      </div>

      {/* Center: Window Title (Draggable region) */}
      <div
        className="flex-1 text-center text-xs font-medium tracking-wide text-muted-foreground/80 hover:text-foreground/90 transition-colors cursor-default truncate px-4"
        data-tauri-drag-region
      >
        Purrfect Download Manager
      </div>

      {/* Right: Modern Cyber-Jewels Window Controls */}
      <div className="flex items-center gap-2 pr-1 shrink-0" data-tauri-drag-region="false">
        {/* Minimize */}
        <button
          type="button"
          onClick={handleMinimize}
          className="group relative w-3.5 h-3.5 rounded-full bg-amber-400/90 border border-amber-300/50 flex items-center justify-center transition-all duration-200 hover:scale-125 hover:shadow-[0_0_12px_rgba(251,191,36,0.85)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
          title="Minimize"
          aria-label="Minimize window"
        >
          <Minus className="h-2 w-2 text-amber-950 stroke-[3] opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>

        {/* Maximize / Restore */}
        <button
          type="button"
          onClick={handleToggleMaximize}
          className="group relative w-3.5 h-3.5 rounded-full bg-emerald-400/90 border border-emerald-300/50 flex items-center justify-center transition-all duration-200 hover:scale-125 hover:shadow-[0_0_12px_rgba(52,211,153,0.85)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
          title={isMaximized ? "Restore" : "Maximize"}
          aria-label={isMaximized ? "Restore window" : "Maximize window"}
        >
          {isMaximized ? (
            <Copy className="h-2 w-2 text-emerald-950 stroke-[3] opacity-0 group-hover:opacity-100 transition-opacity rotate-90" />
          ) : (
            <Plus className="h-2 w-2 text-emerald-950 stroke-[3] opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </button>

        {/* Close */}
        <button
          type="button"
          onClick={handleClose}
          className="group relative w-3.5 h-3.5 rounded-full bg-rose-500 border border-rose-300/50 flex items-center justify-center transition-all duration-200 hover:scale-125 hover:shadow-[0_0_14px_rgba(244,63,94,0.95)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50"
          title="Close"
          aria-label="Close window"
        >
          <X className="h-2 w-2 text-rose-950 stroke-[3] opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      </div>
    </header>
  );
}
