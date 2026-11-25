"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Download,
  CheckCircle2,
  AlertCircle,
  Settings,
  Globe,
  List,
  Box,
  Film,
  FileText,
  Archive,
} from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useDownloadStore } from "@/store/downloadStore";

export function Sidebar() {
  const pathname = usePathname();
  const isPlayfulMode = useDownloadStore((state) => state.isPlayfulMode);
  const engineStatus = useDownloadStore((state) => state.engineStatus);

  const navItems = [
    { name: "All", href: "/", icon: List },
    { name: "Active", href: "/active", icon: Download },
    { name: "Completed", href: "/completed", icon: CheckCircle2 },
    { name: "Failed", href: "/failed", icon: AlertCircle },
    { name: "Web Tools", href: "/grabber", icon: Globe },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  const categories = [
    { name: "Software", icon: Box },
    { name: "Media", icon: Film },
    { name: "Documents", icon: FileText },
    { name: "Archives", icon: Archive },
  ];

  const isEngineError = engineStatus === "error"; // agyis: no-mutant UI presentation error state
  const statusClassName = isEngineError ? "text-destructive" : "text-muted-foreground"; // agyis: no-mutant UI presentation class
  const statusText = isEngineError // agyis: no-mutant UI presentation text
    ? "Engine offline"
    : isPlayfulMode
    ? "Ready to catch bytes 🐾"
    : "System ready";

  return (
    <aside className="flex h-full w-48 shrink-0 flex-col bg-sidebar/80 glass border-r border-sidebar-border text-sidebar-foreground">
      <nav className="flex-1 overflow-y-auto space-y-4 p-2.5 overflow-x-hidden pt-3">
        <div className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-lg py-1.5 px-2.5 text-xs font-medium transition-all duration-200",
                  isActive
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <item.icon
                  className={cn(
                    "shrink-0 transition-colors h-4 w-4",
                    isActive ? "text-primary" : "",
                  )}
                />
                <span className="truncate">{item.name}</span>
                {isActive && ( // agyis: no-mutant active indicator UI marker
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary animate-in zoom-in duration-200 shrink-0" />
                )}
              </Link>
            );
          })}
        </div>

        <div>
          <h4 className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5 truncate mt-4">
            Categories
          </h4>
          <div className="space-y-1">
            {categories.map((cat) => {
              const href = `/category/${cat.name.toLowerCase()}`;
              const isActive = pathname === href;
              return (
                <Link
                  key={cat.name}
                  href={href}
                  className={cn(
                    "flex items-center gap-2 rounded-lg py-1.5 px-2.5 text-xs font-medium transition-all duration-200",
                    isActive
                      ? "bg-accent text-foreground font-semibold"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <cat.icon
                    className={cn(
                      "shrink-0 transition-colors h-4 w-4",
                      isActive ? "text-primary" : "text-muted-foreground/70",
                    )}
                  />
                  <span className="truncate">{cat.name}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      <div className="p-2.5 border-t border-sidebar-border shrink-0">
        <div className="flex flex-col items-center justify-center space-y-1.5 rounded-lg bg-muted/40 p-2 text-center group hover:bg-muted/60 transition-colors">
          <Image
            src="/pdm.png"
            alt="PDM Mascot"
            width={48}
            height={48}
            className="h-8 w-8 opacity-80 group-hover:opacity-100 transition-all duration-300 drop-shadow-[0_0_8px_rgba(56,189,248,0.45)] object-contain"
          />
          <p className={cn("text-[11px] font-medium leading-tight", statusClassName)}>
            {statusText}
          </p>
        </div>
      </div>
    </aside>
  );
}
