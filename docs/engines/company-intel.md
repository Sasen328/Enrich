# Company Intel

**Deep company profiles.** Given a name or URL, produces a ~50-field structured report covering founding, ownership, executives, market position, news, financials, and Saudi-government registrations.

## Source

`artifacts/api-server/src/routes/company-intel.ts`

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/company-intel/profile` | Generate a fresh profile (LLM call, may take ~30–60s) |
| POST | `/company-intel/save` | Persist a generated profile |
| GET | `/company-intel/saved` | List saved profiles |
| DELETE | `/company-intel/saved/:id` | Remove |
| POST | `/company-intel/web-seed` | Seed the unified pool from a single profile run |

## Storage

`company_intel_research`:

| Column | Notes |
|---|---|
| `website` | Lookup key |
| `city` | Filterable |
| `report` | Full JSON profile (~50 fields) |
| `tags` | User tags |
| `notes` | Free-form notes |
| `createdAt` | – |

## External APIs

| Service | Used for |
|---|---|
| Perplexity | Open-web research, news, citations |
| Scout | Site scraping for primary-source data |
| Internal `companies` table | If the company exists, fields are merged before LLM call |
| Saudi gov sources | CR registry lookups via Masaar/Masar |

## Tips

- `web-seed` is the fastest way to onboard a known target — it generates the profile, merges into `companies`, and triggers Signals for follow-up monitoring.
- The report schema is intentionally loose JSON to allow new fields without migration. Frontends should read defensively.
