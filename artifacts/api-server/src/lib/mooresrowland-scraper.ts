/**
 * Professional Services Firm Directory Scrapers
 * ─────────────────────────────────────────────────────────────────────────────
 * Targets:
 *   1. mooresrowland.net/en/members        — Moores Rowland member firms
 *   2. gcc-chambers.com                    — GCC Chambers of Commerce
 *   3. arabbritishchamber.com/members      — Arab-British Chamber of Commerce
 *   4. amcham.org.sa/members               — AmCham Saudi Arabia
 *   5. jcc.com.sa                          — Jeddah Chamber of Commerce members
 *   6. riyadhchamber.com                   — Riyadh Chamber member directory
 *   7. saudibbc.org                        — Saudi British Business Council
 *   8. fcc.org.sa                          — French Chamber of Commerce KSA
 *   9. gdksa.org                           — German-Arab Chamber (GACIC)
 *  10. icaew.com/about-icaew/find-a-chartered-accountant — ICAEW SA members
 *
 * All scrapers:
 *   - Filter for Saudi Arabia profiles only
 *   - Open each individual profile page to extract full contact data
 *   - Return CompanyData[] ready for upsert into masarCompaniesTable
 */

import axios from "axios";
import * as cheerio from "cheerio";
import { EventEmitter } from "events";

export interface ScrapedMember {
  nameEn?: string;
  nameAr?: string;
  website?: string;
  phone?: string;
  email?: string;
  city?: string;
  region?: string;
  mainActivity?: string;
  description?: string;
  source: string;
  sourceUrl?: string;
  country?: string;
  contactPerson?: string;
  contactTitle?: string;
}

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
};

async function fetchHtml(url: string, timeoutMs = 20000): Promise<string> {
  try {
    const res = await axios.get<string>(url, {
      timeout: timeoutMs,
      headers: BROWSER_HEADERS,
      maxRedirects: 5,
    });
    const html = res.data as string;
    if (typeof html === "string" && html.length > 300) return html;
    return "";
  } catch {
    try {
      // Fallback: try with different headers to bypass basic blocks
      const res = await axios.get<string>(url, {
        timeout: timeoutMs,
        headers: {
          ...BROWSER_HEADERS,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        },
        maxRedirects: 5,
      });
      return typeof res.data === "string" ? res.data : "";
    } catch {
      return "";
    }
  }
}

function extractText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, noscript, iframe, aside").remove();
  return $("body").text().replace(/\s{3,}/g, "  ").trim().slice(0, 8000);
}

function extractLinks($: cheerio.CheerioAPI, baseUrl: string, filterPatterns: RegExp[]): string[] {
  const links: string[] = [];
  const base = new URL(baseUrl);

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    let full: string;
    try {
      full = href.startsWith("http") ? href : new URL(href, base.origin + base.pathname).href;
    } catch {
      return;
    }
    if (filterPatterns.some(p => p.test(full))) {
      links.push(full);
    }
  });

  return [...new Set(links)];
}

function isSaudiRelated(text: string): boolean {
  const lc = text.toLowerCase();
  return (
    lc.includes("saudi") ||
    lc.includes("ksa") ||
    lc.includes("riyadh") ||
    lc.includes("jeddah") ||
    lc.includes("dammam") ||
    lc.includes("khobar") ||
    lc.includes("al-khobar") ||
    lc.includes("مملكة") ||
    lc.includes("السعودية") ||
    lc.includes("الرياض") ||
    lc.includes("جدة") ||
    lc.includes("الدمام")
  );
}

function extractSaudiCity(text: string): string | undefined {
  const lc = text.toLowerCase();
  if (lc.includes("riyadh") || lc.includes("الرياض")) return "Riyadh";
  if (lc.includes("jeddah") || lc.includes("jidda") || lc.includes("جدة")) return "Jeddah";
  if (lc.includes("dammam") || lc.includes("الدمام")) return "Dammam";
  if (lc.includes("khobar") || lc.includes("الخبر")) return "Al Khobar";
  if (lc.includes("mecca") || lc.includes("makkah") || lc.includes("مكة")) return "Makkah";
  if (lc.includes("medina") || lc.includes("المدينة")) return "Madinah";
  if (lc.includes("jubail") || lc.includes("الجبيل")) return "Jubail";
  if (lc.includes("yanbu") || lc.includes("ينبع")) return "Yanbu";
  if (lc.includes("abha") || lc.includes("أبها")) return "Abha";
  if (lc.includes("tabuk") || lc.includes("تبوك")) return "Tabuk";
  return undefined;
}

