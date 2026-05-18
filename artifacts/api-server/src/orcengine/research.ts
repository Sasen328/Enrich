import { db } from "@workspace/db";
import { researchJobsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOpenAIClient } from "../openai-client.js";
import { PerplexityService } from "../perplexity-service.js";
import { searchWithGemini } from "../gemini-search.js";
import { nexusSynthesize } from "../lib/nexus/index.js";

interface ResearchReport {
  summary: string;
  sections: Array<{ title: string; content: string }>;
  keyFindings: string[];
  recommendations: string[];
}

export async function createResearchJob(query: string): Promise<{ id: number; status: string }> {
  const [job] = await db
    .insert(researchJobsTable)
    .values({ query, status: "researching" })
    .returning();

  runResearch(job.id, query).catch(console.error);

  return { id: job.id, status: "researching" };
}

async function gatherSources(query: string): Promise<{ text: string; sources: string[] }> {
  const parts: string[] = [];
  const sources: string[] = [];

  if (PerplexityService.isConfigured()) {
    try {
      const service = new PerplexityService();
      const result = await service.search(query);
      parts.push(result);
      sources.push("Perplexity AI Search");
    } catch {
      // Perplexity unavailable
    }
  }

  try {
    const geminiResult = await searchWithGemini(query);
    if (geminiResult) {
      parts.push(geminiResult);
      sources.push("Gemini AI");
    }
  } catch {
    // Gemini unavailable
  }

  return { text: parts.join("\n\n---\n\n"), sources };
}

async function runResearch(jobId: number, query: string): Promise<void> {
  try {
    const { text: sourceData, sources } = await gatherSources(query);

    const reportPrompt = `Research query: "${query}"\n\nSource data:\n${sourceData || "No external sources available. Generate report based on your knowledge."}\n\nReturn only valid JSON.`;
    const reportSystem = `You are a senior research analyst. Generate a comprehensive research report in JSON format with fields: summary (string), sections (array of {title, content}), keyFindings (array of strings), recommendations (array of strings). Be thorough and analytical.`;

    // NEXUS synthesis tier: Gemini → Claude → GPT-4o → DeepSeek fallback chain
    let content = "{}";
    try {
      const nexusResult = await nexusSynthesize(reportPrompt, reportSystem, { maxTokens: 4000 });
      content = nexusResult.text;
      console.log(`[Research] NEXUS synthesis via ${nexusResult.provider}/${nexusResult.model}`);
    } catch {
      // Final fallback: direct OpenAI
      try {
        const openai = getOpenAIClient();
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{ role: "system", content: reportSystem }, { role: "user", content: reportPrompt }],
          max_tokens: 4000,
          temperature: 0.3,
        });
        content = response.choices[0]?.message?.content || "{}";
      } catch { /* all providers exhausted */ }
    }

    let report: ResearchReport;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      report = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: content, sections: [], keyFindings: [], recommendations: [] };
    } catch {
      report = { summary: content, sections: [], keyFindings: [], recommendations: [] };
    }

    await db
      .update(researchJobsTable)
      .set({ status: "completed", report, sources })
      .where(eq(researchJobsTable.id, jobId));
  } catch {
    await db
      .update(researchJobsTable)
      .set({ status: "failed" })
      .where(eq(researchJobsTable.id, jobId));
  }
}

export async function getResearchJob(id: number) {
  const jobs = await db
    .select()
    .from(researchJobsTable)
    .where(eq(researchJobsTable.id, id));
  return jobs[0] || null;
}

export async function listResearchJobs() {
  return db.select().from(researchJobsTable).orderBy(researchJobsTable.createdAt);
}
