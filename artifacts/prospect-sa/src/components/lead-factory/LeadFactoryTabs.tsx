import { Link, useLocation } from "wouter";
import { Users, Building2, Activity, GitFork, FileBarChart } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/lead-factory/person",       label: "Person Hunt",     icon: Users,        match: /^\/lead-factory\/person/ },
  { href: "/lead-factory/company",      label: "Company Hunt",    icon: Building2,    match: /^\/lead-factory\/company/ },
  { href: "/lead-factory/results",      label: "Results",         icon: FileBarChart, match: /^\/lead-factory\/results/ },
  { href: "/lead-factory/signals",      label: "Signals",         icon: Activity,     match: /^\/lead-factory\/signals/ },
  { href: "/lead-factory/relationship", label: "Relationship",    icon: GitFork,      match: /^\/lead-factory\/relationship/ },
];

/** Top-level tab strip for the Lead Factory engine. Renders on every page
 *  under /lead-factory/* so the user understands Signal + Relationship
 *  intel are tools INSIDE Lead Factory, not separate features. */
export function LeadFactoryTabs() {
  const [path] = useLocation();
  return (
    <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1 border-b border-border/40">
      {TABS.map(({ href, label, icon: Icon, match }) => {
        const isActive = match.test(path);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-t-md whitespace-nowrap border-b-2 -mb-px transition-all duration-280 ease-[cubic-bezier(0.16,1,0.30,1)]",
              isActive
                ? "border-primary text-primary bg-primary/10 shadow-[0_0_12px_hsl(var(--glow)/0.30)]"
                : "border-transparent text-muted-foreground hover:text-primary hover:bg-primary/5",
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
