import type { Express } from "express";
import {
  scanWebsite,
  startExtraction,
  getProspectingJob,
  getProspectingResults,
  listProspectingJobs,
  deleteProspectingJob,
  exportProspectingResults,
  listExportHistory,
} from "./engine";

export function registerProspectingRoutes(app: Express) {
  app.get("/api/prospecting", async (_req, res) => {
    try {
      const jobs = await listProspectingJobs();
      res.json(jobs);
    } catch (error) {
      console.error("Prospecting list error:", error);
      res.status(500).json({ error: "Failed to list prospecting jobs" });
    }
  });

  app.get("/api/prospecting/exports/history", async (_req, res) => {
    try {
      const history = await listExportHistory();
      res.json(history);
    } catch (error) {
      console.error("Prospecting export history error:", error);
      res.status(500).json({ error: "Failed to fetch export history" });
    }
  });

  app.post("/api/prospecting/scan", async (req, res): Promise<void> => {
    try {
      const { url } = req.body;
      if (!url) {
        res.status(400).json({ error: "URL is required" });
        return;
      }
      let parsed: URL;
      try { parsed = new URL(url); } catch {
        res.status(400).json({ error: "Invalid URL format" });
        return;
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        res.status(400).json({ error: "Only HTTP/HTTPS URLs are allowed" });
        return;
      }
      const blockedHosts = new Set([
        'localhost', '0.0.0.0', '[::1]', '[::]', '::',
        'metadata.google.internal', 'metadata.google',
        'instance-data', 'metadata',
      ]);
      const hn = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
      function isPrivateIP(host: string): boolean {
        if (blockedHosts.has(host)) return true;
        if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
        if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
        if (/^0+\.0+\.0+\.0+$/.test(host)) return true;
        if (host.startsWith('10.')) return true;
        if (host.startsWith('192.168.')) return true;
        if (host.startsWith('172.')) {
          const oct2 = parseInt(host.split('.')[1], 10);
          if (oct2 >= 16 && oct2 <= 31) return true;
        }
        if (host.startsWith('169.254.')) return true;
        if (/^fe80/i.test(host)) return true;
        if (/^f[cd]/i.test(host)) return true;
        if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return true;
        if (/^\d+$/.test(host)) return true;
        if (/^0x/i.test(host)) return true;
        if (/^0\d/.test(host)) return true;
        return false;
      }
      if (isPrivateIP(hn)) {
        res.status(400).json({ error: "Internal/private URLs are not allowed" });
        return;
      }
      const dns = await import('dns');
      const { promisify } = await import('util');
      const resolve4 = promisify(dns.resolve4);
      const resolve6 = promisify(dns.resolve6);
      try {
        const [v4Addrs, v6Addrs] = await Promise.allSettled([resolve4(hn), resolve6(hn)]);
        const allAddrs = [
          ...(v4Addrs.status === 'fulfilled' ? v4Addrs.value : []),
          ...(v6Addrs.status === 'fulfilled' ? v6Addrs.value : []),
        ];
        if (allAddrs.some((addr: string) => isPrivateIP(addr))) {
          res.status(400).json({ error: "Internal/private URLs are not allowed" });
          return;
        }
      } catch { /* non-resolvable or IP literal */ }
      console.log(`[Prospecting] Scan request: ${url}`);
      const job = await scanWebsite(url);
      res.json(job);
    } catch (error) {
      console.error("Prospecting scan error:", error);
      res.status(500).json({ error: "Failed to start website scan" });
    }
  });

  app.post("/api/prospecting/:jobId/extract", async (req, res) => {
    try {
      const { settings } = req.body;
      const job = await startExtraction(req.params.jobId, settings || {});
      res.json(job);
    } catch (error) {
      console.error("Prospecting extraction error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to start extraction" });
    }
  });

  app.get("/api/prospecting/:jobId/results", async (req, res) => {
    try {
      const results = await getProspectingResults(req.params.jobId);
      res.json(results);
    } catch (error) {
      console.error("Prospecting results error:", error);
      res.status(500).json({ error: "Failed to fetch results" });
    }
  });

  app.post("/api/prospecting/:jobId/export", async (req, res): Promise<void> => {
    try {
      const { format } = req.body;
      if (!format) {
        res.status(400).json({ error: "Export format is required" });
        return;
      }
      const result = await exportProspectingResults(req.params.jobId, format);
      res.json(result);
    } catch (error) {
      console.error("Prospecting export error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to export results" });
    }
  });

  app.get("/api/prospecting/:jobId", async (req, res): Promise<void> => {
    try {
      const job = await getProspectingJob(req.params.jobId);
      if (!job) {
        res.status(404).json({ error: "Job not found" });
        return;
      }
      res.json(job);
    } catch (error) {
      console.error("Prospecting fetch error:", error);
      res.status(500).json({ error: "Failed to fetch prospecting job" });
    }
  });

  app.delete("/api/prospecting/:jobId", async (req, res) => {
    try {
      await deleteProspectingJob(req.params.jobId);
      res.json({ success: true });
    } catch (error) {
      console.error("Prospecting delete error:", error);
      res.status(500).json({ error: "Failed to delete job" });
    }
  });
}
