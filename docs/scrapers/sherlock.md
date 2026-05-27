# Sherlock (planned — OSINT)

## Role
Username enumeration across 400+ social platforms. Given a name/handle, finds social profiles.

## When it fires
Person Intel + Relationship Agent 2 enrichment when standard sources return no socials.

## File
`lib/scrapers/sherlock-client.ts` — spawns the Sherlock Python CLI inside the Scout container; returns found profiles + confidence.

## Env
Inside Scout container; honour `proxy-pool` to avoid rate limits.

## Output
`{ username, sites: [{ name, url, status }] }` → feeds the credibility verdict layer as `secondary` sources.

## Notes
Read-only OSINT; respect platform ToS. Used for authorised enrichment only.
