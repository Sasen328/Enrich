/**
 * NEXUS — CAPTCHA Solving Adapter
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Escalating CAPTCHA resolution pipeline:
 *
 *   Stage 1 │ NopeCHA          Free tier (100 solves/day). AI-powered. No humans.
 *           │                 Best for development and low-volume prototyping.
 *
 *   Stage 2 │ AZcaptcha        $24.90/month UNLIMITED. reCAPTCHA v2/v3, hCaptcha,
 *           │                 image, text, funcaptcha. Best for production volume.
 *
 *   Stage 3 │ CapMonster Cloud $0.60/1K solves. AI-only. < 1 second per solve.
 *           │                 Best for speed-critical jobs.
 *
 *   Stage 4 │ DeathByCaptcha   $2.89/1K. Only charges correct solves. Human fallback
 *           │                 for edge cases AI cannot handle.
 *
 * Supported CAPTCHA types:
 *   recaptcha-v2   — Standard image challenge
 *   recaptcha-v3   — Invisible score-based
 *   hcaptcha       — hCaptcha challenge
 *   image          — Simple image text CAPTCHA
 *   text           — Plain text CAPTCHA
 *   turnstile      — Cloudflare Turnstile
 *
 * Environment variables:
 *   NOPECHA_API_KEY           — NopeCHA API key (free tier: 100/day)
 *   AZCAPTCHA_API_KEY         — AZcaptcha API key ($24.90/mo unlimited)
 *   CAPMONSTER_API_KEY        — CapMonster Cloud API key ($0.60/1K)
 *   DEATHBYCAPTCHA_USER       — DeathByCaptcha username
 *   DEATHBYCAPTCHA_PASS       — DeathByCaptcha password
 *   NEXUS_CAPTCHA_ENABLED     — set "false" to disable CAPTCHA solving
 */

export type CaptchaType =
  | "recaptcha-v2"
  | "recaptcha-v3"
  | "hcaptcha"
  | "image"
  | "text"
  | "turnstile";

export type CaptchaProvider = "nopecha" | "azcaptcha" | "capmonster" | "deathbycaptcha";

export interface CaptchaTaskOptions {
  type: CaptchaType;
  /** Page URL where the CAPTCHA appears */
  pageUrl: string;
  /** Site key (for reCAPTCHA, hCaptcha, Turnstile) */
  siteKey?: string;
  /** Base64 image data (for image/text CAPTCHAs) */
  imageBase64?: string;
  /** reCAPTCHA v3 action name */
  action?: string;
  /** Score threshold for reCAPTCHA v3 (default: 0.7) */
  minScore?: number;
  /** Timeout in ms (default: 120000) */
  timeoutMs?: number;
}

export interface CaptchaSolveResult {
  token: string;
  provider: CaptchaProvider;
  latencyMs: number;
  confidence?: number;
}

// ── Provider: NopeCHA ──────────────────────────────────────────────────────────

async function solveWithNopecha(task: CaptchaTaskOptions): Promise<CaptchaSolveResult | null> {
  const key = process.env.NOPECHA_API_KEY;
  if (!key) return null;

  const start = Date.now();

  // Map our type to NopeCHA type
  const typeMap: Record<CaptchaType, string> = {
    "recaptcha-v2": "recaptcha",
    "recaptcha-v3": "recaptcha",
    "hcaptcha": "hcaptcha",
    "image": "image",
    "text": "text",
    "turnstile": "turnstile",
  };

  const body: Record<string, unknown> = {
    key,
    type: typeMap[task.type],
    url: task.pageUrl,
  };

  if (task.siteKey) body.sitekey = task.siteKey;
  if (task.imageBase64) body.image_data = task.imageBase64;
  if (task.action) body.action = task.action;

  try {
    const resp = await fetch("https://nopecha.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(task.timeoutMs || 120000),
    });

    if (!resp.ok) return null;
    const data = await resp.json() as { status: number; data?: string; error?: string };
    if (data.status !== 1 || !data.data) return null;

    return { token: data.data, provider: "nopecha", latencyMs: Date.now() - start };
  } catch { return null; }
}

// ── Provider: AZcaptcha ────────────────────────────────────────────────────────

