# Scout Microservice

## Role
Remote Python service (`SCOUT_URL`, default `http://localhost:8099`) hosting BeautifulSoup, requests, OSINT signals, sanctions screening, and (planned) ScrapeGraphAI/Sherlock/TheHarvester. Keeps Python-only tools off the Node process.

## File
`lib/scout-client.ts` — typed HTTP boundary.

## Endpoints used
site-intel, osint/harvest, signals (news/sanctions/contracts), individual profiles, regulatory.

## Env
`SCOUT_URL` (required for Masaar Agent 1/2, Signals, Relationship Agent 2).

## Notes
The natural home for new Python OSINT tools — add them here behind clean HTTP endpoints rather than spawning from Node.
