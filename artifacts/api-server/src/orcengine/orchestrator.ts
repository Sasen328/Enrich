import { db } from "@workspace/db";
import { researchJobsTable } from "@workspace/db";
import type { ResearchJob, ResearchSource, ResearchFinding, ResearchReport, AgentResult } from "@workspace/db";
import { eq } from "drizzle-orm";
import { searchWeb, crawlUrls } from "./crawler";
import { analyzeQueryWithAI, runAllDataSources, synthesizeWithAI } from "./ai-orchestrator";

type JobStatus = 'pending' | 'planning' | 'searching' | 'extracting' | 'analyzing' | 'verifying' | 'compiling' | 'completed' | 'failed';

interface PhaseResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ResearchOptions {
  sources?: string[];
  filters?: {
    country?: string;
    reportFormat?: string;
    timeFrame?: string;
    dateFrom?: string;
    dateTo?: string;
  };
  deepVerify?: boolean;
}

export class ResearchOrchestrator {
  private jobId: string;
  private query: string;
  private options?: ResearchOptions;
  private sources: ResearchSource[] = [];
  private findings: ResearchFinding[] = [];
  private agentResults: AgentResult[] = [];
  private report: ResearchReport | null = null;

  constructor(jobId: string, query: string, options?: ResearchOptions) {
    this.jobId = jobId;
    this.query = query;
    this.options = options;
  }

  private async updateJob(updates: Record<string, unknown>) {
    await (db.update(researchJobsTable) as any)
      .set(updates)
      .where(eq(researchJobsTable.id, parseInt(String(this.jobId), 10) || 0));
  }

  private async setStatus(status: JobStatus, progress: number) {
    await this.updateJob({ status, progress });
  }

  async execute(): Promise<ResearchJob | null> {
    try {
      console.log(`\n[Orchestrator] Starting AI-DRIVEN research for: "${this.query}"`);
      console.log(`[Orchestrator] Options: sources=${this.options?.sources?.join(',') || 'all'}, deepVerify=${this.options?.deepVerify}`);
      
      await this.setStatus('planning', 10);
      console.log(`[Orchestrator] Phase 1: AI analyzing query...`);
      let strategy = await analyzeQueryWithAI(this.query);
      
      // Detect URLs in query and crawl them directly
      const urlRegex = /https?:\/\/[^\s]+/gi;
      const detectedUrls = this.query.match(urlRegex) || [];
      let crawledContent = '';

      if (detectedUrls.length > 0) {
        console.log(`[Orchestrator] Detected ${detectedUrls.length} URLs in query, crawling directly...`);
        try {
          const crawlResults = await crawlUrls(detectedUrls);
          for (const result of crawlResults) {
            if (result.success && result.content) {
              crawledContent += `\n\nCRAWLED FROM ${result.url}:\nTitle: ${result.title}\n${result.content.slice(0, 15000)}\n`;
              console.log(`[Orchestrator] Crawled ${result.url}: ${result.content.length} chars`);
            }
          }
        } catch (err) {
          console.error(`[Orchestrator] URL crawl error:`, err);
        }
        
        // Also ensure 'web' source is included
        if (!strategy.dataSourcesToUse.includes('web')) {
          strategy.dataSourcesToUse.push('web');
        }
      }
      
      if (this.options?.sources && this.options.sources.length > 0) {
        const sourceMapping: Record<string, 'apollo' | 'perplexity' | 'web'> = {
          'apollo': 'apollo',
          'perplexity': 'perplexity',
          'apify': 'web',
          'firecrawl': 'web',
          'web': 'web',
          'explorium': 'apollo',
        };
        const mappedSources = this.options.sources
          .map(s => sourceMapping[s.toLowerCase()])
          .filter(Boolean) as ('apollo' | 'perplexity' | 'web')[];
        
        if (mappedSources.length > 0) {
          strategy.dataSourcesToUse = mappedSources;
          console.log(`[Orchestrator] Filtered sources to: ${strategy.dataSourcesToUse.join(', ')}`);
        } else {
          console.log(`[Orchestrator] No valid sources mapped, using AI-determined sources: ${strategy.dataSourcesToUse.join(', ')}`);
        }
      }
      
      await this.setStatus('searching', 30);
      console.log(`[Orchestrator] Phase 2: Running data sources: ${strategy.dataSourcesToUse.join(', ')}...`);
      const dataResults = await runAllDataSources(strategy, this.query);
      
      // Add crawled URL content as an additional data source
      if (crawledContent) {
        dataResults.push({
          source: 'web_crawl',
          success: true,
          data: detectedUrls.map(url => ({ url, crawled: true })),
          rawContent: crawledContent,
        });
      }
      
      const successfulSources = dataResults.filter(d => d.success);
      console.log(`[Orchestrator] ${successfulSources.length}/${dataResults.length} sources returned data`);
      
      this.sources = dataResults.map((dr, i) => ({
        id: `source-${i}`,
        url: dr.source,
        domain: dr.source,
        title: `${dr.source} Data`,
        content: dr.rawContent,
        reliability: dr.success ? 0.9 : 0.1,
        extractedAt: new Date().toISOString(),
      }));
      
      await this.updateJob({ sources: this.sources, progress: 50 });
      
      await this.setStatus('analyzing', 60);
      console.log(`[Orchestrator] Phase 3: AI synthesizing report...`);
      const report = await synthesizeWithAI(this.query, strategy, dataResults);
      
      this.report = {
        id: this.jobId,
        title: report.title || 'Research Report',
        summary: report.summary || 'Analysis complete.',
        sections: report.sections || [],
        citations: [],
        metadata: {
          totalSources: successfulSources.length,
          verifiedClaims: 0,
          confidenceScore: report.confidence || 0.5,
          generatedAt: new Date().toISOString(),
        },
      } as any;
      
      if (report.dataTable || report.peopleTable) {
        (this.report as any).peopleTable = report.dataTable || report.peopleTable;
      }
      
      this.agentResults = [{
        agentName: 'profile',
        status: 'success' as const,
        sources: [],
        findings: [],
        metadata: { summary: `Research complete: ${report.title}`, confidence: report.confidence || 0.5 },
      }] as any;
      
      await this.setStatus('compiling', 90);
      await this.updateJob({
        agentResults: this.agentResults,
        report: this.report,
        progress: 100,
        status: 'completed',
      });
      
      console.log(`[Orchestrator] Research COMPLETE: ${report.title}`);
      
      const result = await db.select()
        .from(researchJobsTable)
        .where(eq(researchJobsTable.id, parseInt(String(this.jobId), 10) || 0))
        .limit(1);
      
      return result[0] || null;
    } catch (error) {
      console.error('[Orchestrator] Error:', error);
      await this.updateJob({
        status: 'failed',
        report: { error: error instanceof Error ? error.message : 'Unknown error' } as unknown,
      });
      return null;
    }
  }

