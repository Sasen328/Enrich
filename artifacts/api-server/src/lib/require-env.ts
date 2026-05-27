// §12 — Deploy hardening helpers.
//
// Replaces the dangerous `process.env.X || "dummy"` pattern (which makes SDKs
// throw confusing 401s) with explicit, actionable behaviour.

export class MissingEnvError extends Error {
  status = 503;
  envVar: string;
  constructor(envVar: string, feature: string) {
    super(`Feature "${feature}" needs the ${envVar} environment variable. Set it and restart.`);
    this.envVar = envVar;
    this.name = "MissingEnvError";
  }
}

/** Throw a 503-mapped error if the env var is missing. Use at the top of a
 *  route handler that genuinely cannot run without it. */
export function requireEnv(name: string, feature: string): string {
  const v = process.env[name];
  if (!v || v === "dummy") throw new MissingEnvError(name, feature);
  return v;
}

/** Non-throwing check for graceful degradation paths. */
export function hasEnv(name: string): boolean {
  const v = process.env[name];
  return !!v && v !== "dummy";
}

/**
 * Express error mapper — call once in app.ts after routes:
 *   app.use(envErrorHandler)
 * Turns MissingEnvError into a clean 503 JSON body instead of a 500.
 */
export function envErrorHandler(err: unknown, _req: unknown, res: any, next: (e?: unknown) => void): void {
  if (err instanceof MissingEnvError) {
    res.status(503).json({ error: "feature_unavailable", envVar: err.envVar, message: err.message });
    return;
  }
  next(err);
}

/**
 * Production startup guard — call in app bootstrap. Refuses to boot in
 * production with auth/CORS wide open.
 */
export function assertProductionSafety(): void {
  if (process.env.NODE_ENV !== "production") return;
  const problems: string[] = [];
  if (!hasEnv("API_TOKEN")) problems.push("API_TOKEN is unset — auth would accept every request");
  if (!hasEnv("FRONTEND_ORIGIN")) problems.push("FRONTEND_ORIGIN is unset — CORS would allow every origin");
  if (problems.length) {
    console.error("[startup] REFUSING TO BOOT in production:\n  - " + problems.join("\n  - "));
    console.error("[startup] Set these env vars, or run with NODE_ENV != production for local dev.");
    process.exit(1);
  }
}
