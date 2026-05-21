// §4 — Glassmorphic Rail Sidebar
// 3 states: closed (0px), open (232px), icons (28px).
// Critical: this lives in normal flex flow so it PUSHES content right
// (no absolute positioning). Width animates via .tr-rail transition.
import { useLocation } from "wouter";
import { ChevronLeft, ChevronsRight, X } from "lucide-react";
import { useRail, RAIL_WIDTH } from "./RailContext";
import { TAB_DEEP } from "@/lib/tab-registry";

export function RailSidebar() {
  const { state, panelId, close, collapse, open } = useRail();
  const [path] = useLocation();
  const deepKey = `${path.split("/").slice(1, 3).join("/")}`;
  const deep = TAB_DEEP[deepKey] ?? [];

  return (
    <aside
      style={{ width: RAIL_WIDTH[state] }}
      className="tr-rail surf-strong relative h-full overflow-hidden shrink-0 border-r border-border/40"
      data-state={state}
    >
      {state === "open" && (
        <div className="flex flex-col h-full w-[232px] p-3">
          <header className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-display uppercase tracking-wider text-muted-foreground">
              {panelId || "Panel"}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={collapse} title="Collapse to icons" className="tr-chip p-1 rounded hover:bg-primary/10 hover:text-primary">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button onClick={close} title="Close" className="tr-chip p-1 rounded hover:bg-primary/10 hover:text-primary">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </header>
          <nav className="flex flex-col gap-1">
            {deep.length === 0 && (
              <p className="text-xs text-muted-foreground">No deep panels for this view.</p>
            )}
            {deep.map((d) => (
              <button
                key={d.id}
                onClick={() => {/* scroll to anchor / set tab — left for page-level handlers */}}
                className="tr-tab text-left text-xs px-2 py-1.5 rounded hover:bg-primary/10 hover:text-primary"
              >
                {d.label}
              </button>
            ))}
          </nav>
        </div>
      )}
      {state === "icons" && (
        <div className="flex flex-col items-center h-full w-[28px] py-3 gap-2">
          <button onClick={() => panelId && open(panelId)} title="Expand" className="tr-chip p-1 rounded hover:bg-primary/10 hover:text-primary">
            <ChevronsRight className="w-3.5 h-3.5" />
          </button>
          {deep.map((d) => (
            <span key={d.id} title={d.label} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 hover:bg-primary tr-chip" />
          ))}
        </div>
      )}
    </aside>
  );
}
