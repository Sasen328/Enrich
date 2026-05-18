import Anthropic from "@anthropic-ai/sdk";
import { env } from "./config/env.js";

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (client) return client;
  if (!env.anthropicKey) return null;
  client = new Anthropic({ apiKey: env.anthropicKey });
  return client;
}

export function isAnthropicConfigured(): boolean {
  return !!env.anthropicKey;
}

export async function enrichWithClaude(
  companyName: string,
  knownData: Record<string, unknown>,
  depth: "basic" | "standard" | "deep" = "standard"
): Promise<Record<string, unknown> | null> {
  const c = getClient();
  if (!c) return null;

  const depthInstructions = {
    basic: "Provide: bilingual names, industry, city, 2-3 sentence description (EN+AR), estimated employees.",
    standard: "Provide comprehensive B2B data: names (EN+AR), industry (EN+AR), city, region, description, employee count, revenue range (e.g. 'SAR 50M-100M'), founding year, entity type, company type, owner name, 2-3 key executives with titles, market positioning, recent news summary.",
    deep: "Provide all 22 data points: full bilingual names, industry (EN+AR), city, region, description (EN+AR 3-4 sentences), employee count, revenue (single range like 'SAR 100M-500M'), founding year, CR number if public, capital amount, entity type, company type, owner full name (EN+AR), owner title, estimated wealth, shareholders (JSON array [{name, percentage}]), key executives (JSON array [{name, title}]), market positioning, recent news (JSON array [{headline, date, summary}]), LinkedIn URL, Twitter.",
  };

  const prompt = `You are a Saudi Arabia B2B intelligence analyst. Enrich this Saudi company with accurate, verifiable information.

Company: ${companyName}
Known data: ${JSON.stringify(knownData)}

Instructions: ${depthInstructions[depth]}

CRITICAL RULES:
- Only provide REAL, VERIFIABLE data. Never fabricate phone numbers, emails, or CR numbers.
- Revenue must be a single range like "SAR 50M-100M" — never "estimated" or fabricated.
- Phone numbers must be real Saudi format (05x, 01x, or +966). Omit if unsure.
- Use null for unknown fields. Do NOT fabricate.
- Shareholders and executives as JSON arrays only if you have reliable information.

Respond ONLY with a valid JSON object with these fields:
nameAr, nameEn, industry, industryAr, city, region, description, descriptionAr, employeeCount, revenue, foundingYear, crNumber, capitalAmount, entityType, companyType, ownerName, ownerNameAr, ownerTitle, estimatedWealth, shareholders, keyExecutives, marketPositioning, recentNews, linkedinUrl, twitterUrl`;

  try {
    const message = await c.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  } catch (err) {
    console.warn("Claude enrichment failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function researchWithClaude(query: string): Promise<string | null> {
  const c = getClient();
  if (!c) return null;

  try {
    const message = await c.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: query }],
    });
    return message.content[0].type === "text" ? message.content[0].text : null;
  } catch {
    return null;
  }
}
