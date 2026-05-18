"""
Government Contracts Monitor
Fetches Saudi government contract awards and tenders from free sources:
  - Etimad (Saudi government procurement portal) — via Google News search
  - Saudi Gazette tenders RSS
  - Google News for contract/project awards
"""

import asyncio
import re
from typing import Optional
from urllib.parse import quote_plus

import httpx
import feedparser

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; ProspectSA-Scout/1.0)"}

SAR_RE = re.compile(r"(?:SAR|ر\.س|ريال)\s*[\d,\.]+(?:\s*(?:million|billion|مليون|مليار))?", re.IGNORECASE)
CONTRACT_KEYWORDS = [
    "contract", "award", "tender", "project", "procurement",
    "عقد", "مشروع", "مناقصة", "ترسية", "مشتريات"
]


def _extract_contract_value(text: str) -> Optional[str]:
    m = SAR_RE.search(text)
    return m.group(0).strip() if m else None


def _is_contract_article(title: str, description: str) -> bool:
    combined = f"{title} {description}".lower()
    return any(kw.lower() in combined for kw in CONTRACT_KEYWORDS)


async def _fetch_google_news(query: str) -> list[dict]:
    url = f"https://news.google.com/rss/search?q={quote_plus(query)}&hl=en&gl=SA&ceid=SA:en"
    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=12, follow_redirects=True) as client:
            resp = await client.get(url)
            feed = feedparser.parse(resp.text)
            return feed.entries
    except Exception:
        return []


async def _fetch_gazette_tenders() -> list[dict]:
    url = "https://saudigazette.com.sa/rss"
    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=10) as client:
            resp = await client.get(url)
            feed = feedparser.parse(resp.text)
            return [e for e in feed.entries if _is_contract_article(
                getattr(e, "title", ""), getattr(e, "summary", "")
            )]
    except Exception:
        return []


async def fetch_contract_signals(
    company_name: str,
    company_name_ar: Optional[str] = None,
) -> dict:
    queries = [
        f'"{company_name}" contract OR award OR project Saudi Arabia',
        f'"{company_name}" tender OR procurement OR "project win"',
    ]
    if company_name_ar:
        queries.append(f'"{company_name_ar}" عقد OR مشروع OR ترسية')

    tasks = [_fetch_google_news(q) for q in queries]
    tasks.append(_fetch_gazette_tenders())

    all_results = await asyncio.gather(*tasks, return_exceptions=True)

    contracts = []
    seen_urls = set()

    for entries in all_results:
        if isinstance(entries, Exception) or not entries:
            continue
        for entry in entries:
            url = getattr(entry, "link", "") or getattr(entry, "id", "")
            if url in seen_urls:
                continue
            seen_urls.add(url)

            title = getattr(entry, "title", "").strip()
            description = getattr(entry, "summary", "") or getattr(entry, "description", "")
            description = re.sub(r"<[^>]+>", " ", description).strip()

            if not _is_contract_article(title, description):
                continue

            value = _extract_contract_value(f"{title} {description}")
            published = getattr(entry, "published", None)

            contracts.append({
                "title": title,
                "description": description[:300],
                "url": url,
                "published": published,
                "contract_value": value,
                "signal_type": "positive",
                "event_type": "contract",
            })

    return {
        "company": company_name,
        "contract_signals_found": len(contracts),
        "contracts": contracts[:20],
    }
