"""
News Monitor — Google News RSS + Saudi business media feeds.
Fetches trigger events for a company name (English + Arabic).

Sources (all free, no auth):
  - Google News RSS (Saudi/Arabic edition)
  - Arab News RSS (English, KSA-focused)
  - Saudi Gazette RSS
  - Argaam RSS (Arabic financial news)
  - Mubasher RSS
  - Al Eqtisadiah RSS
"""

import asyncio
import hashlib
import re
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote_plus

import feedparser
import httpx
from dateutil import parser as dateparser

# ── RSS feed templates ─────────────────────────────────────────────────────────

GOOGLE_NEWS_AR = "https://news.google.com/rss/search?q={query}&hl=ar&gl=SA&ceid=SA:ar"
GOOGLE_NEWS_EN = "https://news.google.com/rss/search?q={query}&hl=en&gl=SA&ceid=SA:en"

STATIC_FEEDS = [
    {"name": "Arab News",       "url": "https://www.arabnews.com/rss.xml",                  "lang": "en"},
    {"name": "Arab News Biz",   "url": "https://www.arabnews.com/taxonomy/term/2/feed",     "lang": "en"},
    {"name": "Saudi Gazette",   "url": "https://saudigazette.com.sa/rss",                   "lang": "en"},
    {"name": "Argaam",          "url": "https://www.argaam.com/ar/article/rss",             "lang": "ar"},
    {"name": "Mubasher",        "url": "https://mubasher.info/feed",                        "lang": "ar"},
    {"name": "Al Eqtisadiah",   "url": "https://www.aleqt.com/rss",                        "lang": "ar"},
    {"name": "Maal",            "url": "https://maal.net/feed",                            "lang": "ar"},
    {"name": "Forbes ME",       "url": "https://www.forbesmiddleeast.com/feed/",            "lang": "en"},
    {"name": "CNBC Arabia",     "url": "https://www.cnbcarabia.com/rss",                   "lang": "ar"},
    {"name": "Al Arabiya Biz",  "url": "https://www.alarabiya.net/aswaq.rss",              "lang": "ar"},
    {"name": "Wamda",           "url": "https://www.wamda.com/rss",                        "lang": "en"},
    {"name": "Asharq Al-Awsat", "url": "https://aawsat.com/rss",                          "lang": "ar"},
]

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; ProspectSA-Scout/1.0)"}

# ── Event keyword classifiers ──────────────────────────────────────────────────

POSITIVE_KEYWORDS = {
    "funding":       ["funding", "investment", "raised", "series", "capital raise", "تمويل", "استثمار"],
    "ipo":           ["ipo", "listing", "tadawul", "طرح عام", "اكتتاب", "ipo"],
    "acquisition":   ["acqui", "merger", "takeover", "acquired", "اندماج", "استحواذ"],
    "contract":      ["contract", "award", "project win", "tender", "عقد", "مشروع", "ترسية"],
    "dividend":      ["dividend", "distribution", "توزيع أرباح", "أرباح"],
    "expansion":     ["expansion", "new branch", "open", "launch", "توسع", "افتتاح"],
    "executive":     ["appointed", "CEO", "chairman", "تعيين", "رئيس تنفيذي"],
    "partnership":   ["partnership", "joint venture", "JV", "شراكة", "مشروع مشترك"],
    "revenue":       ["record revenue", "profit", "growth", "أرباح", "نمو", "إيرادات"],
}

NEGATIVE_KEYWORDS = {
    "lawsuit":       ["lawsuit", "sued", "litigation", "court", "دعوى", "قضية", "محكمة"],
    "fine":          ["fine", "penalty", "violation", "غرامة", "مخالفة", "عقوبة"],
    "bankruptcy":    ["bankruptcy", "insolvent", "liquidat", "إفلاس", "تصفية", "إعسار"],
    "sanctions":     ["sanction", "blacklist", "debarred", "عقوبات", "قائمة سوداء"],
    "fraud":         ["fraud", "corruption", "embezzlement", "غش", "فساد", "اختلاس"],
    "layoff":        ["layoff", "redundanc", "restructur", "تسريح", "إعادة هيكلة"],
    "investigation": ["investigat", "probe", "inquiry", "تحقيق", "مراجعة", "استفسار"],
    "breach":        ["data breach", "hack", "cyberattack", "اختراق", "هجوم إلكتروني"],
    "downgrade":     ["downgrade", "credit rating", "تخفيض", "تصنيف ائتماني"],
}


