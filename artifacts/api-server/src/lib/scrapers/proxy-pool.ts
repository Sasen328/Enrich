// §6 — Proxy pool. Rotates residential/ISP proxies so harvesting isn't IP-blocked.
// Env-driven; OFF unless NEXUS_PROXY_ENABLED=true. Degrades to "no proxy" cleanly.

export type ProxyStrategy = "per-request" | "sticky";

interface ProxyEntry { url: string; dead?: boolean; }

function loadPool(): ProxyEntry[] {
  const out: ProxyEntry[] = [];
  // WebShare: newline/comma list of host:port:user:pass or full URLs
  const ws = process.env.WEBSHARE_PROXY_LIST;
  if (ws) for (const line of ws.split(/[\n,]/).map(s => s.trim()).filter(Boolean)) {
    out.push({ url: line.startsWith("http") ? line : `http://${line}` });
  }
  // IPRoyal / LunaProxy / SimplyNode: single endpoint + creds
  for (const [u, p, e] of [
    ["IPROYAL_USER", "IPROYAL_PASS", "IPROYAL_ENDPOINT"],
    ["LUNAPROXY_USER", "LUNAPROXY_PASS", "LUNAPROXY_ENDPOINT"],
    ["SIMPLYNODE_USER", "SIMPLYNODE_PASS", "SIMPLYNODE_ENDPOINT"],
  ]) {
    const user = process.env[u], pass = process.env[p], end = process.env[e];
    if (user && pass && end) out.push({ url: `http://${user}:${pass}@${end}` });
  }
  return out;
}

let pool: ProxyEntry[] = [];
let cursor = 0;
const sticky = new Map<string, string>();

export function proxyEnabled(): boolean {
  return process.env.NEXUS_PROXY_ENABLED === "true";
}

/** Get a proxy URL (or null if disabled / pool empty). */
export function getProxy(opts: { strategy?: ProxyStrategy; sessionKey?: string } = {}): string | null {
  if (!proxyEnabled()) return null;
  if (pool.length === 0) pool = loadPool();
  const live = pool.filter(p => !p.dead);
  if (live.length === 0) return null;
  if (opts.strategy === "sticky" && opts.sessionKey) {
    if (!sticky.has(opts.sessionKey)) sticky.set(opts.sessionKey, live[cursor++ % live.length].url);
    return sticky.get(opts.sessionKey)!;
  }
  return live[cursor++ % live.length].url;
}

export function markDead(url: string): void {
  const e = pool.find(p => p.url === url);
  if (e) e.dead = true;
}

export function proxyStatus(): { enabled: boolean; total: number; live: number } {
  if (pool.length === 0) pool = loadPool();
  return { enabled: proxyEnabled(), total: pool.length, live: pool.filter(p => !p.dead).length };
}
