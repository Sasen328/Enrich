/**
 * NEXUS — Multi-Model Inference Fabric
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Routes every AI generation task to the optimal model based on:
 *   • Task complexity (extraction vs synthesis)
 *   • Language requirements (Arabic/bilingual vs English-only)
 *   • Cost constraints (cheap models for grunt work, frontier for final output)
 *   • Speed requirements (Groq for real-time, async models for bulk)
 *
 * Provider tiers (auto-fallback if key not configured):
 *
 *   Tier 1 │ EXTRACTION / PARSING / CLASSIFICATION
 *           │ DeepSeek V3   via OpenRouter  $0.28/MTok  — default cheap workhorse
 *           │ Groq Llama 3.1 70B            $0.00/MTok  — 800 tok/s, near-free
 *           │ Mistral Large via OpenRouter  $2.00/MTok  — strong at structured JSON
 *           │ Qwen 2.5 72B  via OpenRouter  $0.40/MTok  — best Arabic + English
 *
 *   Tier 2 │ ARABIC-HEAVY / BILINGUAL TASKS
 *           │ Gemini 2.5 Flash              — multilingual, grounded search
 *           │ Qwen 2.5 72B  via OpenRouter  — secondary Arabic specialist
 *
 *   Tier 3 │ COMPLEX SYNTHESIS / DOSSIER WRITING
 *           │ Gemini 2.5 Flash              — primary (already configured)
 *           │ Claude Sonnet 4               — secondary
 *           │ GPT-4o                        — tertiary
 *
 *   Tier 4 │ BULK OFFLINE / LOCAL PRIVACY
 *           │ Ollama (Llama 3, Mistral)     — $0, on-server inference
 *
 * OpenRouter model IDs used:
 *   deepseek/deepseek-chat-v3-5
 *   meta-llama/llama-3.1-70b-instruct
 *   mistralai/mistral-large
 *   qwen/qwen-2.5-72b-instruct
 *   google/gemini-2.5-flash-preview
 */

import OpenAI from "openai";
import { generateWithGemini } from "../../gemini-search.js";

// ── Cost tracking (tokens × price per MTok / 1_000_000) ────────────────────────
export interface UsageRecord {
  model: string;
  provider: "openrouter" | "gemini" | "anthropic" | "openai" | "ollama" | "groq";
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
  latencyMs: number;
}

const COST_PER_MTOK: Record<string, { in: number; out: number }> = {
  "deepseek/deepseek-chat":                { in: 0.27,  out: 0.27  },
  "deepseek/deepseek-r1":                  { in: 0.55,  out: 2.19  },
  "meta-llama/llama-3.1-70b-instruct":     { in: 0.10,  out: 0.10  },
  "meta-llama/llama-3.3-70b-instruct":     { in: 0.12,  out: 0.12  },
  "mistralai/mistral-large":               { in: 2.00,  out: 6.00  },
  "qwen/qwen-2.5-72b-instruct":            { in: 0.40,  out: 0.40  },
  "qwen/qwen3-32b":                        { in: 0.10,  out: 0.10  },
  "google/gemini-2.5-flash-preview":       { in: 0.15,  out: 0.60  },
  "anthropic/claude-sonnet-4-5":           { in: 3.00,  out: 15.00 },
  "openai/gpt-4o":                         { in: 5.00,  out: 15.00 },
  "gemini-2.5-flash":                      { in: 0.15,  out: 0.60  },
  "llama-3.3-70b-versatile":               { in: 0.00,  out: 0.00  },
  "llama-3.1-8b-instant":                  { in: 0.00,  out: 0.00  },
  "canopylabs/orpheus-arabic-saudi":        { in: 0.00,  out: 0.00  },
};

function estimateCost(model: string, promptTok: number, completionTok: number): number {
  const rates = COST_PER_MTOK[model] || { in: 1.0, out: 1.0 };
  return (promptTok * rates.in + completionTok * rates.out) / 1_000_000;
}

// ── Provider clients ───────────────────────────────────────────────────────────

function getOpenRouterClient(): OpenAI | null {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://prospectsa.app",
      "X-Title": "ProspectSA NEXUS Engine",
    },
  });
}

function getGroqClient(): OpenAI | null {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    baseURL: "https://api.groq.com/openai/v1",
  });
}

function getOllamaClient(): OpenAI | null {
  const base = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  return new OpenAI({
    apiKey: "ollama",
    baseURL: `${base}/v1`,
  });
}

function getAnthropicViaOpenRouter(): OpenAI | null {
  return getOpenRouterClient();
}

function getOpenAIClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

// ── Task type classification ────────────────────────────────────────────────────