async function solveWithAzcaptcha(task: CaptchaTaskOptions): Promise<CaptchaSolveResult | null> {
  const key = process.env.AZCAPTCHA_API_KEY;
  if (!key) return null;

  const start = Date.now();
  const timeoutMs = task.timeoutMs || 120000;

  const typeMap: Record<CaptchaType, string> = {
    "recaptcha-v2": "RecaptchaV2TaskProxyless",
    "recaptcha-v3": "RecaptchaV3TaskProxyless",
    "hcaptcha": "HCaptchaTaskProxyless",
    "image": "ImageToTextTask",
    "text": "ImageToTextTask",
    "turnstile": "TurnstileTaskProxyless",
  };

  const taskPayload: Record<string, unknown> = {
    type: typeMap[task.type],
  };

  if (task.siteKey) taskPayload.websiteKey = task.siteKey;
  if (task.pageUrl) taskPayload.websiteURL = task.pageUrl;
  if (task.imageBase64) taskPayload.body = task.imageBase64;
  if (task.action) taskPayload.pageAction = task.action;
  if (task.minScore) taskPayload.minScore = task.minScore;

  try {
    // Step 1: Create task
    const createResp = await fetch("https://azcaptcha.com/createTask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: key, task: taskPayload }),
      signal: AbortSignal.timeout(15000),
    });
    if (!createResp.ok) return null;

    const createData = await createResp.json() as { errorId: number; taskId?: number };
    if (createData.errorId !== 0 || !createData.taskId) return null;

    const taskId = createData.taskId;
    const deadline = Date.now() + timeoutMs;

    // Step 2: Poll for result
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 5000));

      const resultResp = await fetch("https://azcaptcha.com/getTaskResult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: key, taskId }),
        signal: AbortSignal.timeout(10000),
      });
      if (!resultResp.ok) continue;

      const resultData = await resultResp.json() as {
        errorId: number;
        status: string;
        solution?: { gRecaptchaResponse?: string; token?: string; text?: string };
      };

      if (resultData.errorId !== 0) return null;
      if (resultData.status !== "ready") continue;

      const token =
        resultData.solution?.gRecaptchaResponse ||
        resultData.solution?.token ||
        resultData.solution?.text;

      if (!token) return null;
      return { token, provider: "azcaptcha", latencyMs: Date.now() - start };
    }
    return null;
  } catch { return null; }
}

// ── Provider: CapMonster ───────────────────────────────────────────────────────

async function solveWithCapmonster(task: CaptchaTaskOptions): Promise<CaptchaSolveResult | null> {
  const key = process.env.CAPMONSTER_API_KEY;
  if (!key) return null;

  const start = Date.now();
  const timeoutMs = task.timeoutMs || 120000;

  const typeMap: Record<CaptchaType, string> = {
    "recaptcha-v2": "RecaptchaV2TaskProxyless",
    "recaptcha-v3": "RecaptchaV3TaskProxyless",
    "hcaptcha": "HCaptchaTaskProxyless",
    "image": "ImageToTextTask",
    "text": "ImageToTextTask",
    "turnstile": "TurnstileTaskProxyless",
  };

  const taskPayload: Record<string, unknown> = { type: typeMap[task.type] };
  if (task.siteKey) taskPayload.websiteKey = task.siteKey;
  if (task.pageUrl) taskPayload.websiteURL = task.pageUrl;
  if (task.imageBase64) taskPayload.body = task.imageBase64;

  try {
    const createResp = await fetch("https://api.capmonster.cloud/createTask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: key, task: taskPayload }),
      signal: AbortSignal.timeout(15000),
    });
    if (!createResp.ok) return null;

    const createData = await createResp.json() as { errorId: number; taskId?: number };
    if (createData.errorId !== 0 || !createData.taskId) return null;

    const taskId = createData.taskId;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 3000));

      const resultResp = await fetch("https://api.capmonster.cloud/getTaskResult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: key, taskId }),
        signal: AbortSignal.timeout(10000),
      });
      if (!resultResp.ok) continue;

      const resultData = await resultResp.json() as {
        errorId: number;
        status: string;
        solution?: { gRecaptchaResponse?: string; token?: string; text?: string };
      };

      if (resultData.errorId !== 0) return null;
      if (resultData.status !== "ready") continue;

      const token =
        resultData.solution?.gRecaptchaResponse ||
        resultData.solution?.token ||
        resultData.solution?.text;

      if (!token) return null;
      return { token, provider: "capmonster", latencyMs: Date.now() - start };
    }
    return null;
  } catch { return null; }
}