  private async phase1_analyze(): Promise<PhaseResult> {
    return { success: true, data: {} };
  }

  private async phase2_plan(): Promise<PhaseResult> {
    return { success: true, data: {} };
  }

  private async phase3_execute(): Promise<PhaseResult> {
    return { success: true, data: {} };
  }

  private async phase4_observe(): Promise<PhaseResult> {
    return { success: true, data: {} };
  }

  private extractSearchTerms(query: string): string[] {
    const terms = query.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(term => term.length > 2);
    
    const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has', 'her', 'was', 'one', 'our', 'out']);
    return terms.filter(term => !stopWords.has(term));
  }

  private extractEntities(query: string): string[] {
    const entityPatterns = [
      /\b(aramco|sabic|stc|acwa|almarai|pif|sabb|snb|alinma|albilad|riyad bank)\b/gi,
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g,
    ];
    
    const entities: string[] = [];
    for (const pattern of entityPatterns) {
      const matches = query.match(pattern);
      if (matches) {
        entities.push(...matches);
      }
    }
    return Array.from(new Set(entities));
  }

  private classifyResearchType(query: string): string {
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes('ipo') || lowerQuery.includes('listing')) return 'ipo';
    if (lowerQuery.includes('competitor') || lowerQuery.includes('market')) return 'competitive';
    if (lowerQuery.includes('executive') || lowerQuery.includes('ceo') || lowerQuery.includes('leadership')) return 'executive';
    if (lowerQuery.includes('financial') || lowerQuery.includes('revenue') || lowerQuery.includes('profit')) return 'financial';
    if (lowerQuery.includes('investment') || lowerQuery.includes('funding')) return 'investment';
    return 'general';
  }

  private extractFindings(agentResults: AgentResult[]): ResearchFinding[] {
    return (agentResults as any[]).flatMap((result: any, index: number) => 
      result.findings.map((finding: string, findingIndex: number) => ({
        id: `finding-${index}-${findingIndex}`,
        claim: finding,
        evidence: result.recommendations || [],
        confidence: result.confidence || 0.5,
        sourceIds: this.sources.slice(0, 3).map((s: any) => s.id),
        contradictions: [],
        verified: (result.confidence || 0) > 0.7,
      }))
    ) as unknown as ResearchFinding[];
  }

  private calculateOverallConfidence(): number {
    if (this.agentResults.length === 0) return 0;
    const totalConfidence = this.agentResults.reduce((sum: number, r: any) => sum + (r.confidence || 0.5), 0);
    return totalConfidence / this.agentResults.length;
  }
}

export async function createResearchJob(query: string, options?: ResearchOptions): Promise<string> {
  const result = await db.insert(researchJobsTable)
    .values(({
      query,
      status: 'pending',
      progress: 0,
      sources: [],
      findings: [],
      agentResults: [],
    } as any))
    .returning({ id: researchJobsTable.id });
  
  console.log(`[Orchestrator] Created job ${result[0].id} with options:`, options);
  return String(result[0].id);
}

export async function getResearchJob(jobId: string): Promise<ResearchJob | null> {
  const result = await db.select()
    .from(researchJobsTable)
    .where(eq(researchJobsTable.id, parseInt(String(jobId), 10) || 0))
    .limit(1);
  
  return result[0] || null;
}

export async function executeResearchJob(jobId: string, options?: ResearchOptions): Promise<ResearchJob | null> {
  const job = await getResearchJob(jobId);
  if (!job) return null;
  
  console.log(`[Orchestrator] Executing job ${jobId} with sources:`, options?.sources);
  const orchestrator = new ResearchOrchestrator(jobId, job.query, options);
  return orchestrator.execute();
}
