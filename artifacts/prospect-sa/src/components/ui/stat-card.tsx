// §7 — Stat Card (10-property spec).
// Use across Dashboard, MeshBase Overview, Lead Factory Results.
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
}

export function StatCard({
  label, value, sub, icon: Icon, trend, unit,
  accentClass = "text-primary", bgClass = "bg-primary/10",
  loading, className,
}: StatCardProps) {
  return (
    <div className={cn("surf p-5 tr-card hover:-translate-y-0.5", className)}>
      {Icon && (
        <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center mb-4", bgClass)}>
          <Icon className={cn("w-5 h-5", accentClass)} />
        </div>
      )}
      <p className="text-[11px] uppercase tracking-wider text-[hsl(var(--tx-q))] mb-1">{label}</p>
      {loading || value === null ? (
        <div className="h-7 w-20 rounded bg-muted/40 animate-pulse" />
      ) : (
        <h3 className="text-2xl font-display font-bold text-[hsl(var(--tx))]">
          {value}{unit && <span className="text-base ml-1 text-[hsl(var(--tx-m))]">{unit}</span>}
        </h3>
      )}
      {(sub || typeof trend === "number") && (
        <p className="text-xs text-[hsl(var(--tx-q))] mt-1 flex items-center gap-1.5">
          {typeof trend === "number" && (
            <span className={cn("font-medium", trend >= 0 ? "text-emerald-500" : "text-rose-500")}>
              {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}%
            </span>
          )}
          {sub}
        </p>
      )}
    </div>
  );
}
