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
      isCollapsed ? "w-20" : "w-64"
    )}>
      <div className={cn("flex items-center border-b border-sidebar-border transition-all duration-300", isCollapsed ? "flex-col py-6 gap-4" : "p-6 justify-between")}>
        <div className={cn("flex items-center", isCollapsed ? "justify-center" : "gap-2.5")}>
          <div className="p-1.5 rounded-lg flex items-center justify-center shrink-0">
            <Image
              src="/pdm_logo.png"
              alt="PDM Logo"
              width={40}
              height={40}
              className="h-10 w-10 object-contain"
            />
          </div>
          {!isCollapsed && (
            <span className="font-semibold tracking-tight text-lg text-foreground truncate">
              PDM
            </span>
          )}
        </div>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto space-y-6 p-4 overflow-x-hidden">
        <div className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                title={isCollapsed ? item.name : undefined}
                className={cn(
                  "flex items-center rounded-lg py-2.5 text-sm font-medium transition-all duration-200",
                  isCollapsed ? "justify-center px-0" : "gap-3 px-3",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <item.icon
                  className={cn(
                    "shrink-0 transition-colors",
                    isCollapsed ? "h-5 w-5" : "h-4 w-4",
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
            <h4 className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2 truncate mt-6">
              Categories
            </h4>
          )}
          {isCollapsed && <div className="mt-6 mb-2 border-t border-border mx-4" />}
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
                    "flex items-center rounded-lg py-2 text-sm font-medium transition-all duration-200",
                    isCollapsed ? "justify-center px-0" : "gap-3 px-3",
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <cat.icon
                    className={cn(
                      "shrink-0 transition-colors",
                      isCollapsed ? "h-5 w-5" : "h-4 w-4",
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

      <div className="p-4 border-t border-sidebar-border">
        {!isCollapsed && (
          <div className="flex flex-col items-center justify-center space-y-2 rounded-xl bg-muted/50 p-4 text-center">
            <Image
              src="/pdm_logo.png"
              alt="PDM Mascot"
              width={32}
              height={32}
              className="h-8 w-8 opacity-40 grayscale mb-1 object-contain"
            />
            <p className="text-xs text-muted-foreground font-medium">
              {isPlayfulMode ? "Ready to catch bytes 🐾" : "System ready"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
