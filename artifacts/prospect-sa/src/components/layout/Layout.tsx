// §3 — 3-bar stack (simplified):
//   Bar 1: .cmd     — CommandBar (logo + ⌘K search + chips)
//   Bar 2: .tabbar  — MainTabBar (top-level tabs)
//   Bar 3: .subbar  — SubTabBar  (sub-tabs of the active tab)
//   QuickActionBar + KeyStrip removed — the first duplicated the main tabs
//   (so unrelated tabs appeared under the active tab); keyboard shortcuts are
//   still bound by ShortcutListener below.
import { useEffect } from "react";
import { useTheme } from "next-themes";
import { CommandBar } from "./CommandBar";
import { MainTabBar } from "./MainTabBar";
import { SubTabBar } from "./SubTabBar";
import { RailProvider, useRail } from "./RailContext";
import { RailSidebar } from "./RailSidebar";
import { ThemeFlash } from "./ThemeFlash";

function ShortcutListener() {
  const { state, toggle, collapse } = useRail();
  const { theme, setTheme } = useTheme();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (/INPUT|TEXTAREA/.test(tag)) return;
      if (e.key.toLowerCase() === "s") { e.preventDefault(); toggle(); }
      if (e.key.toLowerCase() === "i") { e.preventDefault(); collapse(); }
      if (e.key.toLowerCase() === "d") { e.preventDefault(); setTheme(theme === "dark" ? "light" : "dark"); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [state, toggle, collapse, theme, setTheme]);
  return null;
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <RailProvider>
      <ShortcutListener />
      <ThemeFlash />
      <div className="flex flex-col h-screen w-full text-foreground overflow-hidden mesh-gradient-bg">
        <CommandBar />
        <MainTabBar />
        <SubTabBar />
        <div className="body-row">
          <RailSidebar />
          <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 relative">
            {children}
          </main>
        </div>
      </div>
    </RailProvider>
  );
}