// ─── 1. Moores Rowland (mooresrowland.net) ────────────────────────────────────

export async function scrapeMooresRowland(
  emitLog?: (msg: string) => void
): Promise<ScrapedMember[]> {
  const results: ScrapedMember[] = [];
  const log = emitLog || ((m: string) => console.log(`[MooresRowland] ${m}`));

  log("Fetching member list from mooresrowland.net/en/members...");

  const membersHtml = await fetchHtml("https://www.mooresrowland.net/en/members", 25000);
  if (!membersHtml) {
    log("⚠ Could not fetch mooresrowland.net members page — trying /members directly...");
    const alt = await fetchHtml("https://mooresrowland.net/members", 20000);
    if (!alt) return results;
  }

  const $ = cheerio.load(membersHtml || "");

  // Try multiple selectors for member cards
  const memberLinks: Array<{ href: string; text: string; parentText: string }> = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text().trim();
    const parentText = $(el).parent().text().trim();

    // Match profile/member detail links
    if (
      /\/(en\/)?members?\//i.test(href) ||
      /\/(en\/)?firm\//i.test(href) ||
      /\/(en\/)?office\//i.test(href) ||
      /\/(en\/)?partner\//i.test(href)
    ) {
      const full = href.startsWith("http") ? href : `https://www.mooresrowland.net${href.startsWith("/") ? "" : "/"}${href}`;
      memberLinks.push({ href: full, text, parentText });
    }
  });

  // Also look for Saudi-related entries in member cards
  const saudiMemberLinks = memberLinks.filter(l =>
    isSaudiRelated(l.text) || isSaudiRelated(l.parentText) || isSaudiRelated(l.href)
  );

  // If no country-filtered links, take all and filter by profile content
  const linksToProcess = saudiMemberLinks.length > 0 ? saudiMemberLinks : memberLinks;
  log(`Found ${memberLinks.length} member links, ${saudiMemberLinks.length} Saudi-flagged. Processing ${Math.min(linksToProcess.length, 50)} profiles...`);

  // Also try to find Saudi entries directly on the page
  // Some directories render all countries on one page
  $(".member-card, .member-item, .firm-card, .card, article, .listing-item").each((_, el) => {
    const cardText = $(el).text();
    if (!isSaudiRelated(cardText)) return;

    const link = $(el).find("a[href]").first();
    const href = link.attr("href") || "";
    if (!href) return;

    const full = href.startsWith("http") ? href : `https://www.mooresrowland.net${href.startsWith("/") ? "" : "/"}${href}`;
    if (!linksToProcess.some(l => l.href === full)) {
      linksToProcess.push({ href: full, text: link.text().trim(), parentText: cardText });
    }
  });

  // Process each profile (max 50, in batches of 5)
  const uniqueLinks = [...new Map(linksToProcess.map(l => [l.href, l])).values()].slice(0, 50);

  for (let i = 0; i < uniqueLinks.length; i += 5) {
    const batch = uniqueLinks.slice(i, i + 5);
    const batchResults = await Promise.allSettled(
      batch.map(l => scrapeMooresRowlandProfile(l.href, l.text))
    );

    for (const r of batchResults) {
      if (r.status === "fulfilled" && r.value) {
        // Only keep Saudi Arabia entries
        if (r.value.country === "Saudi Arabia" || isSaudiRelated(JSON.stringify(r.value))) {
          results.push(r.value);
        }
      }
    }

    await new Promise(r => setTimeout(r, 800));
  }

  log(`✅ MooresRowland: found ${results.length} Saudi member firms`);
  return results;
}

