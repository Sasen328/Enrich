// §3 — 6-bar stack:
//   Bar 1: SystemBar     — CommandBar (⌘K) + theme toggle + status
//   Bar 2: MainTabBar    — TAB_NAMES top-level pages
//   Bar 3: SubTabBar     — contextual sub-tabs (with › to open rail)
//   Bar 4: QuickActionBar — shortcuts
//   Bar 5: page content (+ rail on the left)
//   Bar 6: nothing-yet footer slot (reserved)
//
// AppSidebar (legacy left nav) is intentionally removed. The new MainTabBar
// is the nav. RailSidebar handles deep panels per sub-tab.
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandBar } from "./CommandBar";
import { MainTabBar } from "./MainTabBar";
import { SubTabBar } from "./SubTabBar";
import { QuickActionBar } from "./QuickActionBar";
import { RailProvider } from "./RailContext";
import { RailSidebar } from "./RailSidebar";
import { ThemeFlash } from "./ThemeFlash";
import { MeshCanvas } from "./MeshCanvas";

export function Layout({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useTheme();

  return (
    <RailProvider>
      <ThemeFlash />
      <MeshCanvas />
      <div className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden">
        {/* Bar 1 — System Bar */}
        <header className="flex items-center justify-between px-6 py-3 bar-bg z-20 tr-bar">
          <div className="flex items-center gap-3 flex-1 max-w-md">
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
        {/* Bar 2 — Main Tab Bar */}
        <MainTabBar />
        {/* Bar 3 — Sub-Tab Bar (auto-hides when no subs apply) */}
        <SubTabBar />
        {/* Bar 4 — Quick Action Bar */}
        <QuickActionBar />
        {/* Bar 5 — Rail + page content */}
        <div className="flex flex-1 overflow-hidden">
          <RailSidebar />
          <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 relative">
            {children}
          </main>
        </div>
      </div>
    </RailProvider>
  );
}
