// §3 Bar 2 — Main Tab Bar. Top-level pages from TAB_NAMES.
// Renders below the SystemBar; click switches main route + SubTabBar
// auto-refreshes (it's driven by location).
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { TAB_NAMES } from "@/lib/tab-registry";

export function MainTabBar() {
  const [path] = useLocation();
  const matchActive = (url: string) => {
    if (url === "/") return path === "/";
    const root = "/" + url.split("/").filter(Boolean)[0];
    return path === root || path.startsWith(root + "/");
  };
  return (
    <nav className="flex items-center gap-1 px-6 py-2 bar-bg overflow-x-auto tr-bar">
      {TAB_NAMES.map((t) => {
        const active = matchActive(t.url);
        return (
          <Link
            key={t.id}
            href={t.url}
            className={cn(
              "tr-tab inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap",
              active
                ? "bg-primary/10 text-primary shadow-[0_0_12px_hsl(var(--glow)/0.30)]"
                : "text-muted-foreground hover:text-primary hover:bg-primary/5",
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
