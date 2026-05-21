// §3 — Sub-Tab Bar. Renders for /lead-factory, /prospecting, /masaar,
// /meshbase, /sa-market. Items marked rail:true show › and open the
// Glassmorphic Rail Sidebar on click.
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { subsForPath } from "@/lib/tab-registry";
import { useRail } from "./RailContext";

export function SubTabBar() {
  const [path] = useLocation();
  const subs = subsForPath(path);
  const { open } = useRail();
  if (subs.length === 0) return null;

  return (
    <div className="flex items-center gap-1 px-6 py-2 bar-bg overflow-x-auto border-b border-border/30">
      {subs.map((s) => {
        const active = path === s.url || path.startsWith(s.url + "/");
        return (
          <div key={s.id} className="flex items-center">
            <Link
              href={s.url}
              className={cn(
                "tr-tab inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap",
                active
                  ? "bg-primary/10 text-primary shadow-[0_2px_10px_hsl(var(--glow)/0.30)]"
                  : "text-muted-foreground hover:text-primary hover:bg-primary/5",
              )}
            >
              <s.icon className="w-3.5 h-3.5" />
              {s.label}
            </Link>
            {s.rail && (
              <button
                onClick={() => open(s.id)}
                aria-label={`Open ${s.label} rail`}
                className="px-1 py-1 text-xs text-muted-foreground hover:text-primary tr-chip"
                title="Open rail"
              >
                ›
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
