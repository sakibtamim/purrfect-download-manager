"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Download,
  CheckCircle2,
  AlertCircle,
  Settings,
  Globe,
  List,
  ChevronLeft,
  ChevronRight,
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
  const [isCollapsed, setIsCollapsed] = useState(false);

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

  return (
    <div className={cn(
      "flex h-full flex-col bg-sidebar/80 glass border-r border-sidebar-border text-sidebar-foreground transition-all duration-300",
      isCollapsed ? "w-14" : "w-48"
    )}>
      <div className={cn("flex items-center border-b border-sidebar-border transition-all duration-300", isCollapsed ? "flex-col py-3 gap-2" : "px-3 py-2.5 justify-between")}>
        <div className="flex items-center justify-center shrink-0 min-w-0">
          <Image
            src={isCollapsed ? "/pdm.png" : "/pdm_logo.png"}
            alt="PDM - Purrfect Download Manager"
            width={isCollapsed ? 48 : 256}
            height={isCollapsed ? 48 : 72}
            priority
            className={cn(
              "object-contain transition-all duration-300 drop-shadow-[0_2px_10px_rgba(56,189,248,0.4)] hover:brightness-110",
              isCollapsed ? "h-8 w-8" : "h-9 w-auto max-w-[130px]"
            )}
          />
        </div>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          aria-label={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          aria-expanded={!isCollapsed}
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto space-y-4 p-2 overflow-x-hidden">
        <div className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                title={isCollapsed ? item.name : undefined}
                className={cn(
                  "flex items-center rounded-lg py-1.5 text-xs font-medium transition-all duration-200",
                  isCollapsed ? "justify-center px-0" : "gap-2 px-2.5",
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
                {!isCollapsed && <span className="truncate">{item.name}</span>}
                {!isCollapsed && isActive && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary animate-in zoom-in duration-200 shrink-0" />
                )}
              </Link>
            );
          })}
        </div>

        <div>
          {!isCollapsed && (
            <h4 className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1 truncate mt-4">
              Categories
            </h4>
          )}
          {isCollapsed && <div className="mt-4 mb-2 border-t border-border mx-2" />}
          <div className="space-y-1">
            {categories.map((cat) => {
              const href = `/category/${cat.name.toLowerCase()}`;
              const isActive = pathname === href;
              return (
                <Link
                  key={cat.name}
                  href={href}
                  title={isCollapsed ? cat.name : undefined}
                  className={cn(
                    "flex items-center rounded-lg py-1.5 text-xs font-medium transition-all duration-200",
                    isCollapsed ? "justify-center px-0" : "gap-2 px-2.5",
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
                  {!isCollapsed && <span className="truncate">{cat.name}</span>}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      <div className="p-2.5 border-t border-sidebar-border">
        {!isCollapsed && (
          <div className="flex flex-col items-center justify-center space-y-1.5 rounded-lg bg-muted/40 p-2 text-center group hover:bg-muted/60 transition-colors">
            <Image
              src="/pdm.png"
              alt="PDM Mascot"
              width={48}
              height={48}
              className="h-8 w-8 opacity-80 group-hover:opacity-100 transition-all duration-300 drop-shadow-[0_0_8px_rgba(56,189,248,0.45)] object-contain"
            />
            <p className="text-[11px] text-muted-foreground font-medium leading-tight">
              {isPlayfulMode ? "Ready to catch bytes 🐾" : "System ready"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
