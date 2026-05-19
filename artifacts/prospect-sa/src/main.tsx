import { createRoot } from "react-dom/client";
import { setAuthToken, getAuthToken } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// ── One-time theme migration ─────────────────────────────────────────────────
// Earlier deploys defaulted to "dark" and persisted that in localStorage. The
// Chameleon palette is designed for light by default; force-reset to light
// on first load after this migration so returning users see the new design.
// Marker bumps so the migration only runs once.
const THEME_MIGRATION_KEY = "prospectsa-theme-migrated";
const THEME_MIGRATION_VERSION = "chameleon-v1";
if (typeof window !== "undefined") {
  if (localStorage.getItem(THEME_MIGRATION_KEY) !== THEME_MIGRATION_VERSION) {
    localStorage.setItem("prospectsa-theme", "light");
    localStorage.setItem(THEME_MIGRATION_KEY, THEME_MIGRATION_VERSION);
  }
}

// ── Wire bearer token for the generated API client ────────────────────────────
// The backend requires it when API_TOKEN is set there; in local dev
// VITE_API_TOKEN is typically unset and the backend allows unauthenticated calls.
const token = import.meta.env.VITE_API_TOKEN as string | undefined;
if (token) setAuthToken(token);

// ── Global fetch interceptor ──────────────────────────────────────────────────
// The generated API client (customFetch) automatically attaches the Bearer token.
// However many pages use raw fetch() directly and bypass the token injection.
// This interceptor patches window.fetch so ALL /api/* calls get the token,
// regardless of whether they use the generated client or raw fetch.
const _nativeFetch = window.fetch.bind(window);
window.fetch = function patchedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const authToken = getAuthToken();
  if (!authToken) {
    // No token configured — pass through unchanged (dev mode or no API_TOKEN set)
    return _nativeFetch(input, init);
  }

  // Only inject on /api/* requests to our own backend
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : (input as Request).url;

  const isApiCall =
    url.startsWith("/api/") ||
    url.includes(window.location.origin + "/api/");

  if (!isApiCall) {
    // External call (Anthropic, Google, etc.) — do not inject our token
    return _nativeFetch(input, init);
  }

  // Check if Authorization header is already set (e.g. from customFetch)
  const existingHeaders = new Headers(init.headers || {});
  if (existingHeaders.has("authorization")) {
    return _nativeFetch(input, init);
  }

  // Inject Bearer token
  existingHeaders.set("authorization", `Bearer ${authToken}`);
  return _nativeFetch(input, { ...init, headers: existingHeaders });
};

createRoot(document.getElementById("root")!).render(<App />);
