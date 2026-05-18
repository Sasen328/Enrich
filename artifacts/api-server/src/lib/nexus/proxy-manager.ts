/**
 * NEXUS — Proxy & Identity Rotation Manager
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Manages a pool of rotating proxies across multiple providers.
 * Automatically escalates from free → cheap → residential → mobile.
 *
 * Provider chain (in priority order):
 *   1. WebShare      — 10 free residential proxies, 1GB/month
 *   2. IPRoyal       — $1.75/GB PAYG, 32M+ IPs, never-expiring bandwidth
 *   3. LunaProxy     — $0.70/GB, 200M+ IPs, lowest per-GB price
 *   4. SimplyNode    — $2.50/GB, 50M+ IPs including 5G mobile
 *
 * Rotation strategies:
 *   per-request  — New IP for every HTTP request (aggressive scraping)
 *   sticky-15    — Same IP for 15 minutes (account-based, session tasks)
 *   sticky-30    — Same IP for 30 minutes (long registry lookups)
 *   mobile       — 5G mobile IPs only (SimplyNode, most human-like)
 *
 * Environment variables:
 *   WEBSHARE_PROXY_LIST        — comma-separated "host:port:user:pass" entries
 *   IPROYAL_USER               — IPRoyal username
 *   IPROYAL_PASS               — IPRoyal password
 *   IPROYAL_ENDPOINT           — IPRoyal gate endpoint (default: geo.iproyal.com:12321)
 *   LUNAPROXY_USER             — LunaProxy username
 *   LUNAPROXY_PASS             — LunaProxy password
 *   LUNAPROXY_ENDPOINT         — LunaProxy gate (default: gate.lunaproxy.com:12233)
 *   SIMPLYNODE_USER            — SimplyNode username
 *   SIMPLYNODE_PASS            — SimplyNode password
 *   SIMPLYNODE_ENDPOINT        — SimplyNode gate (default: gate.simplynode.io:9000)
 *   NEXUS_PROXY_ENABLED        — set "false" to disable proxies entirely
 */

export type ProxyStrategy = "per-request" | "sticky-15" | "sticky-30" | "mobile";
export type ProxyProvider = "webshare" | "iproyal" | "lunaproxy" | "simplynode" | "direct";

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  provider: ProxyProvider;
}

export interface ProxyResult {
  config: ProxyConfig | null;
  proxyUrl: string | null;
  /** Formatted for Playwright's proxy option */
  playwrightProxy: { server: string; username?: string; password?: string } | null;
  /** Formatted for Axios */
  axiosProxy: { host: string; port: number; auth?: { username: string; password: string }; protocol: "http" } | null;
}

// ── Sticky session store ───────────────────────────────────────────────────────

interface StickySession {
  proxy: ProxyConfig;
  expiresAt: number;
}

const stickySessions = new Map<string, StickySession>();

function getStickyKey(strategy: ProxyStrategy, sessionId?: string): string {
  return `${strategy}-${sessionId || "default"}`;
}

function getStickyProxy(strategy: ProxyStrategy, sessionId?: string): ProxyConfig | null {
  const key = getStickyKey(strategy, sessionId);
  const session = stickySessions.get(key);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    stickySessions.delete(key);
    return null;
  }
  return session.proxy;
}

function setStickyProxy(strategy: ProxyStrategy, proxy: ProxyConfig, sessionId?: string): void {
  const key = getStickyKey(strategy, sessionId);
  const ttlMs = strategy === "sticky-30" ? 30 * 60 * 1000 : 15 * 60 * 1000;
  stickySessions.set(key, { proxy, expiresAt: Date.now() + ttlMs });
}

// ── WebShare pool (static list from env) ──────────────────────────────────────

let websharePool: ProxyConfig[] = [];
let webshareIndex = 0;

function loadWebsharePool(): void {
  const raw = process.env.WEBSHARE_PROXY_LIST || "";
  if (!raw.trim()) return;
  websharePool = raw.split(",").map(entry => {
    const [host, port, username, password] = entry.trim().split(":");
    return { host, port: parseInt(port || "80"), username, password, provider: "webshare" as const };
  }).filter(p => p.host && p.port);
}
loadWebsharePool();

function getWebshareProxy(): ProxyConfig | null {
  if (!websharePool.length) return null;
  const proxy = websharePool[webshareIndex % websharePool.length];
  webshareIndex++;
  return proxy;
}

// ── Gateway proxy builders (IPRoyal / LunaProxy / SimplyNode) ─────────────────
// These providers use rotating gateway endpoints — each request gets a new IP.
// For sticky sessions, the username includes a session token.

