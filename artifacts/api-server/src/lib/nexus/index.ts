/**
 * NEXUS — Autonomous AI-Native Lead Intelligence Engine
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Central entry point. Import everything from here.
 *
 * NEXUS is the main engine powering every AI and scraping operation in
 * ProspectSA. All routes, enrichment agents, and Lead Factory pipelines
 * route through this module.
 *
 * Architecture layers (all accessible from this index):
 *
 *   Layer 1 │ Multi-Model Inference Fabric  (llm-router)
 *           │ OpenRouter → DeepSeek V3 → Groq Llama → Mistral → Qwen
 *           │ Gemini 2.5 Flash → Claude → GPT-4o → Ollama
 *
 *   Layer 2 │ Anti-Detection Browser Mesh   (power-scraper + session-manager)
 *           │ Cheerio → Playwright → Playwright+Stealth → BeautifulSoup
 *
 *   Layer 3 │ Evasion & Identity System     (proxy-manager + captcha-solver)
 *           │ WebShare → IPRoyal → LunaProxy → SimplyNode 5G
 *           │ NopeCHA → AZcaptcha → CapMonster → DeathByCaptcha
 *
 *   Layer 4 │ Autonomous Web Harvester      (web-seeder → power-scraper)
 *           │ BFS multi-page crawler, pagination, infinite scroll
 *
 *   Layer 5 │ OSINT Enrichment              (coming: TheHarvester, Sherlock)
 *
 *   Layer 6 │ Lead Orchestration            (coming: Activepieces webhooks)
 *
 * Quick usage:
 *
 *   import { nexus } from "../lib/nexus/index.js";
 *
 *   // Cheap extraction (DeepSeek, $0.28/MTok)
 *   const result = await nexus.extract(rawText, "Extract company name, phone, email as JSON");
 *
 *   // Arabic-optimised generation (Qwen 72B → Gemini fallback)
 *   const result = await nexus.generate(prompt, { tier: "arabic" });
 *
 *   // Final synthesis dossier (Gemini → Claude → GPT-4o)
 *   const result = await nexus.synthesize(data, "Write a B2B intelligence report");
 *
 *   // Get proxy for scraping
 *   const proxy = nexus.getProxy("per-request");
 *
 *   // Solve a CAPTCHA
 *   const solved = await nexus.solveCaptcha({ type: "recaptcha-v2", pageUrl, siteKey });
 *
 *   // Full engine status
 *   const status = nexus.status();
 */

export {
  nexusGenerate,
  nexusExtract,
  nexusSynthesize,
  nexusRealtime,
  nexusRunRole,
  nexusFusion,
  getLLMStatus,
  getSessionUsage,
  clearSessionUsage,
  type TaskTier,
  type NexusGenerateOptions,
  type NexusGenerateResult,
  type NexusFusionOptions,
  type NexusFusionResult,
  type UsageRecord,
  type NexusLLMStatus,
} from "./llm-router.js";

export {
  getProxy,
  getProxyStatus,
  clearStickySessions,
  type ProxyStrategy,
  type ProxyProvider,
  type ProxyConfig,
  type ProxyResult,
  type ProxyStatus,
} from "./proxy-manager.js";

export {
  solveCaptcha,
  isCaptchaAvailable,
  getCaptchaStatus,
  type CaptchaType,
  type CaptchaTaskOptions,
  type CaptchaSolveResult,
  type CaptchaStatus,
} from "./captcha-solver.js";

export {
  randomUAProfile,
  buildRealisticHeaders,
  humanJitter,
  lightJitter,
  warmUpSession,
  hardenPage,
  simulateMouseMovement,
  simulateScroll,
  UA_PROFILES,
  type UAProfile,
} from "./session-manager.js";

// ── Convenience facade ─────────────────────────────────────────────────────────

import {
  nexusGenerate,
  nexusExtract,
  nexusSynthesize,
  nexusRealtime,
  getLLMStatus,
  getSessionUsage,
} from "./llm-router.js";

import { getProxy, getProxyStatus } from "./proxy-manager.js";
import { solveCaptcha, isCaptchaAvailable, getCaptchaStatus } from "./captcha-solver.js";
import { getLLMStatus as _llm, getSessionUsage as _usage } from "./llm-router.js";

export const nexus = {
  /** Route a prompt to the optimal LLM for the task tier */
  generate: nexusGenerate,

  /** Extract structured data using cheap models (DeepSeek/Groq) */
  extract: nexusExtract,

  /** Write final synthesis using frontier models (Gemini/Claude) */
  synthesize: nexusSynthesize,

  /** Real-time fast generation via Groq */
  realtime: nexusRealtime,

  /** Get a proxy for scraping requests */
  getProxy,

  /** Solve a CAPTCHA using the escalating provider chain */
  solveCaptcha,

  /** Full engine status — all layers */
  status(): NexusEngineStatus {
    return {
      llm: getLLMStatus(),
      proxy: getProxyStatus(),
      captcha: getCaptchaStatus(),
      session: getSessionUsage(),
      version: "1.0.0",
      buildDate: "2025-05-14",
    };
  },
};

// ── Engine status type ─────────────────────────────────────────────────────────

import type { NexusLLMStatus } from "./llm-router.js";
import type { ProxyStatus } from "./proxy-manager.js";
import type { CaptchaStatus } from "./captcha-solver.js";

export interface NexusEngineStatus {
  llm: NexusLLMStatus;
  proxy: ProxyStatus;
  captcha: CaptchaStatus;
  session: { records: import("./llm-router.js").UsageRecord[]; totalCostUSD: number };
  version: string;
  buildDate: string;
}