// ── Provider: DeathByCaptcha ───────────────────────────────────────────────────

async function solveWithDeathByCaptcha(task: CaptchaTaskOptions): Promise<CaptchaSolveResult | null> {
  const user = process.env.DEATHBYCAPTCHA_USER;
  const pass = process.env.DEATHBYCAPTCHA_PASS;
  if (!user || !pass) return null;

  const start = Date.now();
  const credentials = Buffer.from(`${user}:${pass}`).toString("base64");
  const timeoutMs = task.timeoutMs || 120000;

  try {
    const formData = new FormData();
    formData.append("authtoken", credentials);

    if (task.type === "recaptcha-v2" || task.type === "recaptcha-v3" || task.type === "turnstile") {
      formData.append("type", "4");
      formData.append("googlekey", task.siteKey || "");
      formData.append("pageurl", task.pageUrl);
    } else if (task.imageBase64) {
      formData.append("base64_image", task.imageBase64);
    }

    const createResp = await fetch("https://api.dbcapi.me/api/captcha", {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(15000),
    });

    if (!createResp.ok) return null;
    const createData = await createResp.json() as { captcha?: number; text?: string; is_correct?: number };
    if (!createData.captcha) return null;

    const captchaId = createData.captcha;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 5000));

      const pollResp = await fetch(
        `https://api.dbcapi.me/api/captcha/${captchaId}?authtoken=${credentials}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!pollResp.ok) continue;

      const pollData = await pollResp.json() as { text?: string; is_correct?: number };
      if (!pollData.text) continue;

      return { token: pollData.text, provider: "deathbycaptcha", latencyMs: Date.now() - start };
    }
    return null;
  } catch { return null; }
}

// ── Main solver: escalating chain ──────────────────────────────────────────────

/**
 * Solve a CAPTCHA using the escalating provider chain.
 * Returns the solved token or throws if all providers fail.
 */
export async function solveCaptcha(task: CaptchaTaskOptions): Promise<CaptchaSolveResult> {
  if (process.env.NEXUS_CAPTCHA_ENABLED === "false") {
    throw new Error("[NEXUS Captcha] CAPTCHA solving is disabled");
  }

  const providers: Array<(t: CaptchaTaskOptions) => Promise<CaptchaSolveResult | null>> = [
    solveWithNopecha,
    solveWithAzcaptcha,
    solveWithCapmonster,
    solveWithDeathByCaptcha,
  ];

  for (const solver of providers) {
    try {
      const result = await solver(task);
      if (result) return result;
    } catch { /* continue */ }
  }

  throw new Error(`[NEXUS Captcha] All providers failed for type "${task.type}" on ${task.pageUrl}`);
}

/**
 * Check if any CAPTCHA provider is configured.
 */
export function isCaptchaAvailable(): boolean {
  return !!(
    process.env.NOPECHA_API_KEY ||
    process.env.AZCAPTCHA_API_KEY ||
    process.env.CAPMONSTER_API_KEY ||
    (process.env.DEATHBYCAPTCHA_USER && process.env.DEATHBYCAPTCHA_PASS)
  );
}

export interface CaptchaStatus {
  enabled: boolean;
  providers: {
    nopecha: boolean;
    azcaptcha: boolean;
    capmonster: boolean;
    deathbycaptcha: boolean;
  };
  activeProviders: string[];
}

export function getCaptchaStatus(): CaptchaStatus {
  const enabled = process.env.NEXUS_CAPTCHA_ENABLED !== "false";
  const nopecha = !!process.env.NOPECHA_API_KEY;
  const azcaptcha = !!process.env.AZCAPTCHA_API_KEY;
  const capmonster = !!process.env.CAPMONSTER_API_KEY;
  const dbc = !!(process.env.DEATHBYCAPTCHA_USER && process.env.DEATHBYCAPTCHA_PASS);

  const active: string[] = [];
  if (nopecha) active.push("nopecha");
  if (azcaptcha) active.push("azcaptcha");
  if (capmonster) active.push("capmonster");
  if (dbc) active.push("deathbycaptcha");

  return {
    enabled,
    providers: { nopecha, azcaptcha, capmonster, deathbycaptcha: dbc },
    activeProviders: active,
  };
}
