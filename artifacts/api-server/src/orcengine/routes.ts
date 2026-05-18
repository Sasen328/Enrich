import type { Express } from "express";
import { db } from "@workspace/db";
import { companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createResearchJob, getResearchJob, executeResearchJob } from "./orchestrator";
import { getLatestNews, refreshNewsCache, getNewsByCategory, getNewsSources } from "./news";
import { enrichPerson, enrichCompany, getEnrichmentReport, chatWithReport, chatWithResearchJob, enrichDatabaseCompanies, enrichDatabaseExecutives } from "./enrichment";
import { crawlUrls } from "./crawler";
import { getTemplates, createTemplate, getTemplateById, executeTemplate } from "./templates";
import { createScrapeSession, getScrapeSession, getAllScrapeSessions, deleteScrapeSession, addUrlsToSession, chatWithSession, crawlFullWebsite, generateKnowledgeReport } from "./scraper";
import { generateStructuredReport, generateCompanyReportHTML, generatePersonReportHTML, type ExportFormat } from "./export-service";

export function registerOrcEngineRoutes(app: Express) {
  app.post("/api/orcengine/research", async (req, res) => {
    try {
      const { query, sources, filters, deepVerify } = req.body;
      if (!query) {
        return res.status(400).json({ error: "Query is required" });
      }

      console.log(`[OrcEngine Research] Query: "${query}"`);
      console.log(`[OrcEngine Research] Selected sources: ${sources?.join(', ') || 'all'}`);
      console.log(`[OrcEngine Research] Filters:`, filters);
      console.log(`[OrcEngine Research] Deep verify: ${deepVerify}`);

      const jobId = await createResearchJob(query, { sources, filters, deepVerify });
      
      executeResearchJob(jobId, { sources, filters, deepVerify }).catch(err => {
        console.error("Research job failed:", err);
      });

      res.json({ jobId, status: "pending" });
    } catch (error) {
      console.error("Research creation error:", error);
      res.status(500).json({ error: "Failed to create research job" });
    }
  });

  app.get("/api/orcengine/research", async (_req, res) => {
    try {
      const { db } = await import("@workspace/db");
      const { researchJobsTable } = await import("@workspace/db");
      const { desc } = await import("drizzle-orm");
      const jobs = await db.select().from(researchJobsTable).orderBy(desc(researchJobsTable.createdAt)).limit(50);
      res.json(jobs);
    } catch (error) {
      console.error("Research list error:", error);
      res.status(500).json({ error: "Failed to list research jobs" });
    }
  });

  app.get("/api/orcengine/research/:jobId", async (req, res) => {
    try {
      const job = await getResearchJob(req.params.jobId);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }
      res.json(job);
    } catch (error) {
      console.error("Research fetch error:", error);
      res.status(500).json({ error: "Failed to fetch research job" });
    }
  });

  // AI Enhance endpoint — improves search queries via OpenAI (direct or AI_INTEGRATIONS proxy)
  app.post("/api/orcengine/enhance", async (req, res) => {
    try {
      const { query } = req.body;
      if (!query) {
        return res.status(400).json({ error: "Query is required" });
      }

      // Prefer AI_INTEGRATIONS proxy if configured, otherwise direct OpenAI
      const baseUrl = process.env.AI_INTEGRATIONS_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
      const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
      if (!baseUrl || !apiKey) {
        console.error('AI Integrations not configured');
        return res.status(500).json({ error: "AI service not configured" });
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `You are a query optimizer. Your task is to enhance search queries to get better, more comprehensive results.

IMPORTANT RULES:
1. ONLY add context that is directly relevant to what the user asked
2. DO NOT add terms the user didn't mention (like Vision 2030, TASI, NOMU, CMA, PIF) unless they specifically asked about those topics
3. Keep the original intent and focus of the query
4. Expand abbreviations and add synonyms for terms the user DID mention
5. Add temporal context only if the user indicated time relevance
6. Keep the query focused - do not broaden beyond what was asked

Return ONLY the enhanced query text, no explanations.`
            },
            {
              role: 'user',
              content: `Enhance this search query while preserving its original intent. Do not add topics the user didn't ask about:\n\n"${query}"`
            }
          ],
          max_completion_tokens: 500,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('AI enhance error:', error);
        return res.status(500).json({ error: "Failed to enhance query" });
      }

      const data = await response.json();
      const enhancedQuery = data.choices?.[0]?.message?.content?.trim() || query;
      
      console.log(`AI Enhanced query: "${query}" -> "${enhancedQuery}"`);
      res.json({ originalQuery: query, enhancedQuery });
    } catch (error) {
      console.error("Query enhancement error:", error);
      res.status(500).json({ error: "Failed to enhance query" });
    }
  });

  // Research job chat endpoint
  app.post("/api/orcengine/research/:jobId/chat", async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      const job = await getResearchJob(req.params.jobId);
      if (!job) {
        return res.status(404).json({ error: "Research job not found" });
      }

      const response = await chatWithResearchJob(job, message);
      res.json({ response });
    } catch (error) {
      console.error("Research chat error:", error);
      res.status(500).json({ error: "Failed to process chat message" });
    }
  });

  app.get("/api/orcengine/news", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 60;
      const categories = req.query.categories ? (req.query.categories as string).split(',') : undefined;
      
      // Use Perplexity API for real-time news with AI analysis
      const { fetchRealTimeNews } = await import('./news');
      const newsWithAnalysis = await fetchRealTimeNews(limit, categories);
      
      if (newsWithAnalysis.length > 0) {
        console.log(`[News] Returning ${newsWithAnalysis.length} real-time articles from Perplexity API`);
        return res.json(newsWithAnalysis);
      }
      
      // Fallback to cached news only if Perplexity completely fails
      console.log('[News] Perplexity returned no results, checking cache');
      const category = req.query.category as string;
      const news = category 
        ? await getNewsByCategory(category, limit)
        : await getLatestNews(limit);
      
      if (news.length === 0) {
        return res.status(503).json({ 
          error: "No news available. Perplexity API may be unavailable.",
          message: "Unable to fetch real-time news. Please try again later."
        });
      }
      
      res.json(news);
    } catch (error) {
      console.error("News fetch error:", error);
      res.status(500).json({ error: "Failed to fetch news from Perplexity API" });
    }
  });

  app.post("/api/orcengine/news/refresh", async (req, res) => {
    try {
      const count = await refreshNewsCache();
      res.json({ success: true, articlesAdded: count });
    } catch (error) {
      console.error("News refresh error:", error);
      res.status(500).json({ error: "Failed to refresh news" });
    }
  });

  app.get("/api/orcengine/news/sources", (req, res) => {
    res.json(getNewsSources());
  });

  app.post("/api/orcengine/enrich/person", async (req, res) => {
    try {
      const { name, company, linkedinUrl, websiteUrl, email, country, reportType, sourceUrls } = req.body;
      
      // Allow LinkedIn-only enrichment OR name-based enrichment OR website enrichment
      if (!name && !linkedinUrl && !websiteUrl && !email) {
        return res.status(400).json({ error: "Name, LinkedIn URL, website URL, or email is required" });
      }

      console.log(`[Person Enrichment] Name: ${name || 'N/A'}, LinkedIn: ${linkedinUrl || 'N/A'}, Website: ${websiteUrl || 'N/A'}`);
      
      const report = await enrichPerson({ 
        name, 
        company, 
        linkedinUrl, 
        websiteUrl,
        email,
        country,
        reportType,
        sourceUrls 
      });
      res.json(report);
    } catch (error) {
      console.error("Person enrichment error:", error);
      res.status(500).json({ error: "Failed to enrich person" });
    }
  });

  app.post("/api/orcengine/enrich/company", async (req, res) => {
    try {
      const { name, domain, ticker, websiteUrl, industry, country, reportType } = req.body;
      if (!name && !websiteUrl) {
        return res.status(400).json({ error: "Company name or website URL is required" });
      }

      const report = await enrichCompany({ name, domain, ticker, websiteUrl, industry, country, reportType });
      res.json(report);
    } catch (error) {
      console.error("Company enrichment error:", error);
      res.status(500).json({ error: "Failed to enrich company" });
    }
  });

  app.get("/api/orcengine/enrich/reports", async (_req, res) => {
    try {
      const { db } = await import("@workspace/db");
      const { enrichmentReportsTable } = await import("@workspace/db");
      const { desc } = await import("drizzle-orm");
      const reports = await db.select().from(enrichmentReportsTable).orderBy(desc(enrichmentReportsTable.createdAt)).limit(50);
      res.json(reports);
    } catch (error) {
      console.error("Enrichment reports list error:", error);
      res.status(500).json({ error: "Failed to list enrichment reports" });
    }
  });

  app.get("/api/orcengine/enrich/:id", async (req, res) => {
    try {
      const report = await getEnrichmentReport(req.params.id);
      if (!report) {
        return res.status(404).json({ error: "Report not found" });
      }
      res.json(report);
    } catch (error) {
      console.error("Enrichment fetch error:", error);
      res.status(500).json({ error: "Failed to fetch enrichment report" });
    }
  });

  // Chat with enrichment report - AI assistant for follow-up questions
  app.post("/api/orcengine/enrich/:id/chat", async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      const response = await chatWithReport(req.params.id, message);
      res.json({ response });
    } catch (error) {
      console.error("Report chat error:", error);
      res.status(500).json({ error: "Failed to process chat message" });
    }
  });

  // Save enrichment report → main companies/MeshBase DB
  app.post("/api/orcengine/enrich/:id/save-to-companies", async (req, res) => {
    try {
      const report = await getEnrichmentReport(req.params.id);
      if (!report) return res.status(404).json({ error: "Report not found" });
      if (report.type !== "company") return res.status(400).json({ error: "Only company reports can be saved to companies DB" });

      const rd = report.reportData as any;
      const overview = rd?.companyOverview || {};
      const financials = rd?.financials || {};
      const leadership = rd?.leadership || {};

      const existing = await db.select({ id: companiesTable.id })
        .from(companiesTable)
        .where(eq(companiesTable.nameEn, String(report.subjectName || "")))
        .limit(1);

      if (existing.length > 0) {
        // Update
        await db.update(companiesTable).set({
          description: String(rd?.profileSummary || rd?.executiveSummary || ""),
          revenue: String(financials?.annualRevenue || ""),
          enrichmentStatus: "enriched",
          enrichmentScore: 90,
          updatedAt: new Date(),
        } as any).where(eq(companiesTable.id, existing[0].id));
        res.json({ action: "updated", companyId: existing[0].id, name: report.subjectName });
      } else {
        // Insert new
        const [inserted] = await db.insert(companiesTable).values({
          nameEn: String(report.subjectName || ""),
          nameAr: String(rd?.arabicName || overview?.arabicName || ""),
          industry: String(overview?.industry || rd?.industry || ""),
          city: String(overview?.headquarters?.city || overview?.city || ""),
          country: "Saudi Arabia",
          description: String(rd?.profileSummary || rd?.executiveSummary || ""),
          revenue: String(financials?.annualRevenue || ""),
          website: String(overview?.website || rd?.website || ""),
          enrichmentStatus: "enriched",
          enrichmentScore: 90,
          dataSource: "orcengine",
        } as any).returning({ id: companiesTable.id });
        res.json({ action: "inserted", companyId: inserted.id, name: report.subjectName });
      }
    } catch (error) {
      console.error("Save to companies error:", error);
      res.status(500).json({ error: "Failed to save to companies DB" });
    }
  });


  app.get("/api/orcengine/scrape/sessions", async (req, res) => {
    try {
      const sessions = await getAllScrapeSessions();
      res.json(sessions);
    } catch (error) {
      console.error("List sessions error:", error);
      res.status(500).json({ error: "Failed to list sessions" });
    }
  });

  app.post("/api/orcengine/scrape", async (req, res) => {
    try {
      const { urls, engine = "playwright" } = req.body;
      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: "URLs array is required" });
      }

      console.log(`[Scrape API] Starting scrape with engine: ${engine} for ${urls.length} URLs`);
      const session = await createScrapeSession(urls, engine);
      res.json(session);
    } catch (error) {
      console.error("Scrape session error:", error);
      res.status(500).json({ error: "Failed to create scrape session" });
    }
  });

  app.delete("/api/orcengine/scrape/:sessionId", async (req, res) => {
    try {
      await deleteScrapeSession(req.params.sessionId);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete session error:", error);
      res.status(500).json({ error: "Failed to delete session" });
    }
  });

  app.get("/api/orcengine/scrape/:sessionId", async (req, res) => {
    try {
      const session = await getScrapeSession(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json(session);
    } catch (error) {
      console.error("Scrape session fetch error:", error);
      res.status(500).json({ error: "Failed to fetch scrape session" });
    }
  });

  app.post("/api/orcengine/scrape/:sessionId/urls", async (req, res) => {
    try {
      const { urls } = req.body;
      if (!urls || !Array.isArray(urls)) {
        return res.status(400).json({ error: "URLs array is required" });
      }

      const session = await addUrlsToSession(req.params.sessionId, urls);
      res.json(session);
    } catch (error) {
      console.error("Add URLs error:", error);
      res.status(500).json({ error: "Failed to add URLs" });
    }
  });

  app.post("/api/orcengine/scrape/:sessionId/chat", async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      const response = await chatWithSession(req.params.sessionId, message);
      res.json({ response });
    } catch (error) {
      console.error("Chat error:", error);
      res.status(500).json({ error: "Failed to process chat" });
    }
  });

  // Full website crawl - discovers and crawls all pages
  app.post("/api/orcengine/scrape/full-website", async (req, res) => {
    try {
      const { url, maxPages = 50 } = req.body;
      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }

      console.log(`[OrcEngine] Starting full website crawl: ${url} (max ${maxPages} pages)`);
      const result = await crawlFullWebsite(url, Math.min(maxPages, 100));
      
      // Store as a scrape session
      const { db, scrapeSessionsTable } = await import("@workspace/db");
      
      const [session] = await db.insert(scrapeSessionsTable)
        .values({
          urls: result.urls,
          knowledgeBase: result.knowledgeBase,
          chatHistory: [],
          status: 'active',
        })
        .returning();
      
      res.json({ 
        sessionId: session.id,
        urlsCrawled: result.urls.length,
        knowledgeChunks: result.knowledgeBase.length,
        urls: result.urls.slice(0, 20)
      });
    } catch (error) {
      console.error("Full website crawl error:", error);
      res.status(500).json({ error: "Failed to crawl website" });
    }
  });

  // Generate organized GPT report from knowledge base
  app.post("/api/orcengine/scrape/:sessionId/generate-report", async (req, res) => {
    try {
      const { reportType = 'general' } = req.body;
      const validTypes = ['company', 'product', 'general'];
      
      if (!validTypes.includes(reportType)) {
        return res.status(400).json({ error: "Invalid report type. Use: company, product, or general" });
      }

      console.log(`[OrcEngine] Generating ${reportType} report for session ${req.params.sessionId}`);
      const report = await generateKnowledgeReport(req.params.sessionId, reportType);
      
      res.json({ 
        success: true,
        report
      });
    } catch (error) {
      console.error("Report generation error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to generate report" });
    }
  });

  // POST /api/orcengine/scrape/:sessionId/seed
  // Seeds scraped company data from a scrape session into the companies DB.
  app.post("/api/orcengine/scrape/:sessionId/seed", async (req, res) => {
    try {
      const { sessionId } = req.params;

      // Load the scrape session
      const session = await getScrapeSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: "Scrape session not found" });
      }

      const knowledgeBase = (session.knowledgeBase as any[]) || [];
      if (!knowledgeBase.length) {
        return res.status(400).json({ error: "Session has no knowledge base — run a scrape first" });
      }

      // Extract the primary URL from the session to derive a company name / website
      const urls = (session.urls as string[]) || [];
      const primaryUrl = urls[0] || "";

      // Derive domain from URL for dedup key
      let domain = "";
      try {
        domain = new URL(primaryUrl).hostname.replace(/^www\./, "");
      } catch { /* ignore */ }

      // Build a summary from the knowledge base chunks
      const textContent = knowledgeBase
        .map((chunk: any) => (typeof chunk === "string" ? chunk : chunk?.content || chunk?.text || ""))
        .filter(Boolean)
        .join("\n")
        .slice(0, 6000);

      // Extract emails and phones from knowledge base
      const emailPattern = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
      const phonePattern = /(?:\+966|00966|0)[\s.\-]?\d{2}[\s.\-]?\d{3}[\s.\-]?\d{4}/g;
      const emails = [...new Set(textContent.match(emailPattern) || [])].slice(0, 3);
      const phones = [...new Set(textContent.match(phonePattern) || [])].slice(0, 3);

      // Check if company already exists by domain
      const { db, companiesTable } = await import("@workspace/db");
      const { eq, ilike } = await import("drizzle-orm");

      let existing = null;
      if (domain) {
        const rows = await db
          .select({ id: companiesTable.id })
          .from(companiesTable)
          .where(ilike(companiesTable.website, `%${domain}%`))
          .limit(1);
        existing = rows[0] || null;
      }

      const description = textContent.slice(0, 500).trim() || null;
      const now = new Date();

      if (existing) {
        // Update existing company with scraped data
        await db.update(companiesTable).set({
          description: description || undefined,
          email: emails[0] || undefined,
          phone: phones[0] || undefined,
          enrichmentStatus: "partial",
          updatedAt: now,
          dataSource: "orcengine:scrape",
        } as any).where(eq(companiesTable.id, existing.id));

        return res.json({
          ok: true,
          action: "updated",
          companyId: existing.id,
          domain,
          emailsFound: emails.length,
          phonesFound: phones.length,
        });
      }

      // Insert new company from scraped data
      const [inserted] = await db.insert(companiesTable).values({
        nameEn: domain || "Unknown (from scrape)",
        website: primaryUrl || null,
        email: emails[0] || null,
        phone: phones[0] || null,
        description: description,
        country: "Saudi Arabia",
        enrichmentStatus: "partial",
        enrichmentScore: 20,
        dataSource: "orcengine:scrape",
      } as any).returning({ id: companiesTable.id });

      res.json({
        ok: true,
        action: "inserted",
        companyId: inserted.id,
        domain,
        emailsFound: emails.length,
        phonesFound: phones.length,
      });

    } catch (error) {
      console.error("[OrcEngine] Seed to companies error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to seed to companies" });
    }
  });


  app.get("/api/orcengine/templates", async (req, res) => {
    try {
      const category = req.query.category as string;
      const templates = await getTemplates(category);
      res.json(templates);
    } catch (error) {
      console.error("Templates fetch error:", error);
      res.status(500).json({ error: "Failed to fetch templates" });
    }
  });

  app.get("/api/orcengine/templates/:id", async (req, res) => {
    try {
      const template = await getTemplateById(req.params.id);
      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }
      res.json(template);
    } catch (error) {
      console.error("Template fetch error:", error);
      res.status(500).json({ error: "Failed to fetch template" });
    }
  });

  app.post("/api/orcengine/templates", async (req, res) => {
    try {
      const { name, description, category, config } = req.body;
      if (!name || !category) {
        return res.status(400).json({ error: "Name and category are required" });
      }

      const template = await createTemplate({ name, description, category, config });
      res.json(template);
    } catch (error) {
      console.error("Template creation error:", error);
      res.status(500).json({ error: "Failed to create template" });
    }
  });

  // Execute a template with multi-agent orchestration
  app.post("/api/orcengine/templates/:id/execute", async (req, res) => {
    try {
      const { targetName, targetWebsite } = req.body;
      if (!targetName) {
        return res.status(400).json({ error: "Target name is required" });
      }

      console.log(`[Route] Executing template ${req.params.id} for: ${targetName}`);
      const result = await executeTemplate(req.params.id, targetName, targetWebsite);
      res.json(result);
    } catch (error) {
      console.error("Template execution error:", error);
      res.status(500).json({ error: "Failed to execute template" });
    }
  });

  app.post("/api/orcengine/crawl", async (req, res) => {
    try {
      const { urls } = req.body;
      if (!urls || !Array.isArray(urls)) {
        return res.status(400).json({ error: "URLs array is required" });
      }

      const results = await crawlUrls(urls);
      res.json(results);
    } catch (error) {
      console.error("Crawl error:", error);
      res.status(500).json({ error: "Failed to crawl URLs" });
    }
  });

  // General export endpoint for companies/executives data
  app.post("/api/orcengine/export", async (req, res) => {
    try {
      const { title, type, data, format } = req.body as { title: string; type: string; data: Record<string, unknown>; format: ExportFormat };
      const validFormats: ExportFormat[] = ['pdf', 'word', 'excel', 'ppt', 'json', 'csv'];
      const fmt = (format === 'csv' ? 'excel' : format) as ExportFormat;
      if (!fmt || !validFormats.includes(fmt)) {
        return res.status(400).json({ error: "Valid format required" });
      }
      if (format === 'json') {
        res.setHeader('Content-Disposition', `attachment; filename="${title || 'export'}.json"`);
        res.setHeader('Content-Type', 'application/json');
        return res.send(JSON.stringify(data?.records || data, null, 2));
      }
      if (format === 'csv') {
        const records = (data?.records as Record<string, unknown>[]) || [];
        if (records.length === 0) return res.status(400).json({ error: "No data to export" });
        const headers = Object.keys(records[0]);
        const csv = [headers.join(','), ...records.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))].join('\n');
        res.setHeader('Content-Disposition', `attachment; filename="${title || 'export'}.csv"`);
        res.setHeader('Content-Type', 'text/csv');
        return res.send(csv);
      }
      const report = await generateStructuredReport(data as any, String(title || 'Export'), fmt);
      if (!(report as any).buffer && !report.content) return res.status(500).json({ error: "Export failed" });
      res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
      res.setHeader('Content-Type', (report as any).contentType || report.mimeType || 'application/octet-stream');
      return res.send((report as any).buffer || report.content);
    } catch (error) {
      console.error("General export error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Export failed" });
    }
  });

  // Export enrichment report in various formats
  app.post("/api/orcengine/enrichment/:reportId/export", async (req, res) => {
    try {
      const { format } = req.body as { format: ExportFormat };
      const validFormats: ExportFormat[] = ['pdf', 'word', 'excel', 'ppt', 'json'];
      
      if (!format || !validFormats.includes(format)) {
        return res.status(400).json({ error: "Valid format required: pdf, word, excel, ppt, json" });
      }

      const report = await getEnrichmentReport(req.params.reportId);
      if (!report) {
        return res.status(404).json({ error: "Report not found" });
      }

      const exportResult = await generateStructuredReport(
        report.reportData as any as any, String(report.subjectName || ''), format);

      res.json({
        format: exportResult.format,
        filename: exportResult.filename,
        content: exportResult.content,
        mimeType: exportResult.mimeType,
      });
    } catch (error) {
      console.error("Export error:", error);
      res.status(500).json({ error: "Failed to export report" });
    }
  });

  // Generate HTML report for preview/print
  app.get("/api/orcengine/enrichment/:reportId/html", async (req, res) => {
    try {
      const report = await getEnrichmentReport(req.params.reportId);
      if (!report) {
        return res.status(404).json({ error: "Report not found" });
      }

      // Use appropriate HTML generator based on report type
      const html = report.type === 'person' 
        ? await generatePersonReportHTML(report.reportData, report.subjectName)
        : await generateCompanyReportHTML(report.reportData, report.subjectName);
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error("HTML generation error:", error);
      res.status(500).json({ error: "Failed to generate HTML report" });
    }
  });

  // Export research job report
  app.post("/api/orcengine/research/:jobId/export", async (req, res) => {
    try {
      const { format } = req.body as { format: ExportFormat };
      const validFormats: ExportFormat[] = ['pdf', 'word', 'excel', 'ppt', 'json'];
      
      if (!format || !validFormats.includes(format)) {
        return res.status(400).json({ error: "Valid format required: pdf, word, excel, ppt, json" });
      }

      const job = await getResearchJob(req.params.jobId);
      if (!job) {
        return res.status(404).json({ error: "Research job not found" });
      }

      const exportResult = await generateStructuredReport(
        job.report || {} as any, job.query || 'Research Report', format);

      res.json({
        format: exportResult.format,
        filename: exportResult.filename,
        content: exportResult.content,
        mimeType: exportResult.mimeType,
      });
    } catch (error) {
      console.error("Export error:", error);
      res.status(500).json({ error: "Failed to export research" });
    }
  });

  // Firecrawl endpoints removed - service not available
  app.post("/api/firecrawl/scrape", (_req, res) => {
    res.status(503).json({ success: false, error: "Firecrawl service not available. Use Playwright engine instead." });
  });
  app.post("/api/firecrawl/crawl", (_req, res) => {
    res.status(503).json({ success: false, error: "Firecrawl service not available. Use Playwright engine instead." });
  });
  app.post("/api/firecrawl/map", (_req, res) => {
    res.status(503).json({ success: false, error: "Firecrawl service not available. Use Playwright engine instead." });
  });
  app.post("/api/firecrawl/extract", (_req, res) => {
    res.status(503).json({ success: false, error: "Firecrawl service not available. Use Playwright engine instead." });
  });
  app.post("/api/firecrawl/batch", (_req, res) => {
    res.status(503).json({ success: false, error: "Firecrawl service not available. Use Playwright engine instead." });
  });

  // Database Enrichment Routes
  app.post("/api/orcengine/enrich/companies", async (req, res) => {
    try {
      const { limit } = req.body;
      console.log(`[API] Starting batch company enrichment (limit: ${limit || 50})`);
      
      const result = await enrichDatabaseCompanies(limit || 50);
      res.json({ 
        success: true, 
        message: `Enriched ${result.enriched} companies with ${result.errors} errors`,
        ...result 
      });
    } catch (error) {
      console.error("Batch company enrichment error:", error);
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Enrichment failed" });
    }
  });

  app.post("/api/orcengine/enrich/executives", async (req, res) => {
    try {
      const { limit } = req.body;
      console.log(`[API] Starting batch executive enrichment (limit: ${limit || 100})`);
      
      const result = await enrichDatabaseExecutives(limit || 100);
      res.json({ 
        success: true, 
        message: `Enriched ${result.enriched} executives with ${result.errors} errors`,
        ...result 
      });
    } catch (error) {
      console.error("Batch executive enrichment error:", error);
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Enrichment failed" });
    }
  });

  // ============ Smart Prospecting Engine Routes ============

}
