// §7 — Stat Card matched to prototype.
// Big Playfair display value + small label + status badge bottom-left.
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

export interface StatCardProps {
  label: string;
  value: string | number | null;
  sub?: string;
  icon?: LucideIcon;
  trend?: number;
  unit?: string;
  accentClass?: string;
  bgClass?: string;
  href?: string;
  loading?: boolean;
  className?: string;
  badge?: { label: string; tone?: "live" | "good" | "active" | "neutral" };
}

const BADGE_TONES: Record<string, string> = {
  live:    "bg-emerald-500/12 text-emerald-600 border-emerald-500/30",
  good:    "bg-emerald-500/12 text-emerald-600 border-emerald-500/30",
  active:  "bg-emerald-500/12 text-emerald-600 border-emerald-500/30",
  neutral: "bg-[hsl(var(--brand-mist))]/40 text-[hsl(var(--ac))] border-[hsl(var(--brand-mist))]",
};

export function StatCard({
  label, value, sub, icon: Icon, trend, unit,
  accentClass = "text-[hsl(var(--ac))]", bgClass = "bg-[hsl(var(--brand-mist))]/40",
  loading, className, badge,
}: StatCardProps) {
  return (
    <div className={cn(
      "surf p-5 tr-card hover:-translate-y-0.5 group relative overflow-hidden",
      className,
    )}>
      {Icon && (
        <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center mb-3", bgClass)}>
          <Icon className={cn("w-4 h-4", accentClass)} />
        </div>
      )}
      {loading || value === null ? (
        <div className="h-9 w-20 rounded bg-muted/40 animate-pulse" />
      ) : (
        <h3 className="font-display font-bold text-[hsl(var(--tx))] leading-none text-3xl md:text-4xl">
          {value}{unit && <span className="text-base ml-1 text-[hsl(var(--tx-m))] font-medium">{unit}</span>}
        </h3>
      )}
      <p className="text-[11px] uppercase tracking-wider text-[hsl(var(--tx-q))] mt-2 font-medium">{label}</p>
      {(sub || typeof trend === "number" || badge) && (
        <div className="flex items-center gap-1.5 mt-3">
          {badge && (
            <span className={cn(
              "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border",
              BADGE_TONES[badge.tone ?? "neutral"],
            )}>
              {badge.tone === "live" && <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse" />}
              {badge.label}
            </span>
          )}
          {typeof trend === "number" && (
            <span className={cn("text-[10px] font-bold", trend >= 0 ? "text-emerald-600" : "text-rose-500")}>
              {trend >= 0 ? "+" : ""}{trend} {trend >= 0 ? "↑" : "↓"}
            </span>
          )}
          {sub && <span className="text-[10px] text-[hsl(var(--tx-q))]">{sub}</span>}
        </div>
      )}
    </div>
  );
}