async function scrapeMooresRowlandProfile(profileUrl: string, fallbackName: string): Promise<ScrapedMember | null> {
  const html = await fetchHtml(profileUrl, 15000);
  if (!html) return null;

  const $ = cheerio.load(html);
  const text = extractText(html);

  // Extract name from heading or title
  const nameEn =
    $("h1").first().text().trim() ||
    $("h2").first().text().trim() ||
    $("title").text().replace(/\|.*$/, "").trim() ||
    fallbackName;

  // Country check
  const fullText = $("body").text();
  if (!isSaudiRelated(fullText)) return null;

  // Extract contact details
  const emailMatch = fullText.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
  const phoneMatch = fullText.match(/(?:\+966|00966|0966|966)?[\s-]?(?:5\d{8}|[1-4]\d{7})/);
  const websiteEl = $("a[href^='http']").filter((_, el) => {
    const h = $(el).attr("href") || "";
    return !h.includes("mooresrowland") && !h.includes("facebook") && !h.includes("linkedin") && !h.includes("twitter");
  }).first();

  const website = websiteEl.attr("href") || undefined;
  const city = extractSaudiCity(fullText);

  // Extract description from first meaningful paragraph
  let description = "";
  $("p").each((_, el) => {
    const p = $(el).text().trim();
    if (p.length > 80 && !description) description = p;
  });

  return {
    nameEn: nameEn || undefined,
    website,
    phone: phoneMatch?.[0]?.trim(),
    email: emailMatch?.[0]?.toLowerCase(),
    city,
    region: city ? "Saudi Arabia" : undefined,
    country: "Saudi Arabia",
    description: description.slice(0, 400) || undefined,
    mainActivity: "Accounting and Audit",
    source: "mooresrowland",
    sourceUrl: profileUrl,
  };
}

// ─── 2. Arab British Chamber of Commerce ──────────────────────────────────────

export async function scrapeArabBritishChamber(emitLog?: (msg: string) => void): Promise<ScrapedMember[]> {
  const results: ScrapedMember[] = [];
  const log = emitLog || ((m: string) => console.log(`[ArabBritishChamber] ${m}`));
  log("Fetching Arab British Chamber member directory...");

  const urls = [
    "https://www.arabbritishchamber.com/en/members",
    "https://www.arabbritishchamber.com/members/",
    "https://arabbritishchamber.com/members/member-directory",
  ];

  let html = "";
  for (const url of urls) {
    html = await fetchHtml(url, 20000);
    if (html.length > 300) break;
  }
  if (!html) return results;

  const $ = cheerio.load(html);
  const profileLinks = extractLinks($, "https://www.arabbritishchamber.com", [
    /\/member(s)?\/[^/]+\/?$/,
    /\/company\/[^/]+\/?$/,
  ]);

  log(`Found ${profileLinks.length} profile links. Scanning for Saudi entries...`);

  for (let i = 0; i < Math.min(profileLinks.length, 80); i += 5) {
    const batch = profileLinks.slice(i, i + 5);
    await Promise.allSettled(batch.map(async (url) => {
      const profileHtml = await fetchHtml(url, 12000);
      if (!profileHtml) return;
      const pText = extractText(profileHtml);
      if (!isSaudiRelated(pText)) return;

      const p$ = cheerio.load(profileHtml);
      const nameEn = p$("h1, h2").first().text().trim();
      if (!nameEn) return;

      const emailMatch = pText.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
      const phoneMatch = pText.match(/(?:\+966|00966|\+44)[0-9 ()-]{7,15}/);
      const websiteLink = p$("a[href^='http']").filter((_, el) => {
        const h = p$(el).attr("href") || "";
        return !h.includes("arabbritishchamber") && !h.includes("facebook") && !h.includes("linkedin");
      }).first().attr("href");

      results.push({
        nameEn,
        website: websiteLink,
        phone: phoneMatch?.[0]?.trim(),
        email: emailMatch?.[0]?.toLowerCase(),
        city: extractSaudiCity(pText),
        country: "Saudi Arabia",
        mainActivity: "British-Arab trade and business",
        source: "arabbritishchamber",
        sourceUrl: url,
      });
    }));
    await new Promise(r => setTimeout(r, 600));
  }

  log(`✅ Arab British Chamber: found ${results.length} Saudi member firms`);
  return results;
}

// ─── 3. AmCham Saudi Arabia ────────────────────────────────────────────────────

