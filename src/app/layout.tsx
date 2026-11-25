import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { TitleBar } from "@/components/title-bar";
import { Sidebar } from "@/components/sidebar";
import { DashboardHeader } from "@/components/dashboard-header";
import { AppInitializer } from "@/components/app-initializer";
import { ThemeProvider } from "@/components/theme-provider";
import { StoreHydrator } from "@/components/providers/store-hydrator";
import { ConfirmDownloadModal } from "@/components/confirm-download-modal";
import { DownloadDetailsPanel } from "@/components/download-details-panel";

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
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${inter.className} antialiased bg-background text-foreground h-screen w-screen overflow-hidden flex flex-col selection:bg-primary/30`}>
        <StoreHydrator>
          <ThemeProvider />
          <AppInitializer />
          <ConfirmDownloadModal />
          <TitleBar />
          <div className="flex-1 flex overflow-hidden min-h-0">
            <Sidebar />
            <div className="flex-1 flex flex-col h-full min-w-0">
              <DashboardHeader />
              <main id="main-content" className="flex-1 overflow-y-auto p-4 md:p-5 relative">
                {children}
              </main>
              <DownloadDetailsPanel />
            </div>
          </div>
        </StoreHydrator>
      </body>
    </html>
  );
}
