// §3 Bar 2 — Smart Tab Bar (spec markup: .tabbar / .tab / .tab.on / .t-add)
import { Link, useLocation } from "wouter";
import { TAB_NAMES } from "@/lib/tab-registry";
import { Plus } from "lucide-react";

export function MainTabBar() {
  const [path] = useLocation();
  const matchActive = (url: string) => {
    if (url === "/") return path === "/";
    const root = "/" + url.split("/").filter(Boolean)[0];
    return path === root || path.startsWith(root + "/");
  };
  return (
    <nav className="tabbar">
      {TAB_NAMES.map((t) => {
        const active = matchActive(t.url);
        const Icon = t.icon;
        return (
          <Link key={t.id} href={t.url} className={`tab ${active ? "on" : ""}`}>
            <Icon className="w-3 h-3" />
            {t.label}
          </Link>
        );
      })}
      <button className="t-add" title="Open new tab">
        <Plus />
      </button>
    </nav>
  );
}
