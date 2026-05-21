// §3 Bar 1 — Command Bar (spec markup: .cmd / .cmd-row / .app-logo / .cmd-search + .chips-row)
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { TAB_NAMES, TAB_SUBS } from "@/lib/tab-registry";

interface FlatItem { label: string; url: string; group: string; }

function flatten(): FlatItem[] {
  const out: FlatItem[] = [];
  for (const t of TAB_NAMES) out.push({ label: t.label, url: t.url, group: "Pages" });
  for (const [k, subs] of Object.entries(TAB_SUBS))
    for (const s of subs) out.push({ label: `${k} › ${s.label}`, url: s.url, group: "Sub-tabs" });
  return out;
}

const CHIPS = [
  { id: "enhance", label: "Enhance prompts" },
  { id: "stream",  label: "Stream agent" },
  { id: "trace",   label: "Show trace" },
  { id: "rtl",     label: "Arabic-first" },
  { id: "compact", label: "Compact view" },
] as const;

export function CommandBar() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [chips, setChips] = useState<Record<string, boolean>>({ enhance: true, stream: true });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [, navigate] = useLocation();
  const all = flatten();
  const matches = q ? all.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <div className="cmd">
      <div className="cmd-row">
        <span className="app-logo">Prospect<em>SA</em></span>
        <button
          type="button"
          className="cmd-search"
          onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        >
          <span>⌘K — Search pages, sub-tabs, leads…</span>
        </button>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_hsl(var(--glow)/0.40)] animate-pulse" />
          <span>System Operational</span>
        </div>
      </div>
      <div className="chips-row">
        {CHIPS.map((c) => (
          <button
            key={c.id}
            className={`chip ${chips[c.id] ? "on" : ""}`}
            onClick={() => setChips((s) => ({ ...s, [c.id]: !s[c.id] }))}
          >
            {c.label}
          </button>
        ))}
      </div>
      {open && (
        <div className="surf-strong p-2 absolute top-[68px] left-4 right-4 z-50 max-w-md">
          <div className="flex items-center gap-2 mb-2">
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Type a page or sub-tab…"
              className="flex-1 bg-transparent outline-none text-sm"
            />
            <button onClick={() => setOpen(false)} className="text-xs text-muted-foreground">esc</button>
          </div>
          <ul className="max-h-60 overflow-y-auto">
            {matches.length === 0 && q && <li className="px-2 py-1.5 text-xs text-muted-foreground">No matches</li>}
            {matches.map((m) => (
              <li key={m.url}>
                <button
                  onClick={() => { navigate(m.url); setOpen(false); setQ(""); }}
                  className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-primary/10 hover:text-primary"
                >
                  <span className="text-muted-foreground">{m.group}</span> · {m.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
