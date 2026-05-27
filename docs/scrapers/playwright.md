# Playwright + Stealth (Layer 2)

## Role
Full JavaScript rendering with anti-fingerprint masking. The workhorse for any site that needs JS to populate content.

## File
`lib/stealth-browser.ts` (fingerprint masking + Claude-Vision CAPTCHA), `browser-helper.ts` (simple fetch), `orcengine/crawler.ts` (BFS).

## When it fires
L1 Cheerio returned too little (JS-rendered SPA) → escalate to L2.

## Env
`CHROMIUM_EXECUTABLE_PATH` (optional, for Nix/custom installs).

## Notes
Uses `puppeteer-extra-plugin-stealth` techniques (hides navigator.webdriver, spoofs plugins/canvas, TLS match). When this is still blocked → escalate to Camoufox (L3).
