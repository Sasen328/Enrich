// §4 — Glassmorphic Rail Sidebar (spec markup: .gsb / .gsb.open / .gsb.icons /
// .gsb-inner / .gsb-head / .gsb-title / .gsb-btns / .gsb-ibtn / .gsb-body /
// .gsb-item / .gsb-ico / .gsb-txt / .gsb-badge)
import { useLocation } from "wouter";
import { ChevronLeft, ChevronsRight, X, Circle } from "lucide-react";
import { useRail } from "./RailContext";
import { TAB_DEEP } from "@/lib/tab-registry";

export function RailSidebar() {
  const { state, panelId, close, collapse, open } = useRail();
  const [path] = useLocation();
  const segs = path.split("/").filter(Boolean);
  const deepKey = segs.length === 1
    ? `${segs[0]}/${({ meshbase: "overview", masaar: "cr-lookup", "lead-factory": "person" } as Record<string, string>)[segs[0]] ?? ""}`
    : segs.slice(0, 2).join("/");
  const deep = TAB_DEEP[deepKey] ?? [];

  const cls = `gsb ${state === "open" ? "open" : state === "icons" ? "icons" : ""}`;
  return (
    <aside className={cls} data-state={state}>
      <div className="gsb-inner">
        <header className="gsb-head">
          <span className="gsb-title">{panelId ?? "Panel"}</span>
          <div className="gsb-btns">
            <button className="gsb-ibtn" onClick={collapse} title="Collapse"><ChevronLeft /></button>
            <button className="gsb-ibtn" onClick={() => panelId && open(panelId)} title="Expand"><ChevronsRight /></button>
            <button className="gsb-ibtn" onClick={close} title="Close"><X /></button>
          </div>
        </header>
        <div className="gsb-body">
          {deep.length === 0 && (
            <p className="text-[11px] text-muted-foreground px-2 py-1">No deep panels here.</p>
          )}
          {deep.map((d) => (
            <button
              key={d.id}
              data-tip={d.label}
              className="gsb-item"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.location.hash = d.id;
                  const el = document.getElementById(d.id);
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }
              }}
            >
              <span className="gsb-ico"><Circle /></span>
              <span className="gsb-txt">{d.label}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