function buildGatewayProxy(
  provider: ProxyProvider,
  strategy: ProxyStrategy
): ProxyConfig | null {
  let envUser = "";
  let envPass = "";
  let defaultEndpoint = "";

  if (provider === "iproyal") {
    envUser = process.env.IPROYAL_USER || "";
    envPass = process.env.IPROYAL_PASS || "";
    defaultEndpoint = process.env.IPROYAL_ENDPOINT || "geo.iproyal.com:12321";
  } else if (provider === "lunaproxy") {
    envUser = process.env.LUNAPROXY_USER || "";
    envPass = process.env.LUNAPROXY_PASS || "";
    defaultEndpoint = process.env.LUNAPROXY_ENDPOINT || "gate.lunaproxy.com:12233";
  } else if (provider === "simplynode") {
    envUser = process.env.SIMPLYNODE_USER || "";
    envPass = process.env.SIMPLYNODE_PASS || "";
    defaultEndpoint = process.env.SIMPLYNODE_ENDPOINT || "gate.simplynode.io:9000";
  }

  if (!envUser || !envPass) return null;

  const [host, portStr] = defaultEndpoint.split(":");
  const port = parseInt(portStr || "80");

  // For sticky sessions, append session token to username
  let username = envUser;
  if (strategy === "sticky-15" || strategy === "sticky-30") {
    const sessionToken = Math.random().toString(36).slice(2, 10);
    username = `${envUser}-session-${sessionToken}`;
  }
  if (strategy === "mobile" && provider === "simplynode") {
    username = `${envUser}-type-mobile`;
  }

  return { host, port, username, password: envPass, provider };
}

// ── Main proxy getter ──────────────────────────────────────────────────────────

/**
 * Get the best available proxy for the given strategy.
 * Returns null if no proxies are configured (direct connection).
 */
export function getProxy(
  strategy: ProxyStrategy = "per-request",
  sessionId?: string
): ProxyResult {
  if (process.env.NEXUS_PROXY_ENABLED === "false") {
    return { config: null, proxyUrl: null, playwrightProxy: null, axiosProxy: null };
  }

  // ── Sticky session: reuse existing proxy if not expired ───────────────────
  if (strategy !== "per-request") {
    const sticky = getStickyProxy(strategy, sessionId);
    if (sticky) return buildProxyResult(sticky);
  }

  // ── Provider priority chain ───────────────────────────────────────────────
  let proxy: ProxyConfig | null = null;

  if (strategy === "mobile") {
    proxy = buildGatewayProxy("simplynode", strategy);
  }

  if (!proxy) proxy = getWebshareProxy();
  if (!proxy) proxy = buildGatewayProxy("iproyal", strategy);
  if (!proxy) proxy = buildGatewayProxy("lunaproxy", strategy);
  if (!proxy) proxy = buildGatewayProxy("simplynode", strategy);

  if (!proxy) {
    return { config: null, proxyUrl: null, playwrightProxy: null, axiosProxy: null };
  }

  // Store sticky session
  if (strategy !== "per-request") {
    setStickyProxy(strategy, proxy, sessionId);
  }

  return buildProxyResult(proxy);
}

function buildProxyResult(config: ProxyConfig): ProxyResult {
  const auth = config.username && config.password
    ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
    : "";
  const proxyUrl = `http://${auth}${config.host}:${config.port}`;

  const playwrightProxy: ProxyResult["playwrightProxy"] = {
    server: `http://${config.host}:${config.port}`,
    ...(config.username ? { username: config.username } : {}),
    ...(config.password ? { password: config.password } : {}),
  };

  const axiosProxy: ProxyResult["axiosProxy"] = {
    host: config.host,
    port: config.port,
    protocol: "http",
    ...(config.username && config.password
      ? { auth: { username: config.username, password: config.password } }
      : {}),
  };

  return { config, proxyUrl, playwrightProxy, axiosProxy };
}

// ── Status ─────────────────────────────────────────────────────────────────────

export interface ProxyStatus {
  enabled: boolean;
  providers: {
    webshare: { configured: boolean; poolSize: number };
    iproyal: { configured: boolean };
    lunaproxy: { configured: boolean };
    simplynode: { configured: boolean };
  };
  activeProviders: string[];
  activeStickySessionCount: number;
}

export function getProxyStatus(): ProxyStatus {
  const enabled = process.env.NEXUS_PROXY_ENABLED !== "false";

  const webshareOk = websharePool.length > 0;
  const iproyalOk = !!(process.env.IPROYAL_USER && process.env.IPROYAL_PASS);
  const lunaOk = !!(process.env.LUNAPROXY_USER && process.env.LUNAPROXY_PASS);
  const simplyOk = !!(process.env.SIMPLYNODE_USER && process.env.SIMPLYNODE_PASS);

  const active: string[] = [];
  if (webshareOk) active.push("webshare");
  if (iproyalOk) active.push("iproyal");
  if (lunaOk) active.push("lunaproxy");
  if (simplyOk) active.push("simplynode");

  return {
    enabled,
    providers: {
      webshare: { configured: webshareOk, poolSize: websharePool.length },
      iproyal: { configured: iproyalOk },
      lunaproxy: { configured: lunaOk },
      simplynode: { configured: simplyOk },
    },
    activeProviders: active,
    activeStickySessionCount: stickySessions.size,
  };
}

export function clearStickySessions(): void {
  stickySessions.clear();
}
