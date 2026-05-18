# Person Intel

**Executive dossiers.** Given a name (+ optional company/email), produces a profile covering work history, education, social profiles, seniority, estimated salary band, and LinkedIn URL.

## Source

`artifacts/api-server/src/routes/person-intel.ts`

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/person-intel/profile` | Generate a full dossier |
| POST | `/person-intel/quick` | Faster, lower-cost profile (no deep OSINT) |
| POST | `/person-intel/save` | Persist a profile |
| GET | `/person-intel/saved` | List saved profiles |
| DELETE | `/person-intel/saved/:id` | Remove |

## Storage

Shares the `prosengine_research` table with ProsEngine:

| Column | Notes |
|---|---|
| `company` | Target's current company |
| `title` | Their role |
| `report` | Full JSON dossier |
| `tags`, `notes` | – |
| `createdAt` | – |

## External APIs

| Service | Used for |
|---|---|
| Perplexity | Background research, citations |
| Scout | Social OSINT (LinkedIn, Twitter, etc.) |
| Apollo | Contact record + employment history |
| Internal `executives` table | If already known, pre-populates fields |

## Notes

- The `quick` endpoint skips Scout and Apollo — use it for top-of-funnel research where you only need rough seniority + a LinkedIn URL.
- Dossiers are not auto-refreshed; rerun `/profile` to update.
