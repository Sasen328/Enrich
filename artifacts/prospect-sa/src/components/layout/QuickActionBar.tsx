// §3 — Quick Action Bar: horizontal chip strip with the 5 most-used jumps.
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { QUICK_TABS } from "@/lib/tab-registry";

export function QuickActionBar() {
  const [path] = useLocation();
  return (
    <div className="flex items-center gap-2 px-6 py-2 bar-bg text-xs overflow-x-auto">
      {QUICK_TABS.map((t) => {
        const active = path === t.url;
        return (
          <Link
            key={t.id}
            href={t.url}
            className={cn(
              "tr-chip px-3 py-1.5 rounded-full whitespace-nowrap font-medium border",
              active
                ? "bg-[hsl(var(--qa-bg))] text-primary border-primary/30 shadow-[0_0_10px_hsl(var(--glow)/0.30)]"
                : "bg-transparent text-muted-foreground border-border/40 hover:bg-[hsl(var(--qa-bg))]/40 hover:text-primary",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
