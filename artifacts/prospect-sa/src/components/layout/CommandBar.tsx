// §3 — Command Bar: search + global key (⌘K) shortcut to navigate.
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Search } from "lucide-react";
import { TAB_NAMES, TAB_SUBS } from "@/lib/tab-registry";

interface FlatItem { label: string; url: string; group: string; }

function flatten(): FlatItem[] {
  const out: FlatItem[] = [];
  for (const t of TAB_NAMES) out.push({ label: t.label, url: t.url, group: "Pages" });
  for (const [k, subs] of Object.entries(TAB_SUBS))
    for (const s of subs) out.push({ label: `${k} › ${s.label}`, url: s.url, group: "Sub-tabs" });
  return out;
}

export function CommandBar() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
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
    <div className="relative w-full max-w-md">
      <button
        type="button"
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        className="tr-input flex items-center gap-2 w-full px-3 py-1.5 rounded-lg bar-bg text-xs text-muted-foreground hover:text-foreground"
      >
        <Search className="w-3.5 h-3.5" />
        <span>Search pages…</span>
        <kbd className="ml-auto px-1.5 py-0.5 text-[10px] rounded border border-border/50 bg-background/40">⌘K</kbd>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full surf-strong p-2">
          <div className="flex items-center gap-2 mb-2">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Type a page or sub-tab…"
              className="flex-1 bg-transparent outline-none text-sm"
            />
          </div>
          <ul className="max-h-60 overflow-y-auto">
            {matches.length === 0 && q && (
              <li className="px-2 py-1.5 text-xs text-muted-foreground">No matches</li>
            )}
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