export type TaskTier =
  | "extraction"    // parse fields from raw text, classify, normalise
  | "arabic"        // bilingual Arabic+English tasks
  | "synthesis"     // write final dossier, complex reasoning
  | "bulk"          // large volume, cost-sensitive, can be slow
  | "realtime";     // speed-critical, must respond in < 2s

export interface NexusGenerateOptions {
  tier?: TaskTier;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  trackUsage?: boolean;
  /** Force a specific model ID (overrides tier routing) */
  forceModel?: string;
  /** Force a specific provider */
  forceProvider?: "openrouter" | "groq" | "gemini" | "openai" | "anthropic" | "ollama";
}

export interface NexusGenerateResult {
  text: string;
  model: string;
  provider: string;
  usage?: UsageRecord;
}

// ── Cumulative session usage log ───────────────────────────────────────────────

const sessionUsageLog: UsageRecord[] = [];

export function getSessionUsage(): { records: UsageRecord[]; totalCostUSD: number } {
  const total = sessionUsageLog.reduce((sum, r) => sum + r.estimatedCostUSD, 0);
  return { records: [...sessionUsageLog], totalCostUSD: total };
}

export function clearSessionUsage(): void {
  sessionUsageLog.length = 0;
}

// ── Core routing logic ─────────────────────────────────────────────────────────

/**
 * Generate text using the optimal model for the given task tier.
 * Falls back through the provider chain until one succeeds.
 */
export async function nexusGenerate(
  prompt: string,
  options: NexusGenerateOptions = {}
): Promise<NexusGenerateResult> {
  const {
    tier = "extraction",
    systemPrompt,
    maxTokens = 2000,
    temperature = 0.1,
    timeoutMs = 30000,
    trackUsage = true,
    forceModel,
    forceProvider,
  } = options;

  const start = Date.now();

  // ── If forced provider/model, skip routing ─────────────────────────────────
  if (forceModel || forceProvider) {
    return runForcedProvider(prompt, { forceModel, forceProvider, systemPrompt, maxTokens, temperature, timeoutMs, trackUsage, start });
  }

  // ── Route by tier ──────────────────────────────────────────────────────────
  const attempts = buildAttemptChain(tier);

  for (const attempt of attempts) {
    try {
      const result = await runAttempt(attempt, prompt, systemPrompt, maxTokens, temperature, timeoutMs);
      if (result) {
        const latencyMs = Date.now() - start;
        const usage: UsageRecord = {
          model: attempt.model,
          provider: attempt.provider,
          promptTokens: result.usage?.promptTokens ?? 0,
          completionTokens: result.usage?.completionTokens ?? 0,
          totalTokens: (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0),
          estimatedCostUSD: estimateCost(attempt.model, result.usage?.promptTokens ?? 0, result.usage?.completionTokens ?? 0),
          latencyMs,
        };
        if (trackUsage) sessionUsageLog.push(usage);
        return { text: result.text, model: attempt.model, provider: attempt.provider, usage };
      }
    } catch {
      // continue to next attempt
    }
  }

  throw new Error(`[NEXUS] All providers failed for tier "${tier}"`);
}

// ── Extraction shortcut ────────────────────────────────────────────────────────

/**
 * Extract structured data from raw text using cheap models.
 * Returns parsed JSON or raw text if JSON parsing fails.
 */
export async function nexusExtract<T = Record<string, unknown>>(
  rawText: string,
  extractionPrompt: string,
  options: NexusGenerateOptions = {}
): Promise<T | string> {
  const systemPrompt = options.systemPrompt ||
    "You are a precise data extraction engine. Extract exactly the fields requested. Output valid JSON only. No markdown fences. No explanation. If a field is not found, use null.";

  const result = await nexusGenerate(
    `TEXT TO EXTRACT FROM:\n${rawText.slice(0, 8000)}\n\nEXTRACTION TASK:\n${extractionPrompt}`,
    { tier: "extraction", systemPrompt, maxTokens: 1500, temperature: 0, ...options }
  );

  const cleaned = result.text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return cleaned as unknown as T;
  }
}

/**
 * Synthesize a final intelligence report using frontier models.
 */
export async function nexusSynthesize(
  data: string,
  synthesisPrompt: string,
  options: NexusGenerateOptions = {}
): Promise<NexusGenerateResult> {
  return nexusGenerate(
    `DATA:\n${data}\n\nTASK:\n${synthesisPrompt}`,
    { tier: "synthesis", maxTokens: 4000, temperature: 0.2, ...options }
  );
}

/**
 * Real-time fast extraction using Groq (800 tok/s).
 */