def _classify_headline(title: str, description: str) -> dict:
    text = f"{title} {description}".lower()
    detected_positive = {}
    detected_negative = {}

    for event_type, keywords in POSITIVE_KEYWORDS.items():
        for kw in keywords:
            if kw.lower() in text:
                detected_positive[event_type] = kw
                break

    for event_type, keywords in NEGATIVE_KEYWORDS.items():
        for kw in keywords:
            if kw.lower() in text:
                detected_negative[event_type] = kw
                break

    if detected_positive and not detected_negative:
        category = "positive"
        event_types = list(detected_positive.keys())
    elif detected_negative and not detected_positive:
        category = "negative"
        event_types = list(detected_negative.keys())
    elif detected_positive and detected_negative:
        category = "mixed"
        event_types = list(detected_positive.keys()) + list(detected_negative.keys())
    else:
        category = "neutral"
        event_types = []

    return {
        "category": category,
        "event_types": event_types,
        "positive_signals": detected_positive,
        "negative_signals": detected_negative,
    }


def _parse_date(entry) -> Optional[str]:
    for attr in ["published", "updated", "created"]:
        val = getattr(entry, attr, None)
        if val:
            try:
                dt = dateparser.parse(val)
                return dt.isoformat() if dt else None
            except Exception:
                return val
    return None


def _article_id(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()[:12]


async def _fetch_rss(url: str, timeout: int = 10) -> list[dict]:
    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=timeout, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            feed = feedparser.parse(resp.text)
            return feed.entries
    except Exception:
        return []


def _entry_matches_company(entry, company_terms: list[str]) -> bool:
    text = " ".join([
        getattr(entry, "title", ""),
        getattr(entry, "summary", ""),
        getattr(entry, "description", ""),
    ]).lower()
    return any(term.lower() in text for term in company_terms)


async def fetch_company_news(
    company_name: str,
    company_name_ar: Optional[str] = None,
    domain: Optional[str] = None,
    max_articles: int = 30,
    days_back: int = 90,
) -> dict:
    search_terms = [company_name]
    if company_name_ar:
        search_terms.append(company_name_ar)
    if domain:
        clean = domain.replace("www.", "").split(".")[0]
        search_terms.append(clean)

    # Build search queries
    en_query = quote_plus(f'"{company_name}"')
    ar_query = quote_plus(company_name_ar or company_name)

    google_en_url = GOOGLE_NEWS_EN.format(query=en_query)
    google_ar_url = GOOGLE_NEWS_AR.format(query=ar_query)

    # Fetch all feeds in parallel
    feed_tasks = [
        ("Google News EN", _fetch_rss(google_en_url)),
        ("Google News AR", _fetch_rss(google_ar_url)),
    ]
    for feed_meta in STATIC_FEEDS:
        feed_tasks.append((feed_meta["name"], _fetch_rss(feed_meta["url"])))

    results_raw = await asyncio.gather(*[t[1] for t in feed_tasks], return_exceptions=True)

    all_articles = []
    seen_ids = set()

    for (feed_name, _), entries in zip(feed_tasks, results_raw):
        if isinstance(entries, Exception) or not isinstance(entries, list):
            continue

        # For static feeds, filter entries by company name match
        is_google = "Google News" in feed_name
        for entry in entries:
            if not is_google:
                if not _entry_matches_company(entry, search_terms):
                    continue

            url = getattr(entry, "link", "") or getattr(entry, "id", "")
            art_id = _article_id(url)
            if art_id in seen_ids:
                continue
            seen_ids.add(art_id)

            title = getattr(entry, "title", "").strip()
            summary = getattr(entry, "summary", "") or getattr(entry, "description", "")
            summary = re.sub(r"<[^>]+>", " ", summary).strip()[:500]
            published = _parse_date(entry)

            classification = _classify_headline(title, summary)

            all_articles.append({
                "id": art_id,
                "source": feed_name,
                "title": title,
                "summary": summary,
                "url": url,
                "published": published,
                "category": classification["category"],
                "event_types": classification["event_types"],
                "positive_signals": classification["positive_signals"],
                "negative_signals": classification["negative_signals"],
            })

    # Sort by date descending (nones last), limit
    def sort_key(a):
        p = a.get("published")
        if not p:
            return ""
        return p

    all_articles.sort(key=sort_key, reverse=True)
    all_articles = all_articles[:max_articles]

    positive_count = sum(1 for a in all_articles if a["category"] == "positive")
    negative_count = sum(1 for a in all_articles if a["category"] == "negative")
    neutral_count = sum(1 for a in all_articles if a["category"] == "neutral")

    all_event_types: dict[str, int] = {}
    for a in all_articles:
        for et in a.get("event_types", []):
            all_event_types[et] = all_event_types.get(et, 0) + 1

    return {
        "company": company_name,
        "total_articles": len(all_articles),
        "positive_count": positive_count,
        "negative_count": negative_count,
        "neutral_count": neutral_count,
        "event_type_summary": all_event_types,
        "articles": all_articles,
    }
