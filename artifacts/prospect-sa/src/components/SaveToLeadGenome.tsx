// Drop-in button that pushes a single lead row into Lead Genome from any
// engine page. Usage:
//
//   <SaveToLeadGenome
//     source="lead-factory"
//     lead={{ firstName, lastName, title, email }}
//   />
import { useState } from "react";
import { Heart, Check, Loader2 } from "lucide-react";
import { saveToLeadGenome, type SaveLeadInput, type LeadSource } from "@/lib/lead-genome-client";
import { cn } from "@/lib/utils";

interface Props {
  source: LeadSource;
  lead: Omit<SaveLeadInput, "source">;
  size?: "sm" | "md";
  className?: string;
}

export function SaveToLeadGenome({ source, lead, size = "sm", className }: Props) {
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const onClick = async () => {
    if (state !== "idle") return;
    setState("saving");
    try {
      await saveToLeadGenome({ ...lead, source });
      setState("done");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2000);
    }
  };
  const Icon = state === "done" ? Check : state === "saving" ? Loader2 : Heart;
  const labels: Record<typeof state, string> = {
    idle:   "Save to Lead Genome",
    saving: "Saving…",
    done:   "Saved",
    error:  "Failed — retry",
  };
  return (
    <button
      onClick={onClick}
      disabled={state === "saving" || state === "done"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium transition-all duration-200 border",
        size === "sm" ? "text-[10px] px-2.5 py-1" : "text-xs px-3 py-1.5",
        state === "done"
          ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
          : state === "error"
          ? "bg-rose-500/15 text-rose-600 border-rose-500/30"
          : "bg-[hsl(var(--brand-mist))]/40 text-[hsl(var(--ac))] border-[hsl(var(--ac))]/30 hover:bg-[hsl(var(--brand-mist))]/70 hover:shadow-[0_4px_14px_hsl(var(--glow)/0.25)]",
        className,
      )}
    >
      <Icon className={cn(size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5", state === "saving" && "animate-spin")} />
      {labels[state]}
    </button>
  );
}
