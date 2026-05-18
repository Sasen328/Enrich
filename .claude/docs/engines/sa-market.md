# SA Market

**Saudi listed-company intelligence.** Aggregates Tadawul + Saudi open data: shareholders, board members, sectors, and ownership networks for the ~726 companies listed on the main and Nomu markets.

## Source

`artifacts/api-server/src/routes/sa-market.ts`

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/sa-market/shareholders` | Listed-company shareholders (filter by sector / city / nationality) |
| GET | `/sa-market/executives` | Board + management (filter by sector / company) |
| GET | `/sa-market/profile/:name` | Aggregated profile for one listed company |
| POST | `/sa-market/profile/generate` | Generate an AI-written profile from the raw rows |
| GET | `/sa-market/sectors` | Distinct sector list |
| GET | `/sa-market/stats` | Counts by sector / region |
| GET | `/sa-market/search` | Free-text search |
| GET | `/sa-market/export` | CSV / XLSX export |
| GET | `/sa-market/shareholder/:nationalId` | Reverse lookup — every company a person holds shares in |
| GET | `/sa-market/network/:name` | Shareholder network graph |
| POST | `/sa-market/refresh` | Re-pull from Wikidata + CMA |

## Storage

| Table | Columns |
|---|---|
| `sa_market_shareholders` | `sector, city, companyName, shareholderName, shareholderNameAr, nationalId, ownershipPct, nationality` |
| `sa_market_executives` | `sector, companyName, name, nameAr, position, nationalId` |

## Sources

| Source | Records |
|---|---|
| Wikidata SPARQL | ~726 Saudi listed companies |
| Saudi Open Data (CKAN) | Government-published shareholder + board datasets |
| CMA disclosures | Regulatory filings |

## Notes

- The `nationalId` field is the join key for reverse lookups — a single individual sitting on multiple boards is detectable.
- Network graphs are computed at read time (no precomputed graph table), so `/network/:name` can be slow for hub-like shareholders.
- `refresh` is rate-limited — Wikidata SPARQL endpoints throttle aggressive callers.
