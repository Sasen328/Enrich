# Camoufox (planned — Layer 3)

## Role
Engine-level anti-detection. Sandboxes Playwright internals so JS inspection can't see automation; C++ human-mouse algorithms. Sits between Playwright-stealth (L2) and BeautifulSoup (L5).

## When it fires
L2 Playwright-stealth got blocked (Cloudflare/DataDome challenge, empty body, bot-wall) → escalate to Camoufox.

## File
`lib/scrapers/camoufox-runner.ts` wrapping the Camoufox binary; same interface as stealth-browser.

## Env
`CAMOUFOX_PATH` (binary), inherits `proxy-pool` config.

## Notes
Under active maintenance as of 2026 — pin a known-good release. Heavier than L2; only for protected targets (LinkedIn, AngelList, Crunchbase-gated).
