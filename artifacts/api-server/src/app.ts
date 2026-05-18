import express, { type Express } from "express";
import cors from "cors";
import path from "path";
import router from "./routes";
import { registerOrcEngineRoutes } from "./orcengine/routes.js";
import { registerProspectingRoutes } from "./prospecting/routes.js";
import masarDatabaseRouter from "./routes/masar-database.js";
import { authRequired } from "./lib/middleware/auth.js";
import { env } from "./lib/config/env.js";

// __dirname is injected by esbuild for CJS bundles — no import.meta needed

// Resolve the built frontend directory.
// In the monorepo, artifacts/prospect-sa/dist/public is two levels up from
// artifacts/api-server/dist/ (where this compiled file lives).
// In dev (tsx): __dirname = artifacts/api-server/src/
// In prod (esbuild CJS): __dirname = artifacts/api-server/dist/
// Both cases: resolve to artifacts/prospect-sa/dist/public
const FRONTEND_DIST = path.resolve(
  __dirname,       // api-server/src OR api-server/dist
  "..",            // api-server/
  "..",            // artifacts/
  "prospect-sa",
  "dist",
  "public"
);

const app: Express = express();

// ── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = env.FRONTEND_ORIGIN
  ? env.FRONTEND_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
  : null;

if (!allowedOrigins) {
  console.warn(
    "[cors] FRONTEND_ORIGIN is not set — allowing all origins. " +
    "Set FRONTEND_ORIGIN to your frontend URL before deploying.",
  );
}

app.use(
  cors(
    allowedOrigins
      ? {
          origin: (origin, cb) => {
            if (!origin) return cb(null, true);
            if (allowedOrigins.includes(origin)) return cb(null, true);
            cb(new Error(`Origin ${origin} not allowed`));
          },
          credentials: true,
        }
      : { origin: true },
  ),
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// ── Static frontend ─────────────────────────────────────────────────────────
// Serve built Vite output BEFORE auth so the HTML/JS/CSS are always reachable.
// Only /api/* routes require auth.
app.use(express.static(FRONTEND_DIST, { index: false }));

// ── Auth (API routes only) ───────────────────────────────────────────────────
app.use("/api", authRequired);

// ── API Routers ──────────────────────────────────────────────────────────────
app.use("/api", router);
app.use("/api", masarDatabaseRouter);
registerOrcEngineRoutes(app);
registerProspectingRoutes(app);

// ── SPA catch-all ────────────────────────────────────────────────────────────
// Any non-/api request that wasn't matched by static files falls back to
// index.html so React Router / Wouter handles client-side navigation.
app.get(/^(?!\/api).*$/, (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, "index.html"));
});

export default app;
