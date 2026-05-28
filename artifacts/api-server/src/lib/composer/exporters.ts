/**
 * Composer report exporters — serialize a ReportBlock[] tree to:
 *   xlsx · pdf · pptx · csv · html · jsx · json
 */
import type { ReportBlock } from "./report-builder.js";

export type ExportFormat = "xlsx" | "pdf" | "pptx" | "csv" | "html" | "jsx" | "json";

export interface ExportResult {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

const TS = (): string => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

/** Reduce ReportBlock[] to the rows that should go into a tabular export. */
function blocksToTabular(blocks: ReportBlock[]): Array<{ name: string; headers: string[]; rows: Array<Array<string | number>> }> {
  const sheets: Array<{ name: string; headers: string[]; rows: Array<Array<string | number>> }> = [];
  let tableIdx = 1;
  for (const b of blocks) {
    if (b.type === "table") {
      sheets.push({ name: (b.title || `Table ${tableIdx}`).slice(0, 28), headers: b.headers, rows: b.rows });
      tableIdx++;
    } else if (b.type === "kpi") {
      sheets.push({ name: "KPIs", headers: ["Label", "Value", "Delta"], rows: b.kpis.map((k) => [k.label, k.value, k.delta || ""]) });
    } else if (b.type === "list") {
      sheets.push({ name: (b.title || "List").slice(0, 28), headers: ["Item"], rows: b.items.map((i) => [i]) });
    } else if (b.type === "citations") {
      sheets.push({ name: "Citations", headers: ["Label", "URL"], rows: b.items.map((c) => [c.label, c.url]) });
    } else if (b.type === "signal") {
      sheets.push({ name: "Signals", headers: ["Headline", "Strength", "Source", "Summary"], rows: b.items.map((s) => [s.headline, s.strength, s.sourceUrl || "", s.summary || ""]) });
    }
  }
  if (!sheets.length) sheets.push({ name: "Report", headers: ["Block", "Content"], rows: blocks.filter((b) => b.type === "text" || b.type === "title").map((b) => [b.type, (b as { text: string }).text]) });
  return sheets;
}

export async function exportReport(blocks: ReportBlock[], format: ExportFormat, opts: { title?: string; runId?: number | string } = {}): Promise<ExportResult> {
  const title = opts.title || "ProspectSA Report";
  const stamp = TS();
  const filenameBase = `prospectsa-report-${opts.runId || stamp}`;

  if (format === "json") {
    return { buffer: Buffer.from(JSON.stringify({ title, blocks }, null, 2)), mimeType: "application/json", filename: `${filenameBase}.json` };
  }

  if (format === "csv") {
    const sheets = blocksToTabular(blocks);
    const csv = sheets.map((s) => `# ${s.name}\n` + [s.headers, ...s.rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")).join("\n\n");
    return { buffer: Buffer.from(csv), mimeType: "text/csv", filename: `${filenameBase}.csv` };
  }

  if (format === "html" || format === "jsx") {
    const isJsx = format === "jsx";
    const wrap = (b: string): string => isJsx
      ? `export function ProspectSAReport() {\n  return (\n    <div className="report">\n${b}\n    </div>\n  );\n}\n`
      : `<!doctype html><html><head><meta charset="utf-8"/><title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:880px;margin:24px auto;padding:0 16px;color:#2d243a}h1,h2{letter-spacing:-.01em}table{width:100%;border-collapse:collapse;font-size:13px}th{background:#f5f0f7;text-align:left;padding:8px;border-bottom:1px solid #e8def0}td{padding:8px;border-bottom:1px solid #e8def0}.kpi{display:inline-block;margin:6px;padding:12px 16px;background:#fff;border:1px solid #e8def0;border-radius:10px}.kpi-val{font-size:22px;font-weight:700}.kpi-lbl{font-size:11px;color:#5a4d6e;text-transform:uppercase;letter-spacing:.05em}</style></head><body>\n${b}\n</body></html>\n`;
    const blockHtml = (b: ReportBlock): string => {
      if (b.type === "title") return `<h1>${esc(b.text)}</h1>`;
      if (b.type === "text") return `<p>${esc(b.text).replace(/\n\n/g, "</p><p>")}</p>`;
      if (b.type === "kpi") return b.kpis.map((k) => `<span class="kpi"><div class="kpi-val">${esc(k.value)}</div><div class="kpi-lbl">${esc(k.label)}</div></span>`).join("");
      if (b.type === "table") return `${b.title ? `<h2>${esc(b.title)}</h2>` : ""}<table><thead><tr>${b.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(String(c))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      if (b.type === "list") return `${b.title ? `<h2>${esc(b.title)}</h2>` : ""}<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
      if (b.type === "citations") return `<h2>Sources</h2><ul>${b.items.map((c) => `<li><a href="${esc(c.url)}">${esc(c.label)}</a></li>`).join("")}</ul>`;
      if (b.type === "signal") return `<h2>Signals</h2><ul>${b.items.map((s) => `<li><strong>${esc(s.headline)}</strong> (${s.strength}) — ${esc(s.summary || "")}</li>`).join("")}</ul>`;
      return "";
    };
    const body = blocks.map(blockHtml).join("\n");
    return { buffer: Buffer.from(wrap(body)), mimeType: isJsx ? "text/jsx" : "text/html", filename: `${filenameBase}.${isJsx ? "jsx" : "html"}` };
  }

  if (format === "xlsx") {
    const xlsx = await import("xlsx");
    const wb = xlsx.utils.book_new();
    for (const s of blocksToTabular(blocks)) {
      const ws = xlsx.utils.aoa_to_sheet([s.headers, ...s.rows]);
      xlsx.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
    }
    const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return { buffer: buf, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename: `${filenameBase}.xlsx` };
  }

  if (format === "pdf") {
    const PDFDocument = (await import("pdfkit")).default;
    const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: title } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
    doc.fontSize(20).text(title, { underline: false });
    doc.moveDown(0.5);
    for (const b of blocks) {
      if (b.type === "title") { doc.moveDown(0.5).fontSize(18).text(b.text); }
      else if (b.type === "text") { doc.moveDown(0.3).fontSize(11).text(b.text, { align: "left" }); }
      else if (b.type === "kpi") {
        doc.moveDown(0.5).fontSize(13).text("Highlights"); doc.moveDown(0.2);
        for (const k of b.kpis) doc.fontSize(11).text(`• ${k.label}: ${k.value}${k.delta ? ` (${k.delta})` : ""}`);
      } else if (b.type === "table") {
        if (b.title) { doc.moveDown(0.5).fontSize(13).text(b.title); doc.moveDown(0.2); }
        doc.fontSize(10).text(b.headers.join(" | "));
        for (const r of b.rows) doc.fontSize(9).text(r.join(" | "));
      } else if (b.type === "list") {
        if (b.title) { doc.moveDown(0.5).fontSize(13).text(b.title); doc.moveDown(0.2); }
        for (const i of b.items) doc.fontSize(11).text(`• ${i}`);
      } else if (b.type === "citations") {
        doc.moveDown(0.5).fontSize(13).text("Sources"); doc.moveDown(0.2);
        for (const c of b.items) doc.fontSize(9).fillColor("blue").text(c.url, { link: c.url, underline: true }).fillColor("black");
      }
    }
    doc.end();
    return { buffer: await done, mimeType: "application/pdf", filename: `${filenameBase}.pdf` };
  }

  if (format === "pptx") {
    const PptxGenJS = (await import("pptxgenjs")).default;
    const pptx = new PptxGenJS();
    pptx.title = title;
    const cover = pptx.addSlide();
    cover.addText(title, { x: 0.5, y: 1.5, w: 9, h: 1.2, fontSize: 28, bold: true });
    cover.addText("Generated by ProspectSA AI Composer", { x: 0.5, y: 2.8, w: 9, h: 0.4, fontSize: 12, color: "777777" });
    for (const b of blocks) {
      const slide = pptx.addSlide();
      if (b.type === "title") slide.addText(b.text, { x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 22, bold: true });
      else if (b.type === "text") slide.addText(b.text.slice(0, 1800), { x: 0.5, y: 0.3, w: 9, h: 5, fontSize: 12 });
      else if (b.type === "kpi") {
        slide.addText("Highlights", { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 18, bold: true });
        b.kpis.slice(0, 4).forEach((k, i) => {
          slide.addText([{ text: k.value + "\n", options: { fontSize: 24, bold: true } }, { text: k.label, options: { fontSize: 11, color: "777777" } }], { x: 0.5 + i * 2.3, y: 1.2, w: 2.2, h: 1.2 });
        });
      } else if (b.type === "table") {
        if (b.title) slide.addText(b.title, { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 18, bold: true });
        slide.addTable([b.headers, ...b.rows.slice(0, 12).map((r) => r.map(String))] as any, { x: 0.5, y: 0.9, w: 9, fontSize: 9 });
      } else if (b.type === "list") {
        if (b.title) slide.addText(b.title, { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 18, bold: true });
        slide.addText(b.items.map((i) => "• " + i).join("\n"), { x: 0.5, y: 0.9, w: 9, h: 5, fontSize: 12 });
      }
    }
    const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
    return { buffer: buf, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", filename: `${filenameBase}.pptx` };
  }

  throw new Error("Unsupported format: " + format);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
