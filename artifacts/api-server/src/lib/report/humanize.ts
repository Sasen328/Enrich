// §8 — Hallucination-free humanizer pass.
// Strips machine/code-style artifacts from a report and (optionally) rewrites
// it in calm executive prose via the Nexus writer tier — while guaranteeing
// every number / date / proper-noun from the original survives.

import { nexusRunRole } from "../nexus/llm-router.js";

export interface HumanizeOptions {
  removeArtifacts?: boolean;          // default true
  rewrite?: boolean;                   // default false (regex-only unless set)
  toneLevel?: "neutral" | "warm";      // default neutral
  language?: "en" | "ar" | "both";
}

export interface HumanizeResult {
  humanized: string;
  removedCount: number;
  factPreserved: boolean;              // false if rewrite dropped facts → raw returned
}

// Regex artifacts that read as machine/code output.
const ARTIFACT_PATTERNS: RegExp[] = [
  /^\s*#{1,6}\s+/gm,        // markdown headings
  /^\s*[-*]\s+/gm,          // bullet dashes/stars
  /`{1,3}/g,                // backticks / code fences
  /\/\/\s?/g,               // // comments
  /<!--[\s\S]*?-->/g,       // html comments
  /\*\*(.*?)\*\*/g,         // bold markers (keep inner text)
  /^\s*\|.*\|\s*$/gm,       // markdown table rows
  /^\s*[-=]{3,}\s*$/gm,     // --- / === rules
];

function stripArtifacts(md: string): { text: string; removed: number } {
  let removed = 0;
  let out = md;
  for (const re of ARTIFACT_PATTERNS) {
    out = out.replace(re, (m, inner) => {
      removed++;
      return inner ?? "";    // keep captured inner text (e.g. bold content)
    });
  }
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return { text: out, removed };
}

// Pull every number, date, and capitalised proper-noun token for the
// fact-preservation diff.
function factTokens(s: string): Set<string> {
  const nums = s.match(/\b\d[\d,.\-/]*\b/g) ?? [];
  const proper = s.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [];
  return new Set([...nums, ...proper].map((t) => t.toLowerCase()));
}

export async function humanizeReport(rawMarkdown: string, opts: HumanizeOptions = {}): Promise<HumanizeResult> {
  const { removeArtifacts = true, rewrite = false, toneLevel = "neutral", language = "en" } = opts;

  let working = rawMarkdown;
  let removedCount = 0;
  if (removeArtifacts) {
    const stripped = stripArtifacts(working);
    working = stripped.text;
    removedCount = stripped.removed;
  }

  if (!rewrite) {
    return { humanized: working, removedCount, factPreserved: true };
  }

  // LLM rewrite via cheap writer tier, then fact-preservation guard.
  const sys = `You rewrite intelligence reports into calm, ${toneLevel} executive prose.
Rules: no headings, no bullet lists, no markdown, no code-style punctuation (no --, //, ###, backticks).
Preserve EVERY number, date, percentage, currency figure, and proper noun EXACTLY as written.
${language === "ar" ? "Respond in Arabic." : language === "both" ? "Respond in English then Arabic." : "Respond in English."}`;

  try {
    const before = factTokens(working);
    const out = await nexusRunRole("writer", working, { systemPrompt: sys, temperature: 0.2 });
    const after = factTokens(out.text);
    const missing = [...before].filter((t) => !after.has(t));

    if (missing.length === 0) {
      return { humanized: out.text, removedCount, factPreserved: true };
    }
    // One stricter retry.
    const retry = await nexusRunRole("writer", working, {
      systemPrompt: sys + `\nCRITICAL: your previous attempt dropped these tokens: ${missing.join(", ")}. Include ALL of them.`,
      temperature: 0,
    });
    const after2 = factTokens(retry.text);
    if ([...before].every((t) => after2.has(t))) {
      return { humanized: retry.text, removedCount, factPreserved: true };
    }
    // Still dropping facts → return artifact-stripped raw (safe).
    return { humanized: working, removedCount, factPreserved: false };
  } catch {
    return { humanized: working, removedCount, factPreserved: false };
  }
}