export async function nexusRealtime(
  prompt: string,
  options: NexusGenerateOptions = {}
): Promise<NexusGenerateResult> {
  return nexusGenerate(prompt, { tier: "realtime", maxTokens: 1000, temperature: 0, ...options });
}

// ── Provider attempt chain builder ─────────────────────────────────────────────

interface Attempt {
  provider: "openrouter" | "groq" | "gemini" | "openai" | "anthropic" | "ollama";
  model: string;
}

function buildAttemptChain(tier: TaskTier): Attempt[] {
  const or = getOpenRouterClient();
  const groq = getGroqClient();
  const openai = getOpenAIClient();

  const hasOR = !!or;
  const hasGroq = !!groq;
  const hasOpenAI = !!openai;
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasAnthropic = !!(process.env.ANTHROPIC_API_KEY);

  switch (tier) {
    case "extraction":
      return [
        ...(hasOR    ? [{ provider: "openrouter" as const, model: "deepseek/deepseek-chat" }]       : []),
        ...(hasGroq   ? [{ provider: "groq" as const,       model: "llama-3.3-70b-versatile" }]     : []),
        ...(hasOR    ? [{ provider: "openrouter" as const, model: "qwen/qwen-2.5-72b-instruct" }]   : []),
        ...(hasGemini ? [{ provider: "gemini" as const,     model: "gemini-2.5-flash" }]            : []),
        ...(hasOpenAI ? [{ provider: "openai" as const,     model: "gpt-4o-mini" }]                 : []),
      ];

    case "arabic":
      return [
        // orpheus-arabic-saudi: Groq's dedicated Saudi Arabic model
        ...(hasGroq   ? [{ provider: "groq" as const,       model: "canopylabs/orpheus-arabic-saudi" }] : []),
        ...(hasOR    ? [{ provider: "openrouter" as const, model: "qwen/qwen-2.5-72b-instruct" }]   : []),
        ...(hasGemini ? [{ provider: "gemini" as const,     model: "gemini-2.5-flash" }]             : []),
        ...(hasOR    ? [{ provider: "openrouter" as const, model: "deepseek/deepseek-chat" }]        : []),
        ...(hasGroq   ? [{ provider: "groq" as const,       model: "llama-3.3-70b-versatile" }]     : []),
      ];

    case "realtime":
      return [
        ...(hasGroq   ? [{ provider: "groq" as const,       model: "llama-3.3-70b-versatile" }]     : []),
        ...(hasOR    ? [{ provider: "openrouter" as const, model: "deepseek/deepseek-chat" }]        : []),
        ...(hasGemini ? [{ provider: "gemini" as const,     model: "gemini-2.5-flash" }]             : []),
      ];

    case "bulk":
      return [
        { provider: "ollama" as const, model: process.env.OLLAMA_MODEL || "llama3.1" },
        ...(hasOR    ? [{ provider: "openrouter" as const, model: "deepseek/deepseek-chat-v3-5" }]   : []),
        ...(hasGroq   ? [{ provider: "groq" as const,       model: "llama-3.1-8b-instant" }]         : []),
      ];

    case "synthesis":
    default:
      return [
        ...(hasGemini    ? [{ provider: "gemini" as const,     model: "gemini-2.5-flash" }]           : []),
        ...(hasAnthropic ? [{ provider: "anthropic" as const,  model: "anthropic/claude-sonnet-4-5" }]: []),
        ...(hasOpenAI    ? [{ provider: "openai" as const,     model: "gpt-4o" }]                     : []),
        ...(hasOR        ? [{ provider: "openrouter" as const, model: "deepseek/deepseek-chat-v3-5" }]: []),
      ];
  }
}

// ── Attempt runners ────────────────────────────────────────────────────────────

interface AttemptResult {
  text: string;
  usage?: { promptTokens: number; completionTokens: number };
}

