import axios from "axios";

const PERPLEXITY_BASE = "https://api.perplexity.ai/chat/completions";

let _perplexityBlocked = false;

export function isPerplexityConfigured(): boolean {
  if (_perplexityBlocked) return false;
  if (process.env.DISABLE_PERPLEXITY === "true") return false;
  return !!process.env.PERPLEXITY_API_KEY;
}

async function callPerplexity(
  systemMsg: string,
  userMsg: string,
  maxTokens = 1500
): Promise<string | null> {
  if (_perplexityBlocked) return null;
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return null;
  // Cost guard: only spend inside an explicit job + under budget.
  const { canSpend, recordSpend } = await import("./paid-api-guard.js");
  if (!canSpend("perplexity")) return null;

  try {
    const res = await axios.post(
      PERPLEXITY_BASE,
      {
        model: "sonar",
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: userMsg },
        ],
        max_tokens: maxTokens,
        temperature: 0.1,
        return_citations: true,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );
    recordSpend("perplexity");
    return res.data?.choices?.[0]?.message?.content || null;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        _perplexityBlocked = true;
        console.warn(`[Perplexity] API key invalid (${status}) — disabling for this session.`);
      } else {
        console.warn(`[Perplexity] error ${status ?? "network"}: ${err.message}`);
      }
    }
    return null;
  }
}

// ── 1. General company profile ─────────────────────────────────────────────
export async function researchCompanyWithPerplexity(
  companyName: string,
  country = "Saudi Arabia"
): Promise<string | null> {
  return callPerplexity(
    "You are a B2B intelligence researcher specializing in Saudi Arabian companies. Provide only verified, factual information. Use SAR for Saudi Riyal amounts.",
    `Research the company "${companyName}" based in ${country}. Provide: official website, industry sector, approximate employee count, annual revenue range in SAR, founding year, headquarters city, CEO/chairman name, key executives, company type (public/private), legal form (LLC/JSC), and a 2-3 sentence description. Be concise and factual.`,
    1500
  );
}

// ── 2. Owner / founder profile with wealth estimate ────────────────────────
export async function researchOwnerWithPerplexity(
  companyName: string,
  crNumber?: string | null
): Promise<string | null> {
  const crRef = crNumber ? ` (CR: ${crNumber})` : "";
  return callPerplexity(
    "You are a Saudi Arabia B2B intelligence researcher specializing in ownership structures and personal wealth profiles. Provide factual, specific information.",
    `Who owns, founded, or controls the Saudi company "${companyName}"${crRef}? Provide:
- Full owner/founder name in English AND Arabic
- Their title (owner, chairman, founder, partner, managing director, etc.)
- Ownership percentage if known
- Is this a family business? Which family/tribe?
- Their estimated personal net worth or wealth range in SAR
- Other companies or boards they are connected to
- LinkedIn or public profile if known
Focus on the PRIMARY decision-maker or majority owner. Be specific with names — Arabic names are especially important.`,
    2000
  );
}

// ── 3. Key executives & board of directors ────────────────────────────────
export async function researchExecutivesWithPerplexity(
  companyName: string,
  crNumber?: string | null,
  city?: string | null
): Promise<string | null> {
  const crRef = crNumber ? ` CR ${crNumber}` : "";
  const cityRef = city ? ` ${city}` : "";
  return callPerplexity(
    "You are a Saudi Arabia corporate intelligence researcher. Provide accurate, verified names of company executives.",
    `Saudi company "${companyName}"${crRef}${cityRef} — provide the full leadership team:
- CEO / General Manager (مدير عام): full name in English AND Arabic
- Chairman / Board Chairman (رئيس مجلس الإدارة): full name EN + AR
- CFO, COO, or other C-suite: names EN + AR with exact titles
- Board of Directors members: names EN + AR with roles
- Any Saudi family connections or tribal affiliations of key persons
Include both English transliteration and original Arabic script for all names.`,
    2000
  );
}

// ── 4. Revenue / financial signals ────────────────────────────────────────
export async function researchRevenueWithPerplexity(
  companyName: string,
  paidUpCapital?: string | null,
  employeeCount?: string | null
): Promise<string | null> {
  const capitalRef = paidUpCapital ? ` Paid-up capital: ${paidUpCapital}.` : "";
  const empRef = employeeCount ? ` Known employees: ${employeeCount}.` : "";
  return callPerplexity(
    "You are a Saudi Arabia financial intelligence analyst. Derive revenue estimates from available financial signals when explicit data isn't available.",
    `Estimate annual revenue for Saudi company "${companyName}".${capitalRef}${empRef}
Provide:
- Explicit annual revenue if publicly known (SAR amount)
- If not stated, derive revenue estimate using: paid-up capital × 5-20x multiplier for Saudi industry type, OR employees × SAR 1-3M per employee benchmark
- Revenue range in SAR (e.g. "SAR 10M - 50M")
- Methodology: how did you arrive at the estimate?
- Company size tier: Micro (<SAR 3M), Small (SAR 3-40M), Medium (SAR 40-200M), Large (>SAR 200M)
- Growth signals: contracts, expansions, new offices, public tenders won
- Profit/financial health indicators
IMPORTANT: Always provide a revenue range — never return "unknown". Use capital and employee benchmarks if direct data unavailable.`,
    2000
  );
}

// ── 5. Recent news ────────────────────────────────────────────────────────
export async function searchNewsWithPerplexity(
  companyName: string
): Promise<string | null> {
  return callPerplexity(
    "You are a financial news researcher. Summarize recent news about the given company concisely.",
    `What are the most recent significant news items about "${companyName}" in Saudi Arabia? List up to 5 news items with date, headline, and one-sentence summary. Focus on business developments, financial results, leadership changes, major contracts, or expansions from the past 12 months.`,
    1000
  );
}

// ── 6. Shareholders & ownership structure ─────────────────────────────────
export async function researchShareholdersWithPerplexity(
  companyName: string,
  crNumber?: string | null
): Promise<string | null> {
  const crRef = crNumber ? ` CR ${crNumber}` : "";
  return callPerplexity(
    "You are a Saudi Arabia corporate registry intelligence specialist. Extract exact ownership information.",
    `Saudi company "${companyName}"${crRef}: shareholders and ownership structure.
Provide:
- Shareholder names in BOTH English AND Arabic (full names)
- Ownership percentage for each shareholder
- Whether shareholders are individuals or corporate entities
- Any government or sovereign wealth fund involvement
- Partnership structure (LLC partners, JSC shareholders)
- Sources: mc.gov.sa, Amaaly magazine, Saudi business registries, news
Arabic names are critical — include both رئيسي and transliterated versions.`,
    2000
  );
}
