// §7 — Source-credibility verdict layer.
// Every fact a research engine returns gets tagged with a trust verdict before
// it reaches the UI. Trust is driven by how many sources corroborate the fact
// and their credibility tier (primary > secondary > inferred), optionally
// weighted by the harvest-source registry's trust_weight.

export type SourceTier = "primary" | "secondary" | "inferred";

export interface FactSource {
  provider: string;        // e.g. "tadawul", "perplexity", "gemini", "claude-inference"
  url?: string;
  tier: SourceTier;
  /** 0-100 weight from the harvest-source registry; defaults by tier. */
  trustWeight?: number;
}

export type Certainty = "verified" | "likely" | "unverified" | "estimated";

export interface Verdict {
  field: string;
  value: unknown;
  sources: FactSource[];
  certainty: Certainty;
  trustScore: number; // 0-100
  rationale: string;
}

function defaultWeight(tier: SourceTier): number {
  return tier === "primary" ? 90 : tier === "secondary" ? 65 : 30;
}

/** Score one fact against its corroborating sources. */
export function scoreFact(field: string, value: unknown, sources: FactSource[]): Verdict {
  const srcs = sources.map((s) => ({ ...s, trustWeight: s.trustWeight ?? defaultWeight(s.tier) }));
  const primaries = srcs.filter((s) => s.tier === "primary");
  const secondaries = srcs.filter((s) => s.tier === "secondary");
  const inferredOnly = srcs.length > 0 && srcs.every((s) => s.tier === "inferred");

  let certainty: Certainty;
  let rationale: string;

  if (primaries.length >= 2) {
    certainty = "verified";
    rationale = `${primaries.length} primary sources agree.`;
  } else if (primaries.length === 1 || secondaries.length >= 2) {
    certainty = "likely";
    rationale = primaries.length === 1
      ? "1 primary source; not independently confirmed."
      : `${secondaries.length} secondary sources agree.`;
  } else if (inferredOnly || srcs.length === 0) {
    certainty = "estimated";
    rationale = srcs.length === 0 ? "No source — model inference only." : "LLM inference only, no external source.";
  } else {
    certainty = "unverified";
    rationale = "Single weak source; treat with caution.";
  }

  // Trust score = weighted blend, capped per certainty band.
  const avgWeight = srcs.length ? srcs.reduce((a, s) => a + (s.trustWeight ?? 0), 0) / srcs.length : 20;
  const band = { verified: [90, 100], likely: [60, 89], unverified: [20, 59], estimated: [0, 40] }[certainty];
  const trustScore = Math.round(Math.min(band[1], Math.max(band[0], (avgWeight / 100) * band[1])));

  return { field, value, sources: srcs, certainty, trustScore, rationale };
}

/** Detect a conflict: same field, materially different values across sources. */
export function flagConflict(field: string, values: { value: unknown; source: FactSource }[]): Verdict | null {
  const distinct = new Set(values.map((v) => String(v.value).trim().toLowerCase()));
  if (distinct.size <= 1) return null;
  return {
    field,
    value: values.map((v) => v.value),
    sources: values.map((v) => v.source),
    certainty: "unverified",
    trustScore: 35,
    rationale: `Sources disagree: ${[...distinct].join(" vs ")}.`,
  };
}

/** Convenience: build verdicts for a flat record of field→value using one source set. */
export function verdictsForRecord(
  record: Record<string, unknown>,
  sources: FactSource[],
  fields?: string[],
): Verdict[] {
  const keys = fields ?? Object.keys(record);
  return keys
    .filter((k) => record[k] != null && record[k] !== "")
    .map((k) => scoreFact(k, record[k], sources));
}
