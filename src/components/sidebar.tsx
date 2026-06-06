"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Download,
  CheckCircle2,
  AlertCircle,
  Settings,
  Globe,
} from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useDownloadStore } from "@/store/downloadStore";

export function Sidebar() {
  const pathname = usePathname();
  const isPlayfulMode = useDownloadStore((state) => state.isPlayfulMode);

  const navItems = [
    { name: "Downloads", href: "/", icon: Download },
    { name: "Web Tools", href: "/grabber", icon: Globe },
    { name: "Completed", href: "/completed", icon: CheckCircle2 },
    { name: "Failed", href: "/failed", icon: AlertCircle },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  return (
    <div className="flex h-full w-64 flex-col bg-sidebar/80 glass border-r border-sidebar-border text-sidebar-foreground">
      <div className="flex items-center gap-2.5 p-6 border-b border-sidebar-border">
        <div className="p-1.5  rounded-lg flex items-center justify-center">
          <Image
            src="/pdm_logo.png"
            alt="PDM Logo"
            width={40}
            height={40}
            className="h-10 w-10 object-contain"
          />
        </div>
        <span className="font-semibold tracking-tight text-lg text-foreground">
          PDM
        </span>
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
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <item.icon
                  className={cn(
                    "h-4 w-4 transition-colors",
                    isActive ? "text-primary" : "",
                  )}
                />
                {item.name}
                {isActive && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary animate-in zoom-in duration-200" />
                )}
              </Link>
            );
          })}
        </div>

        <div>
          <h4 className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">
            Categories
          </h4>
          <div className="space-y-1">
            {["Software", "Media", "Documents", "Archives"].map((cat) => {
              const href = `/category/${cat.toLowerCase()}`;
              const isActive = pathname === href;
              return (
                <Link
                  key={cat}
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <div
                    className={cn(
                      "w-1.5 h-1.5 rounded-full transition-colors",
                      isActive ? "bg-primary" : "bg-muted-foreground/30",
                    )}
                  />
                  {cat}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      <div className="p-4 border-t border-sidebar-border">
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
      </div>
    </div>
  );
}
