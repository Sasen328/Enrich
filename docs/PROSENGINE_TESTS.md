# ProsEngine — End-to-End Test Commands

ProsEngine has four operator-facing features + an AI chat agent. This guide gives one curl per feature so you can verify each on a live deploy.

Replace `BASE` with your deploy URL:
- Local: `BASE=http://localhost:3000`
- Codespaces: `BASE=https://<codespace>-3000.app.github.dev`

If `API_TOKEN` is set on the backend, add `-H "Authorization: Bearer $API_TOKEN"` to every command.

---

## 1. Conversational chat (`POST /api/prosengine/chat`)

Drop a question / prompt; get a Claude-routed response with optional structured profile updates.

```bash
curl -s "$BASE/api/prosengine/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What are 3 things I should know before pitching SAP to a Saudi mid-market manufacturer?",
    "history": []
  }' | jq .
```

**Expected:** `{ "reply": "...", "profileUpdate": null | { ... } }`

## 1b. Streaming chat (`POST /api/prosengine/chat/stream`)

Same input shape, but the response is an SSE stream.

```bash
curl -N "$BASE/api/prosengine/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Give me a 2-sentence opener for the CEO of Aramco Trading.",
    "history": []
  }'
```

**Expected:** a stream of `data: {...}` lines ending in `event: done`.

---

## 2. URL analyze (`POST /api/prosengine/analyze-url`)

Drop a URL; get a quick classification + extracted fields.

```bash
curl -s "$BASE/api/prosengine/analyze-url" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://www.stc.com.sa" }' | jq .
```

**Expected:** `{ "ok": true, "kind": "company" | "person" | ..., "fields": { ... } }`

---

## 3. Deep research on URL (`POST /api/prosengine/research-url`)

Multi-source deep dive on a single URL — pulls in news, signals, GLEIF, OpenCorporates, Wikidata, etc., and returns a structured profile.

```bash
curl -s "$BASE/api/prosengine/research-url" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://www.aramco.com" }' | jq .
```

**Expected:** `{ "profile": { ... 30+ fields ... }, "url": "..." }`

⚠️ Slow — typically 30–60 seconds. Watch `docker compose logs -f app | grep prosengine` for progress.

---

## 4. Seed-from-input (`POST /api/prosengine/seed`)

Paste a free-form profile (or chat-extracted structured object) and have ProsEngine seed a row in the unified `companies` pool.

```bash
curl -s "$BASE/api/prosengine/seed" \
  -H "Content-Type: application/json" \
  -d '{
    "profile": {
      "companyName": "Bondh E-Bee",
      "companyNameAr": "بند إي بي",
      "domain": "bondhebee.com",
      "industry": "Mobility / EV",
      "city": "Riyadh"
    }
  }' | jq .
```

**Expected:** `{ "ok": true, "companyId": <n>, "seeded": "companies" }`

## 4b. Seed-from-URL (`POST /api/prosengine/seed-from-url`)

Hybrid: research + seed in one shot.

```bash
curl -s "$BASE/api/prosengine/seed-from-url" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://www.stc.com.sa" }' | jq .
```

**Expected:** `{ "ok": true, "companyId": <n>, "profile": { ... } }`

---

## 5. Export PPT (`POST /api/prosengine/export-ppt`)

Generate a polished PowerPoint deck for a specific company profile.

```bash
curl -s "$BASE/api/prosengine/export-ppt" \
  -H "Content-Type: application/json" \
  -d '{
    "companyId": 1,
    "tone": "investor"
  }' --output deck.pptx
```

**Expected:** a downloadable `deck.pptx` (~30–80 KB) you can open in PowerPoint / Keynote / LibreOffice.

If `companyId` isn't known, replace with a full inline profile via the `profile` field.

---

## Verifying all 4 in one go

The fastest sanity pass:

```bash
# 1. Chat
curl -s "$BASE/api/prosengine/chat" -H "Content-Type: application/json" \
  -d '{"message":"ping","history":[]}' | jq '.reply | length'   # → expect >0

# 2. Analyze URL
curl -s "$BASE/api/prosengine/analyze-url" -H "Content-Type: application/json" \
  -d '{"url":"https://www.example.com"}' | jq '.ok'             # → expect true

# 3. Research URL (slow — 30–60s)
time curl -s "$BASE/api/prosengine/research-url" -H "Content-Type: application/json" \
  -d '{"url":"https://www.example.com"}' | jq '.profile | keys | length'  # → expect 20+

# 4. Seed
curl -s "$BASE/api/prosengine/seed" -H "Content-Type: application/json" \
  -d '{"profile":{"companyName":"Test Co","domain":"test.example.com"}}' | jq '.ok'   # → expect true
```

If any returns `null`, `false`, or HTTP error → grab the log lines:

```bash
docker compose logs --tail 100 app | grep -i prosengine
```

…and paste them back.