export async function scrapeAmChamSaudi(emitLog?: (msg: string) => void): Promise<ScrapedMember[]> {
  const results: ScrapedMember[] = [];
  const log = emitLog || ((m: string) => console.log(`[AmChamSaudi] ${m}`));
  log("Fetching AmCham Saudi Arabia member directory...");

  const possibleUrls = [
    "https://amcham.org.sa/members/",
    "https://www.amcham.org.sa/members/",
    "https://amcham.org.sa/member-directory/",
    "https://www.amcham.org.sa/member-directory/",
  ];

  let html = "";
  for (const u of possibleUrls) {
    html = await fetchHtml(u, 20000);
    if (html.length > 500) break;
  }
  if (!html) return results;

  const $ = cheerio.load(html);
  // Extract member cards directly from listing page (no individual profiles needed)
  $(".member-card, .member-item, .company-card, article, .entry, .listing-item").each((_, el) => {
    const cardText = $(el).text();
    const nameEl = $(el).find("h2, h3, h4, .name, .title, strong").first();
    const nameEn = nameEl.text().trim();
    if (!nameEn || nameEn.length < 3) return;

    const emailMatch = cardText.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
    const websiteLink = $(el).find("a[href^='http']").filter((_, a) => {
      const h = $(a).attr("href") || "";
      return !h.includes("amcham") && !h.includes("facebook");
    }).first().attr("href");

    results.push({
      nameEn,
      website: websiteLink,
      email: emailMatch?.[0]?.toLowerCase(),
      city: extractSaudiCity(cardText),
      country: "Saudi Arabia",
      mainActivity: "US-Saudi business",
      source: "amcham-saudi",
      sourceUrl: "https://amcham.org.sa/members/",
    });
  });

  // Also grab all text names if no cards found
  if (results.length === 0) {
    $("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim();
      if (text.length > 5 && text.length < 80 && /member|company|firm/i.test(href)) {
        const full = href.startsWith("http") ? href : `https://amcham.org.sa${href}`;
        results.push({
          nameEn: text,
          source: "amcham-saudi",
          sourceUrl: full,
          country: "Saudi Arabia",
          mainActivity: "US-Saudi business",
        });
      }
    });
  }

  log(`✅ AmCham Saudi: found ${results.length} member firms`);
  return results;
}

// ─── 4. Saudi British Business Council (SBBC) ────────────────────────────────

export async function scrapeSBBC(emitLog?: (msg: string) => void): Promise<ScrapedMember[]> {
  const results: ScrapedMember[] = [];
  const log = emitLog || ((m: string) => console.log(`[SBBC] ${m}`));
  log("Fetching SBBC member directory...");

  const urls = [
    "https://www.saudibbc.org/members/",
    "https://saudibbc.org/members/",
    "https://www.saudibbc.org/en/members/",
  ];

  for (const url of urls) {
    const html = await fetchHtml(url, 20000);
    if (!html) continue;

    const $ = cheerio.load(html);
    $("a[href], .member-name, h3, h4").each((_, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr("href") || "";
      if (text.length > 4 && text.length < 100 && !text.includes("http")) {
        results.push({
          nameEn: text,
          source: "sbbc",
          sourceUrl: url,
          country: "Saudi Arabia",
          mainActivity: "UK-Saudi business",
        });
      } else if (href && /member|company/i.test(href)) {
        const full = href.startsWith("http") ? href : `https://www.saudibbc.org${href}`;
        results.push({
          nameEn: text || href.split("/").pop() || "",
          source: "sbbc",
          sourceUrl: full,
          country: "Saudi Arabia",
          mainActivity: "UK-Saudi business",
        });
      }
    });
    if (results.length > 0) break;
  }

  log(`✅ SBBC: found ${results.length} member firms`);
  return results.filter(r => r.nameEn && r.nameEn.length > 3);
}

// ─── 5. Jeddah Chamber of Commerce ────────────────────────────────────────────

export async function scrapeJeddahChamber(emitLog?: (msg: string) => void): Promise<ScrapedMember[]> {
  const results: ScrapedMember[] = [];
  const log = emitLog || ((m: string) => console.log(`[JCC] ${m}`));
  log("Fetching Jeddah Chamber of Commerce member data...");

  const possibleUrls = [
    "https://www.jcc.org.sa/en/our-members/",
    "https://jcc.org.sa/members",
    "https://www.jcc.org.sa/members-directory/",
  ];

  for (const url of possibleUrls) {
    const html = await fetchHtml(url, 20000);
    if (!html || html.length < 500) continue;

    const $ = cheerio.load(html);
    $(".member-card, .company-item, article, .listing, .row .col").each((_, el) => {
      const nameEl = $(el).find("h1, h2, h3, h4, .name, strong").first();
      const nameEn = nameEl.text().trim();
      if (!nameEn || nameEn.length < 3) return;

      const cardText = $(el).text();
      const emailMatch = cardText.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
      const websiteLink = $(el).find("a[href^='http']").first().attr("href");

      results.push({
        nameEn,
        email: emailMatch?.[0]?.toLowerCase(),
        website: websiteLink,
        city: "Jeddah",
        region: "Makkah Region",
        country: "Saudi Arabia",
        mainActivity: "Jeddah Chamber member",
        source: "jcc",
        sourceUrl: url,
      });
    });

    if (results.length > 0) break;
  }

  log(`✅ Jeddah Chamber: found ${results.length} member firms`);
  return results;
}

