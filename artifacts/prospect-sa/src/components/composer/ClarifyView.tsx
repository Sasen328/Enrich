/**
 * ClarifyView — Stage 3. Pick report shape + answer clarifying questions.
 * Per v8 prototype: Executive Summary / Detailed Report / Custom Selective.
 */

import { useState } from "react";
import { ChevronLeft, Sparkles, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ComposerState } from "./Composer";

interface Props {
  state: ComposerState | null;
  reportShape: "exec" | "detail" | "custom";
  onShapeChange: (s: "exec" | "detail" | "custom") => void;
  reportBlocks: string[];
  onBlocksChange: (b: string[]) => void;
  onBack: () => void;
  onRun: () => void;
}

const SHAPES = [
  { id: "exec",   icon: "📋", lbl: "Executive Summary", desc: "2-page narrative · 4 KPIs · NO table" },
  { id: "detail", icon: "📑", lbl: "Detailed Report",   desc: "Tables · citations · all blocks" },
  { id: "custom", icon: "🎛️", lbl: "Custom Selective",  desc: "Pick exactly which blocks render" },
] as const;

const BLOCKS = [
  "👤 Person table", "🏢 Company table", "💰 Financials KPI",
  "📡 Signal block", "🌳 Relationship tree", "✉️ Outreach drafts",
  "📈 Trend chart", "⚖️ Compliance check", "🔗 Citations",
];

export function ClarifyView({ reportShape, onShapeChange, reportBlocks, onBlocksChange, onBack, onRun }: Props) {
  return (
    <div className="border border-border rounded-xl bg-card/60 p-4 space-y-4">
      <div className="text-sm font-bold flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-amber-500" /> Clarify &amp; Report Shape
      </div>

      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/8 border border-amber-500/20 text-xs">
        <Lock className="w-3.5 h-3.5 text-amber-500" />
        <span><strong>Strict report output</strong> — shape + blocks below are honored verbatim. Executive shape will refuse to render a detailed table.</span>
      </div>

      {/* Standard clarifying questions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ClarifyChips label="Include 'Head of Engineering' / 'VP Eng'?" options={["Yes", "No — formal CTO only"]} />
        <ClarifyChips label="Min funding round?" options={["Any", "$2M+", "$10M+", "$50M+"]} defaultOn="$2M+" />
        <ClarifyChips label="Email policy" options={["DNS+MX validated", "AI-guess allowed", "Skip emails"]} defaultOn="DNS+MX validated" />
        <ClarifyChips label="Language" options={["English", "Arabic", "Bilingual"]} />
        <ClarifyChips label="Currency" options={["SAR", "USD", "Both"]} />
        <ClarifyChips label="Title verify cross-source?" options={["Yes", "No — trust primary"]} />
      </div>

      {/* Report shape */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">📄 Report shape</div>
        <div className="grid grid-cols-3 gap-2">
          {SHAPES.map((s) => (
            <button key={s.id}
              onClick={() => onShapeChange(s.id)}
              className={`p-3 rounded-lg border text-center transition-colors ${
                reportShape === s.id ? "bg-primary/15 border-primary/40 text-primary"
                : "bg-card border-border hover:border-primary/30"
              }`}>
              <div className="text-lg">{s.icon}</div>
              <div className="text-xs font-bold mt-1">{s.lbl}</div>
              <div className="text-[10px] text-muted-foreground">{s.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Custom blocks */}
      {reportShape === "custom" && (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Pick blocks</div>
          <div className="flex flex-wrap gap-1.5">
            {BLOCKS.map((b) => {
              const on = reportBlocks.includes(b);
              return (
                <button key={b}
                  onClick={() => onBlocksChange(on ? reportBlocks.filter((x) => x !== b) : [...reportBlocks, b])}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    on ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 font-semibold"
                    : "bg-card border-border text-muted-foreground hover:border-primary/30"
                  }`}>
                  {on ? "✓ " : ""}{b}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex justify-between pt-3 border-t border-dashed border-border">
        <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="w-3 h-3 mr-1" />Back</Button>
        <Button size="sm" onClick={onRun} className="gap-1">Run Research ⏵</Button>
      </div>
    </div>
  );
}

function ClarifyChips({ label, options, defaultOn }: { label: string; options: string[]; defaultOn?: string }) {
  const initial = defaultOn || options[0];
  const [active, setActive] = useState(initial);
  return (
    <div>
      <div className="text-[11px] font-semibold mb-1">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={o} onClick={() => setActive(o)}
            className={`text-[11px] px-2.5 py-1 rounded-full border ${
              active === o ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 font-semibold"
              : "bg-card border-border text-muted-foreground hover:border-primary/30"
            }`}>{active === o ? "✓ " : ""}{o}</button>
        ))}
      </div>
    </div>
  );
}

