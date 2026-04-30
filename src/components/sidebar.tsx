"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Download, CheckCircle2, AlertCircle, Settings, Cat, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDownloadStore } from "@/store/downloadStore";

export function Sidebar() {
  const pathname = usePathname();
  const isPlayfulMode = useDownloadStore(state => state.isPlayfulMode);
  
  const navItems = [
    { name: "Downloads", href: "/", icon: Download },
    { name: "Web Tools", href: "/grabber", icon: Globe },
    { name: "Completed", href: "/completed", icon: CheckCircle2 },
    { name: "Failed", href: "/failed", icon: AlertCircle },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  return (
    <div className="flex h-full w-64 flex-col bg-zinc-950 border-r border-zinc-800 text-zinc-100">
      <div className="flex items-center gap-2 p-6 border-b border-zinc-800/50">
        <Cat className="h-6 w-6 text-indigo-400" />
        <span className="font-semibold tracking-tight text-lg">Purrfect DL</span>
      </div>
      
      <nav className="flex-1 overflow-y-auto space-y-6 p-4">
        <div className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  isActive
                    ? "bg-indigo-500/10 text-indigo-400"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100"
                )}
              >
                <item.icon className={cn("h-4 w-4", isActive ? "text-indigo-400" : "text-zinc-400")} />
                {item.name}
              </Link>
            );
          })}
        </div>

        <div>
          <h4 className="px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Categories</h4>
          <div className="space-y-1">
            {["Software", "Media", "Documents", "Archives"].map((cat) => {
              const href = `/category/${cat.toLowerCase()}`;
              const isActive = pathname === href;
              return (
                <Link
                  key={cat}
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all",
                    isActive
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100"
                  )}
                >
                  <div className={cn("w-1.5 h-1.5 rounded-full", isActive ? "bg-indigo-400" : "bg-zinc-700")} />
                  {cat}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      <div className="p-4 border-t border-zinc-800/50">
        <div className="flex flex-col items-center justify-center space-y-2 rounded-xl bg-zinc-900/50 p-4 text-center">
          <Cat className="h-8 w-8 text-zinc-600 mb-1 opacity-50" strokeWidth={1.5} />
          <p className="text-xs text-zinc-500 font-medium">
            {isPlayfulMode ? "Ready to catch bytes 🐾" : "System ready"}
          </p>
        </div>
      </div>
    </div>
  );
}
