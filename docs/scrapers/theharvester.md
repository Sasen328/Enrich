# TheHarvester (planned — OSINT)

## Role
Email + subdomain discovery from search engines, PGP servers, certificate transparency, SHODAN.

## When it fires
Company/Person Intel enrichment when email pattern unknown; Lead Factory Agent 3 deep enrichment fallback.

## File
`lib/scrapers/theharvester-client.ts` — spawns TheHarvester CLI in the Scout container.

## Output
`{ domain, emails: [], hosts: [], subdomains: [] }` → emails validated by `lead-validator.ts` (DNS/MX) before use; tagged `inferred` in the verdict layer until verified.

## Env
Inside Scout container; some modules want their own API keys (optional).

## Notes
Pair with `lib/lead-validator.ts` so harvested emails are MX-checked before they count as a contact.
