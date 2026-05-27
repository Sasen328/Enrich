// §6 — Camoufox engine-level stealth (power-scraper Layer 3).
// Optional dependency: only used when `camoufox` is installed AND
// CAMOUFOX_ENABLED=true. Otherwise power-scraper skips L3 and falls to L4/L5.

export function camoufoxAvailable(): boolean {
  if (process.env.CAMOUFOX_ENABLED !== "true") return false;
  try { require.resolve("camoufox-js"); return true; } catch { return false; }
}

/** Fetch a page through Camoufox. Returns null if unavailable so the caller
 *  escalates to the next layer. */
export async function camoufoxFetch(url: string, _opts: { timeoutMs?: number } = {}): Promise<string | null> {
  if (!camoufoxAvailable()) return null;
  try {
    // Lazy import so the bundle doesn't hard-depend on camoufox.
    const mod: any = await import("camoufox-js").catch(() => null);
    if (!mod?.launch) return null;
    const browser = await mod.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    const html = await page.content();
    await browser.close();
    return html;
  } catch {
    return null;
  }
}
