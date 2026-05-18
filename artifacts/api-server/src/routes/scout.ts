/**
 * Scout Routes — Express proxy to the Python Scout microservice.
 * Exposes /api/scout/* endpoints to the frontend and other Node.js routes.
 *
 * Also used internally by company-intel, masaar, and prospecting engines
 * to enrich results with real scraped contact data.
 */

import { Router, type Request, type Response } from "express";
import {
  scoutSiteIntel,
  scoutOsintHarvest,
  scoutSocialScan,
  scoutAiExtract,
  scoutAiExtractCustom,
  scoutFullScan,
  isScoutAlive,
} from "../lib/scout-client.js";

const router = Router();

// ── Health ─────────────────────────────────────────────────────────────────────

router.get("/scout/health", async (_req: Request, res: Response) => {
  const alive = await isScoutAlive();
  res.json({ ok: alive, service: "python-scout", port: 8099 });
});

// ── Site Intelligence ──────────────────────────────────────────────────────────

router.post("/scout/site-intel", async (req: Request, res: Response) => {
  const { url, follow_subpages = true, timeout = 20 } = req.body as {
    url?: string;
    follow_subpages?: boolean;
    timeout?: number;
  };
  if (!url) {
    res.status(400).json({ ok: false, error: "url is required" });
    return;
  }
  try {
    const data = await scoutSiteIntel(url, { followSubpages: follow_subpages, timeout });
    if (!data) {
      res.status(503).json({ ok: false, error: "Scout service unavailable" });
      return;
    }
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── OSINT Harvest ──────────────────────────────────────────────────────────────

router.post("/scout/osint/harvest", async (req: Request, res: Response) => {
  const { domain, brute_subdomains = true, max_subdomains = 25 } = req.body as {
    domain?: string;
    brute_subdomains?: boolean;
    max_subdomains?: number;
  };
  if (!domain) {
    res.status(400).json({ ok: false, error: "domain is required" });
    return;
  }
  try {
    const data = await scoutOsintHarvest(domain, {
      bruteSubdomains: brute_subdomains,
      maxSubdomains: max_subdomains,
    });
    if (!data) {
      res.status(503).json({ ok: false, error: "Scout service unavailable" });
      return;
    }
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── Social Presence ────────────────────────────────────────────────────────────

router.post("/scout/osint/social", async (req: Request, res: Response) => {
  const { username, platforms } = req.body as {
    username?: string;
    platforms?: string[];
  };
  if (!username) {
    res.status(400).json({ ok: false, error: "username is required" });
    return;
  }
  try {
    const data = await scoutSocialScan(username, platforms);
    if (!data) {
      res.status(503).json({ ok: false, error: "Scout service unavailable" });
      return;
    }
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── AI Extract ─────────────────────────────────────────────────────────────────

router.post("/scout/ai-extract", async (req: Request, res: Response) => {
  const { url, page_text, extraction_goal, output_schema } = req.body as {
    url?: string;
    page_text?: string;
    extraction_goal?: string;
    output_schema?: Record<string, unknown>;
  };
  if (!url) {
    res.status(400).json({ ok: false, error: "url is required" });
    return;
  }
  try {
    let data;
    if (extraction_goal && output_schema) {
      data = await scoutAiExtractCustom(url, page_text || "", extraction_goal, output_schema);
    } else {
      data = await scoutAiExtract(url, page_text || "");
    }
    if (!data) {
      res.status(503).json({ ok: false, error: "Scout service unavailable" });
      return;
    }
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── Full Scan ──────────────────────────────────────────────────────────────────

router.post("/scout/full-scan", async (req: Request, res: Response) => {
  const {
    url,
    include_osint = true,
    include_ai = true,
    include_social = false,
    social_username,
    timeout = 25,
  } = req.body as {
    url?: string;
    include_osint?: boolean;
    include_ai?: boolean;
    include_social?: boolean;
    social_username?: string;
    timeout?: number;
  };
  if (!url) {
    res.status(400).json({ ok: false, error: "url is required" });
    return;
  }
  try {
    const data = await scoutFullScan(url, {
      includeOsint: include_osint,
      includeAi: include_ai,
      includeSocial: include_social,
      socialUsername: social_username,
      timeout,
    });
    if (!data) {
      res.status(503).json({ ok: false, error: "Scout service unavailable" });
      return;
    }
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
