/**
 * Report Builder — coerces raw LLM markdown into a typed ReportBlock[] tree.
 * The frontend renders blocks by type (kpi/table/list/text/citation/chart-spec).
 */

export type ReportBlock =
  | { type: "title"; text: string }
  | { type: "text"; text: string }
  | { type: "kpi"; kpis: Array<{ label: string; value: string; delta?: string }> }
  | { type: "table"; title?: string; headers: string[]; rows: Array<Array<string | number>> }
  | { type: "list"; title?: string; items: string[] }
  | { type: "citations"; items: Array<{ label: string; url: string }> }
  | { type: "signal"; items: Array<{ headline: string; strength: number; sourceUrl?: string; summary?: string }> };

export type ReportShape = "exec" | "detail" | "custom";

/** Parse a markdown-ish LLM response into report blocks. Heuristic; safe-fail. */
export function parseToBlocks(raw: string, shape: ReportShape = "detail"): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  if (!raw) return blocks;
  const text = raw.trim();

  // Pull the first H1/H2 as title
  const titleMatch = text.match(/^#{1,2}\s+(.+)$/m);
  if (titleMatch) blocks.push({ type: "title", text: titleMatch[1].trim() });

  // Markdown tables → table blocks
  const tableRegex = /(?:^|\n)((?:\|[^\n]+\|\n)+)/g;
  let m: RegExpExecArray | null;
  while ((m = tableRegex.exec(text)) !== null) {
    const lines = m[1].trim().split(/\n/).filter(Boolean);
    if (lines.length < 2) continue;
    const headers = lines[0].split("|").map((s) => s.trim()).filter(Boolean);
    const rows: string[][] = [];
    for (let i = 2; i < lines.length; i++) {
      const row = lines[i].split("|").map((s) => s.trim());
      // first + last cells are empties from leading/trailing |
      const cleaned = row.length > headers.length ? row.slice(1, headers.length + 1) : row;
      if (cleaned.some((c) => c)) rows.push(cleaned);
    }
    if (rows.length) blocks.push({ type: "table", headers, rows });
  }

  // Bullet lists → list block
  const bulletMatch = text.match(/(?:^|\n)((?:[-*]\s+[^\n]+\n?)+)/);
  if (bulletMatch) {
    const items = bulletMatch[1].split(/\n/).filter((l) => /^[-*]\s+/.test(l)).map((l) => l.replace(/^[-*]\s+/, "").trim());
    if (items.length) blocks.push({ type: "list", items });
  }

  // Citation URLs anywhere in text
  const urls = Array.from(text.matchAll(/https?:\/\/[^\s)\]]+/g)).map((x) => x[0]);
  if (urls.length) blocks.push({ type: "citations", items: urls.map((u) => ({ label: new URL(u).hostname.replace(/^www\./, ""), url: u })) });

  // For exec shape: drop tables (executive summary should be narrative-only)
  let filtered = blocks;
  if (shape === "exec") filtered = blocks.filter((b) => b.type !== "table");

  // If nothing structured found, emit a single text block
  if (filtered.length === 0 || (filtered.length === 1 && filtered[0].type === "title")) {
    filtered.push({ type: "text", text });
  }
  return filtered;
}
