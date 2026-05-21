// §7 — Activity Feed (6-property spec).
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

export interface ActivityItem {
  id: string;
  label: string;
  time: string;
  icon?: LucideIcon;
  accentClass?: string;
  meta?: string;
}

export function ActivityFeed({ items, className }: { items: ActivityItem[]; className?: string }) {
  return (
    <ul className={cn("surf p-4 space-y-2.5", className)}>
      {items.length === 0 && (
        <li className="text-xs text-[hsl(var(--tx-q))] py-4 text-center">No recent activity.</li>
      )}
      {items.map((it) => (
        <li key={it.id} className="flex items-start gap-3 tr-chip rounded-md p-2 hover:bg-primary/5">
          {it.icon && (
            <div className={cn("w-7 h-7 rounded-md flex items-center justify-center bg-primary/10", it.accentClass)}>
              <it.icon className="w-3.5 h-3.5" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-[hsl(var(--tx))] truncate">{it.label}</p>
            {it.meta && <p className="text-xs text-[hsl(var(--tx-q))] truncate">{it.meta}</p>}
          </div>
          <span className="text-[10px] text-[hsl(var(--tx-q))] whitespace-nowrap">{it.time}</span>
        </li>
      ))}
    </ul>
  );
}
