import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { DashboardHeader } from "@/components/dashboard-header";
import { AppInitializer } from "@/components/app-initializer";
import { ConfirmDownloadModal } from "@/components/confirm-download-modal";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Purrfect Download Manager",
  description: "A modern, cross-platform desktop download manager.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-zinc-950 text-zinc-100 h-screen w-screen overflow-hidden flex selection:bg-indigo-500/30`}>
        <AppInitializer />
        <ConfirmDownloadModal />
        <Sidebar />
        <main className="flex-1 flex flex-col h-full bg-zinc-950/50">
          <DashboardHeader />
          <div className="flex-1 overflow-y-auto p-6">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
