# Crawl4AI

## Role
Page → LLM-ready markdown. Handles JS render (via Playwright), pagination, BM25 relevance filtering, schema generation from NL instructions, email/phone extraction.

## File
`crawl4ai-engine.ts`.

## When it fires
Website Intel + Data Seeder when we want clean markdown for downstream LLM extraction rather than raw HTML.

## Notes
Outputs markdown specifically shaped for RAG / LLM ingestion. Pairs with ScrapeGraphAI (L4) for schema extraction.
