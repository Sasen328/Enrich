// §3 Bar 3 — Sub-Tab Bar (spec markup: .subbar / .subbar-inner / .sub / .sub.on / .sub.deep)
// .sub.deep auto-appends › via CSS. Click on .deep triggers rail open.
import { Link, useLocation } from "wouter";
import { subsForPath } from "@/lib/tab-registry";
import { useRail } from "./RailContext";

export function SubTabBar() {
  const [path] = useLocation();
  const subs = subsForPath(path);
  const { open } = useRail();
  const has = subs.length > 0;

  return (
    <div className={`subbar ${has ? "has-items" : "no-items"}`}>
      <div className="subbar-inner">
        {subs.map((s) => {
          const active = path === s.url || path.startsWith(s.url + "/");
          const Icon = s.icon;
          // wrap whole sub in a div; deep items get a separate click for rail-open
          return (
            <Link
              key={s.id}
              href={s.url}
              onClick={() => { if (s.rail) setTimeout(() => open(s.id), 50); }}
              className={`sub ${active ? "on" : ""} ${s.rail ? "deep" : ""}`}
            >
              <Icon />
              {s.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
