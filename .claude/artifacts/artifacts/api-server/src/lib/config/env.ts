/**
 * Centralized environment configuration.
 *
 * Single source of truth for every env var the API server reads. Every other
 * module should import from here instead of touching `process.env` directly.
 *
 * Required vars fail loudly at boot. Optional vars are typed and fall back to
 * sensible defaults (or `undefined` when there is no safe default).
 *
 * AI provider keys follow a fallback chain:
 *   - Direct key (e.g. OPENAI_API_KEY) is preferred — works in dev and prod.
 *   - AI_INTEGRATIONS_* key is the Replit AI Integrations proxy, dev-only.
 */
import { z } from "zod";

const optional = z.string().min(1).optional();
const requiredString = z.string().min(1);

const RawEnv = z.object({
  // ── Runtime ──────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive(),
  BASE_PATH: optional,
  REPL_ID: optional,

  // ── Security ─────────────────────────────────────────────────────────────
  /** Bearer token required on every API call. If unset, auth is disabled (dev only). */
  API_TOKEN: optional,
  /** Comma-separated allowed origins for CORS. If unset, dev fallback ("*") is used. */
  FRONTEND_ORIGIN: optional,
  /** Grace period for in-flight requests during shutdown (ms). */
  SHUTDOWN_GRACE_MS: z.coerce.number().int().positive().default(15000),

  // ── Database ─────────────────────────────────────────────────────────────
  DATABASE_URL: requiredString,

  // ── OpenAI ───────────────────────────────────────────────────────────────
  OPENAI_API_KEY: optional,
  AI_INTEGRATIONS_OPENAI_API_KEY: optional,
  AI_INTEGRATIONS_OPENAI_BASE_URL: optional,

  // ── Anthropic ────────────────────────────────────────────────────────────
  ANTHROPIC_API_KEY: optional,
  AI_INTEGRATIONS_ANTHROPIC_API_KEY: optional,
  AI_INTEGRATIONS_ANTHROPIC_BASE_URL: optional,

  // ── Other LLM providers (Nexus waterfall) ────────────────────────────────
  GEMINI_API_KEY: optional,
  GROQ_API_KEY: optional,
  OPENROUTER_API_KEY: optional,
  HUGGING_FACE_API_KEY: optional,
  PERPLEXITY_API_KEY: optional,
  DISABLE_PERPLEXITY: optional,
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_MODEL: optional,

  // ── Contact-data APIs ────────────────────────────────────────────────────
  APOLLO_API_KEY: optional,
  APOLLO_CLIENT_SECRET: optional,
  APOLLO_ACCESS_TOKEN: optional,
  HUNTER_API_KEY: optional,
  EXPLORIUM_API_KEY: optional,
  WAPPALYZER_API_KEY: optional,

  // ── Scraping ─────────────────────────────────────────────────────────────
  SCOUT_URL: z.string().url().default("http://localhost:8099"),
  APIFY_API_KEY: optional,
  CHROMIUM_EXECUTABLE_PATH: optional,

  // ── Proxies ──────────────────────────────────────────────────────────────
  IPROYAL_USER: optional,
  IPROYAL_PASS: optional,
  IPROYAL_ENDPOINT: optional,
  LUNAPROXY_USER: optional,
  LUNAPROXY_PASS: optional,
  LUNAPROXY_ENDPOINT: optional,
  SIMPLYNODE_USER: optional,
  SIMPLYNODE_PASS: optional,
  SIMPLYNODE_ENDPOINT: optional,
  WEBSHARE_PROXY_LIST: optional,
  NEXUS_PROXY_ENABLED: optional,

  // ── Captcha ──────────────────────────────────────────────────────────────
  CAPMONSTER_API_KEY: optional,
  AZCAPTCHA_API_KEY: optional,
  DEATHBYCAPTCHA_USER: optional,
  DEATHBYCAPTCHA_PASS: optional,
  NOPECHA_API_KEY: optional,
  NEXUS_CAPTCHA_ENABLED: optional,

  // ── Activepieces ─────────────────────────────────────────────────────────
  ACTIVEPIECES_URL: optional,
  ACTIVEPIECES_API_KEY: optional,
  ACTIVEPIECES_FLOW_BUILDER: optional,
  ACTIVEPIECES_FLOW_LEAD_FACTORY: optional,
  ACTIVEPIECES_FLOW_MASAAR: optional,
  ACTIVEPIECES_FLOW_PROSPENGINE: optional,
  ACTIVEPIECES_FLOW_SIGNAL_PUSH: optional,
});

const parsed = RawEnv.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Invalid environment configuration:\n${issues}\n\n` +
      `See docs/ENV.md for required and optional variables.`,
  );
}

const raw = parsed.data;

/**
 * Resolved, typed env config. Import this object instead of touching
 * `process.env` directly.
 */
export const env = {
  ...raw,

  // ── Derived / resolved values ────────────────────────────────────────────

  /** Resolved OpenAI API key (direct > Replit proxy). */
  openaiKey: raw.OPENAI_API_KEY ?? raw.AI_INTEGRATIONS_OPENAI_API_KEY,

  /** Resolved Anthropic API key (direct > Replit proxy). */
  anthropicKey: raw.ANTHROPIC_API_KEY ?? raw.AI_INTEGRATIONS_ANTHROPIC_API_KEY,

  /** Whether Perplexity is reachable. */
  perplexityEnabled:
    !!raw.PERPLEXITY_API_KEY && raw.DISABLE_PERPLEXITY !== "true",

  /** Whether the Nexus proxy mesh is enabled. */
  proxyEnabled: raw.NEXUS_PROXY_ENABLED === "true",

  /** Whether at least one captcha solver is wired. */
  captchaAvailable:
    raw.NEXUS_CAPTCHA_ENABLED !== "false" &&
    !!(
      raw.CAPMONSTER_API_KEY ||
      raw.AZCAPTCHA_API_KEY ||
      raw.NOPECHA_API_KEY ||
      (raw.DEATHBYCAPTCHA_USER && raw.DEATHBYCAPTCHA_PASS)
    ),

  /** Whether running on Replit. */
  onReplit: !!raw.REPL_ID,

  /** Whether running in production. */
  isProduction: raw.NODE_ENV === "production",
} as const;

export type Env = typeof env;

/**
 * Assert that a required-for-feature key is present. Use at the top of an
 * engine to fail loudly when the operator forgot to wire a key.
 */
export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(
      `Missing required environment variable: ${String(key)}. See docs/ENV.md.`,
    );
  }
  return value as NonNullable<Env[K]>;
}
