// §6 — ScrapeGraphAI bridge (natural-language schema extraction).
// Proxies to the Scout microservice which runs ScrapeGraphAI with the Nexus
// extraction tier as its LLM backend. Degrades to { available:false } when
// SCOUT_URL is unreachable.

export interface ScrapeGraphResult { available: boolean; url: string; data: Record<string, unknown> | null; }

export async function scrapeGraphExtract(url: string, schemaPrompt: string, timeoutMs = 60000): Promise<ScrapeGraphResult> {
  const scout = process.env.SCOUT_URL;
  if (!scout) return { available: false, url, data: null };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${scout}/scrapegraph`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, schema: schemaPrompt }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return { available: true, url, data: null };
    const data = await r.json() as Record<string, unknown>;
    return { available: true, url, data };
  } catch {
    clearTimeout(t);
    return { available: false, url, data: null };
  }
}