async function runAttempt(
  attempt: Attempt,
  prompt: string,
  systemPrompt: string | undefined,
  maxTokens: number,
  temperature: number,
  timeoutMs: number
): Promise<AttemptResult | null> {

  const withTimeout = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs))]);

  if (attempt.provider === "gemini") {
    const text = await withTimeout(
      generateWithGemini(prompt, systemPrompt, "gemini-2.5-flash") as Promise<string | null>
    );
    if (!text) return null;
    return { text };
  }

  if (attempt.provider === "ollama") {
    const client = getOllamaClient();
    if (!client) return null;
    try {
      const resp = await withTimeout(
        client.chat.completions.create({
          model: attempt.model,
          messages: [
            ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
            { role: "user" as const, content: prompt },
          ],
          max_tokens: maxTokens,
          temperature,
        })
      );
      const text = resp.choices[0]?.message?.content || "";
      if (!text) return null;
      return {
        text,
        usage: {
          promptTokens: resp.usage?.prompt_tokens ?? 0,
          completionTokens: resp.usage?.completion_tokens ?? 0,
        },
      };
    } catch { return null; }
  }

  // OpenRouter, Groq, OpenAI, Anthropic-via-OpenRouter all use OpenAI SDK format
  let client: OpenAI | null = null;
  if (attempt.provider === "openrouter" || attempt.provider === "anthropic") {
    client = getOpenRouterClient();
  } else if (attempt.provider === "groq") {
    client = getGroqClient();
  } else if (attempt.provider === "openai") {
    client = getOpenAIClient();
  }

  if (!client) return null;

  try {
    const resp = await withTimeout(
      client.chat.completions.create({
        model: attempt.model,
        messages: [
          ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
          { role: "user" as const, content: prompt },
        ],
        max_tokens: maxTokens,
        temperature,
      })
    );
    const text = resp.choices[0]?.message?.content || "";
    if (!text) return null;
    return {
      text,
      usage: {
        promptTokens: resp.usage?.prompt_tokens ?? 0,
        completionTokens: resp.usage?.completion_tokens ?? 0,
      },
    };
  } catch { return null; }
}

async function runForcedProvider(
  prompt: string,
  opts: {
    forceModel?: string;
    forceProvider?: string;
    systemPrompt?: string;
    maxTokens: number;
    temperature: number;
    timeoutMs: number;
    trackUsage: boolean;
    start: number;
  }
): Promise<NexusGenerateResult> {
  const { forceModel, forceProvider, systemPrompt, maxTokens, temperature, timeoutMs, trackUsage, start } = opts;

  const tier: TaskTier = "synthesis";
  const chain = buildAttemptChain(tier);
  const attempt = forceProvider
    ? chain.find(a => a.provider === forceProvider) || chain[0]
    : { provider: "openrouter" as const, model: forceModel! };

  if (forceModel) attempt.model = forceModel;

  const result = await runAttempt(attempt, prompt, systemPrompt, maxTokens, temperature, timeoutMs);
  if (!result) throw new Error(`[NEXUS] Forced provider ${forceProvider}/${forceModel} failed`);

  const latencyMs = Date.now() - start;
  const usage: UsageRecord = {
    model: attempt.model,
    provider: attempt.provider,
    promptTokens: result.usage?.promptTokens ?? 0,
    completionTokens: result.usage?.completionTokens ?? 0,
    totalTokens: (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0),
    estimatedCostUSD: estimateCost(attempt.model, result.usage?.promptTokens ?? 0, result.usage?.completionTokens ?? 0),
    latencyMs,
  };
  if (trackUsage) sessionUsageLog.push(usage);
  return { text: result.text, model: attempt.model, provider: attempt.provider, usage };
}

// ── Configuration status ───────────────────────────────────────────────────────

export interface NexusLLMStatus {
  openrouter: { configured: boolean; models: string[] };
  groq: { configured: boolean };
  gemini: { configured: boolean };
  anthropic: { configured: boolean };
  openai: { configured: boolean };
  ollama: { configured: boolean; baseUrl: string };
  activeProviders: string[];
}

export function getLLMStatus(): NexusLLMStatus {
  const hasOR = !!process.env.OPENROUTER_API_KEY;
  const hasGroq = !!process.env.GROQ_API_KEY;
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasAnthropic = !!(process.env.ANTHROPIC_API_KEY);
  const hasOpenAI = !!(process.env.OPENAI_API_KEY);
  const ollamaBase = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

  const active: string[] = [];
  if (hasOR) active.push("openrouter");
  if (hasGroq) active.push("groq");
  if (hasGemini) active.push("gemini");
  if (hasAnthropic) active.push("anthropic");
  if (hasOpenAI) active.push("openai");
  active.push("ollama");

  return {
    openrouter: {
      configured: hasOR,
      models: [
        "deepseek/deepseek-chat-v3-5",
        "meta-llama/llama-3.1-70b-instruct",
        "mistralai/mistral-large",
        "qwen/qwen-2.5-72b-instruct",
        "anthropic/claude-sonnet-4-5",
        "google/gemini-2.5-flash-preview",
      ],
    },
    groq: { configured: hasGroq },
    gemini: { configured: hasGemini },
    anthropic: { configured: hasAnthropic },
    openai: { configured: hasOpenAI },
    ollama: { configured: true, baseUrl: ollamaBase },
    activeProviders: active,
  };
}