// ─── 6. French Chamber of Commerce KSA (CCEF) ────────────────────────────────

export async function scrapeFrenchChamber(emitLog?: (msg: string) => void): Promise<ScrapedMember[]> {
  const results: ScrapedMember[] = [];
  const log = emitLog || ((m: string) => console.log(`[CCEF] ${m}`));
  log("Fetching French Chamber KSA member directory...");

  const urls = [
    "https://www.fcc.org.sa/members/",
    "https://fcc.org.sa/en/members/",
    "https://www.ccef-arabie.com/members/",
  ];

  for (const url of urls) {
    const html = await fetchHtml(url, 18000);
    if (!html || html.length < 300) continue;

    const $ = cheerio.load(html);
    $(".member, .company, article, .card, li.item").each((_, el) => {
      const nameEl = $(el).find("h1, h2, h3, h4, .name, strong").first();
      const nameEn = nameEl.text().trim();
      if (!nameEn || nameEn.length < 3) return;

      const cardText = $(el).text();
      const emailMatch = cardText.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
      const websiteLink = $(el).find("a[href^='http']").first().attr("href");

      results.push({
        nameEn,
        email: emailMatch?.[0]?.toLowerCase(),
        website: websiteLink,
        city: extractSaudiCity(cardText) || "Riyadh",
        country: "Saudi Arabia",
        mainActivity: "French-Saudi business",
        source: "french-chamber-ksa",
        sourceUrl: url,
      });
    });

    if (results.length > 0) break;
  }

  log(`✅ French Chamber KSA: found ${results.length} member firms`);
  return results;
}

// ─── 7. German-Arab Chamber of Commerce (GACIC / AHK) ────────────────────────

export async function scrapeGermanArabChamber(emitLog?: (msg: string) => void): Promise<ScrapedMember[]> {
  const results: ScrapedMember[] = [];
  const log = emitLog || ((m: string) => console.log(`[GACIC] ${m}`));
  log("Fetching German-Arab Chamber member directory...");

  const urls = [
    "https://www.gdksa.org/members/",
    "https://gdksa.org/en/members/",
    "https://www.gacic.de/en/members/?country=Saudi+Arabia",
    "https://riyadh.ahk.de/en/members/",
  ];

  for (const url of urls) {
    const html = await fetchHtml(url, 20000);
    if (!html || html.length < 300) continue;

    const $ = cheerio.load(html);
    $(".member-card, .company-card, article, .entry-content, .card").each((_, el) => {
      const cardText = $(el).text();
      if (!isSaudiRelated(cardText)) return;

      const nameEl = $(el).find("h1, h2, h3, h4, .company-name, strong").first();
      const nameEn = nameEl.text().trim();
      if (!nameEn || nameEn.length < 3) return;

      const emailMatch = cardText.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
      const websiteLink = $(el).find("a[href^='http']").first().attr("href");

      results.push({
        nameEn,
        email: emailMatch?.[0]?.toLowerCase(),
        website: websiteLink,
        city: extractSaudiCity(cardText),
        country: "Saudi Arabia",
        mainActivity: "German-Arab business",
        source: "german-arab-chamber",
        sourceUrl: url,
      });
    });

    if (results.length > 0) break;
  }

  log(`✅ German-Arab Chamber: found ${results.length} Saudi firms`);
  return results;
}

// ─── 8. GCC Chambers (gcc-chambers.com) ──────────────────────────────────────

