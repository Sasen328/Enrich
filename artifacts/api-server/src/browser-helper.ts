import axios from "axios";
import * as cheerio from "cheerio";
import net from "net";

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return true;
  if (parts[0] === 0) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] >= 224) return true;
  return false;
}

function isPrivateHost(hostname: string): boolean {
  const clean = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (clean === "localhost") return true;
  if (clean === "::1" || clean === "::") return true;
  if (clean.startsWith("fe80:") || clean.startsWith("fc") || clean.startsWith("fd")) return true;
  if (clean === "metadata.google.internal") return true;
  if (net.isIPv4(clean)) return isPrivateIPv4(clean);
  return false;
}

function validateRedirectTarget(redirectUrl: string): void {
  try {
    const parsed = new URL(redirectUrl);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    if (isPrivateHost(hostname)) {
      throw new Error(`Redirect to private address blocked: ${hostname}`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Redirect to private")) throw e;
  }
}

export async function getPageContent(url: string, options?: { waitMs?: number }): Promise<string> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      page.on("response", (response) => {
        const status = response.status();
        if (status >= 300 && status < 400) {
          const location = response.headers()["location"];
          if (location) {
            try {
              const absoluteUrl = new URL(location, response.url()).href;
              validateRedirectTarget(absoluteUrl);
            } catch (e) {
              if (e instanceof Error && e.message.startsWith("Redirect to private")) {
                page.close().catch(() => {});
              }
            }
          }
        }
      });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

      if (options?.waitMs) {
        await page.waitForTimeout(options.waitMs);
      }

      const finalUrl = page.url();
      validateRedirectTarget(finalUrl);

      const content = await page.content();
      return content;
    } finally {
      await browser.close();
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Redirect to private")) throw e;

    const response = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      beforeRedirect: (options: Record<string, unknown>) => {
        const redirectHost = (options as { hostname?: string }).hostname;
        if (redirectHost && isPrivateHost(redirectHost)) {
          throw new Error(`Redirect to private address blocked: ${redirectHost}`);
        }
      },
    } as Parameters<typeof axios.get>[1]);
    return response.data as string;
  }
}

export function parseHtml(html: string): cheerio.CheerioAPI {
  return cheerio.load(html);
}
