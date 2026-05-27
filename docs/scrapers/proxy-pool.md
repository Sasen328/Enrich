# Proxy Pool (planned)

## Role
Residential/ISP proxy rotation so harvesting never gets IP-blocked. Per-request rotation for aggressive scraping; sticky sessions (10-30 min) for account-based targets.

## File
`lib/proxy-pool.ts` — returns a proxy URL per request or per session; health-checks and evicts dead proxies.

## Env (any provider)
- `WEBSHARE_PROXY_LIST` (free tier, testing)
- `IPROYAL_USER` / `IPROYAL_PASS` / `IPROYAL_ENDPOINT`
- `LUNAPROXY_*`, `SIMPLYNODE_*`
- Master toggle `NEXUS_PROXY_ENABLED` (default off)

## Strategy
- per-request rotation → aggressive list-scraping
- sticky session → logged-in / cookie-profile targets
- ISP-level → long-running stable identity

## Notes
Off by default. When enabled, L2-L4 browser layers route through it. Pairs with Camoufox for the "pass any website" path.
