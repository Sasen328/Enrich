import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";
import { registerOrcEngineRoutes } from "./orcengine/routes.js";
import { registerProspectingRoutes } from "./prospecting/routes.js";
import masarDatabaseRouter from "./routes/masar-database.js";
import { authRequired } from "./lib/middleware/auth.js";
import { env } from "./lib/config/env.js";

const app: Express = express();

// ── CORS ────────────────────────────────────────────────────────────────────
// FRONTEND_ORIGIN supports a single origin or a comma-separated list. If unset,
// fall back to permissive "*" with a startup warning — dev convenience only.
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
            // Non-browser callers (curl, server-side) don't send Origin — allow.
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

// ── Auth ────────────────────────────────────────────────────────────────────
// Mounted before any router. Exempts /api/healthz and /api/readyz internally.
app.use(authRequired);

// ── Routers ─────────────────────────────────────────────────────────────────
app.use("/api", router);
app.use("/api", masarDatabaseRouter);
registerOrcEngineRoutes(app);
registerProspectingRoutes(app);

export default app;
