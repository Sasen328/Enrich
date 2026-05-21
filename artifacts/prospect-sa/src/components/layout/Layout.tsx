import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Button } from "@/components/ui/button";
import { CommandBar } from "./CommandBar";
import { QuickActionBar } from "./QuickActionBar";
import { SubTabBar } from "./SubTabBar";
import { RailProvider } from "./RailContext";
import { RailSidebar } from "./RailSidebar";
import { ThemeFlash } from "./ThemeFlash";
import { MeshCanvas } from "./MeshCanvas";

export function Layout({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useTheme();

  const style = {
    "--sidebar-width": "17rem",
    "--sidebar-width-icon": "4rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <RailProvider>
        <ThemeFlash />
        <MeshCanvas />
        <div className="flex h-screen w-full bg-background mesh-gradient-bg text-foreground overflow-hidden">
          <AppSidebar />
          <div className="flex flex-col flex-1 relative z-10 w-full overflow-hidden">
            {/* §3 — 6-bar stack: SystemBar / CommandBar / QuickActionBar / SubTabBar / (page) / footer */}
            <header className="flex items-center justify-between px-6 py-3 bar-bg z-20 tr-bar">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="text-muted-foreground hover:text-primary tr-chip" />
                <CommandBar />
              </div>
              <div className="flex items-center gap-4">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-primary tr-button"
                  title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                >
                  {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </Button>
                <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_hsl(var(--glow)/0.40)] animate-pulse" />
                <span className="text-xs font-medium text-muted-foreground">System Operational</span>
              </div>
            </header>
            <QuickActionBar />
            <SubTabBar />
            <div className="flex flex-1 overflow-hidden">
              <RailSidebar />
              <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 relative">
                {children}
              </main>
            </div>
          </div>
        </div>
      </RailProvider>
    </SidebarProvider>
  );
}