export async function scrapeGccChambers(emitLog?: (msg: string) => void): Promise<ScrapedMember[]> {
  const results: ScrapedMember[] = [];
  const log = emitLog || ((m: string) => console.log(`[GCCChambers] ${m}`));
  log("Fetching GCC Chambers directory...");

  const html = await fetchHtml("https://www.gcc-chambers.com", 20000);
  if (!html) return results;

  const $ = cheerio.load(html);
  const saudiLinks = extractLinks($, "https://www.gcc-chambers.com", [
    /\/saudi|\/ksa|\/company|\/member|\/firm/i
  ]).filter(l => isSaudiRelated(l));

  for (let i = 0; i < Math.min(saudiLinks.length, 30); i += 5) {
    const batch = saudiLinks.slice(i, i + 5);
    await Promise.allSettled(batch.map(async (url) => {
      const pHtml = await fetchHtml(url, 12000);
      if (!pHtml) return;
      const pText = extractText(pHtml);
      const p$ = cheerio.load(pHtml);
      const nameEn = p$("h1, h2").first().text().trim();
      if (!nameEn) return;

      const emailMatch = pText.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
      results.push({
        nameEn,
        email: emailMatch?.[0]?.toLowerCase(),
        city: extractSaudiCity(pText),
        country: "Saudi Arabia",
        mainActivity: "GCC Chamber member",
        source: "gcc-chambers",
        sourceUrl: url,
      });
    }));
    await new Promise(r => setTimeout(r, 500));
  }

  log(`✅ GCC Chambers: found ${results.length} Saudi firms`);
  return results;
}

// ─── 9. ICAEW Saudi Arabia (Institute of Chartered Accountants) ──────────────

export async function scrapeICAEW(emitLog?: (msg: string) => void): Promise<ScrapedMember[]> {
  const results: ScrapedMember[] = [];
  const log = emitLog || ((m: string) => console.log(`[ICAEW] ${m}`));
  log("Fetching ICAEW Saudi Arabia member firms...");

  const url = "https://www.icaew.com/about-icaew/find-a-chartered-accountant?facets=Country%3ASaudi+Arabia&type=Firm";
  const html = await fetchHtml(url, 20000);
  if (!html) return results;

  const $ = cheerio.load(html);
  $(".search-result, .result-item, article, .member-firm").each((_, el) => {
    const cardText = $(el).text();
    if (!isSaudiRelated(cardText)) return;

    const nameEl = $(el).find("h1, h2, h3, h4, .firm-name, strong, a").first();
    const nameEn = nameEl.text().trim();
    if (!nameEn || nameEn.length < 3) return;

    const emailMatch = cardText.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
    const phoneMatch = cardText.match(/\+966[0-9 ()-]{8,14}/);

    results.push({
      nameEn,
      email: emailMatch?.[0]?.toLowerCase(),
      phone: phoneMatch?.[0]?.trim(),
      city: extractSaudiCity(cardText),
      country: "Saudi Arabia",
      mainActivity: "Chartered Accountancy",
      source: "icaew",
      sourceUrl: url,
    });
  });

  log(`✅ ICAEW: found ${results.length} Saudi member firms`);
  return results;
}

// ─── Master harvester: run all enabled scrapers ───────────────────────────────

export type DirectorySource =
  | "mooresrowland"
  | "arabbritishchamber"
  | "amcham-saudi"
  | "sbbc"
  | "jcc"
  | "french-chamber-ksa"
  | "german-arab-chamber"
  | "gcc-chambers"
  | "icaew";

export const DIRECTORY_SOURCE_LABELS: Record<DirectorySource, string> = {
  "mooresrowland": "Moores Rowland (accounting firms)",
  "arabbritishchamber": "Arab British Chamber of Commerce",
  "amcham-saudi": "AmCham Saudi Arabia",
  "sbbc": "Saudi British Business Council",
  "jcc": "Jeddah Chamber of Commerce",
  "french-chamber-ksa": "French Chamber of Commerce KSA",
  "german-arab-chamber": "German-Arab Chamber of Commerce",
  "gcc-chambers": "GCC Chambers of Commerce",
  "icaew": "ICAEW Chartered Accountants (KSA)",
};

export async function harvestFromDirectory(
  source: DirectorySource,
  emitter?: EventEmitter
): Promise<ScrapedMember[]> {
  const logFn = emitter
    ? (msg: string) => emitter.emit("event", { type: "log", message: msg, level: "info" })
    : undefined;

  switch (source) {
    case "mooresrowland":      return scrapeMooresRowland(logFn);
    case "arabbritishchamber": return scrapeArabBritishChamber(logFn);
    case "amcham-saudi":       return scrapeAmChamSaudi(logFn);
    case "sbbc":               return scrapeSBBC(logFn);
    case "jcc":                return scrapeJeddahChamber(logFn);
    case "french-chamber-ksa": return scrapeFrenchChamber(logFn);
    case "german-arab-chamber":return scrapeGermanArabChamber(logFn);
    case "gcc-chambers":       return scrapeGccChambers(logFn);
    case "icaew":              return scrapeICAEW(logFn);
    default:                   return [];
  }
}
