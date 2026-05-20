/**
 * ReportView — renders typed ReportBlock[] (from POST /api/composer/render-blocks)
 * Replaces raw-markdown chat output with structured cards + tables + KPIs.
 */

import { Button } from "@/components/ui/button";
import { Download, ExternalLink } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ReportBlock =
  | { type: "title"; text: string }
  | { type: "text"; text: string }
  | { type: "kpi"; kpis: Array<{ label: string; value: string; delta?: string }> }
  | { type: "table"; title?: string; headers: string[]; rows: Array<Array<string | number>> }
  | { type: "list"; title?: string; items: string[] }
  | { type: "citations"; items: Array<{ label: string; url: string }> }
  | { type: "signal"; items: Array<{ headline: string; strength: number; sourceUrl?: string; summary?: string }> };

interface Props {
  blocks: ReportBlock[];
  rawText?: string;
  shape?: "exec" | "detail" | "custom";
  title?: string;
}

export function ReportView({ blocks, rawText, shape = "detail", title = "Research Report" }: Props) {
  async function exportAs(format: string) {
    const r = await fetch(`${BASE}/api/composer/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks, rawText, shape, format, title }),
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (r.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/)?.[1] || `report.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {blocks.map((b, i) => <Block key={i} b={b} />)}
      <div className="flex flex-wrap gap-2 pt-3 mt-3 border-t border-border">
        {(["xlsx", "pdf", "html", "jsx", "pptx", "csv"] as const).map((f) => (
          <Button key={f} variant="outline" size="sm" onClick={() => exportAs(f)} className="gap-1.5 text-xs">
            <Download className="w-3 h-3" /> {f.toUpperCase()}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Block({ b }: { b: ReportBlock }) {
  if (b.type === "title") return <h2 className="text-xl font-bold">{b.text}</h2>;
  if (b.type === "text") return <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{b.text}</p>;
  if (b.type === "kpi") return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {b.kpis.map((k, i) => (
        <div key={i} className="border border-border rounded-lg p-3 bg-card/60">
          <div className="text-xl font-bold">{k.value}</div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{k.label}</div>
          {k.delta && <div className="text-[10px] text-emerald-500 mt-1">{k.delta}</div>}
        </div>
      ))}
    </div>
  );
  if (b.type === "table") return (
    <div>
      {b.title && <div className="text-sm font-bold mb-2">{b.title}</div>}
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>{b.headers.map((h, i) => <th key={i} className="text-left px-3 py-2 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">{h}</th>)}</tr>
          </thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i} className="border-t border-border hover:bg-muted/20">
                {r.map((c, j) => <td key={j} className="px-3 py-2">{String(c)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
  if (b.type === "list") return (
    <div>
      {b.title && <div className="text-sm font-bold mb-2">{b.title}</div>}
      <ul className="space-y-1">
        {b.items.map((i, idx) => <li key={idx} className="text-sm flex gap-2"><span className="text-primary">•</span>{i}</li>)}
      </ul>
    </div>
  );
  if (b.type === "citations") return (
    <div>
      <div className="text-sm font-bold mb-2">Sources</div>
      <div className="flex flex-wrap gap-1.5">
        {b.items.map((c, i) => (
          <a key={i} href={c.url} target="_blank" rel="noopener noreferrer" className="text-[11px] px-2 py-1 rounded-md bg-muted/40 hover:bg-muted/60 inline-flex items-center gap-1">
            {c.label} <ExternalLink className="w-3 h-3 opacity-60" />
          </a>
        ))}
      </div>
    </div>
  );
  if (b.type === "signal") return (
    <div>
      <div className="text-sm font-bold mb-2">📡 Signal Intelligence</div>
      <div className="space-y-2">
        {b.items.map((s, i) => (
          <div key={i} className="border border-amber-500/30 rounded-lg p-3 bg-amber-500/5">
            <div className="font-semibold text-sm">{s.headline}</div>
            {s.summary && <div className="text-xs text-muted-foreground mt-1">{s.summary}</div>}
            <div className="text-[10px] text-amber-600 mt-1">strength {s.strength}/100</div>
          </div>
        ))}
      </div>
    </div>
  );
  return null;
}
