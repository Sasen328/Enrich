"""
Individual Signal Monitor
Tracks personal trigger events for HNWI and key decision-makers:
  - Obituary / death events → inheritance / estate liquidity
  - Promotion / new appointment → new budget authority
  - Job change / departure → relationship window, new employer
  - Executive compensation / bonus → personal cash event
  - Stock vesting / IPO lock-up expiry → personal liquidity
  - Award / recognition → wealth/status signal
  - Personal lawsuit / arrest → risk disqualifier
  - Personal bankruptcy → risk disqualifier

Sources (all free):
  - Google News RSS (Arabic + English, name-based search)
  - Arab News, Saudi Gazette RSS (filtered by name)
  - Legacy.com RSS (obituaries)
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

GOOGLE_NEWS_AR = "https://news.google.com/rss/search?q={query}&hl=ar&gl=SA&ceid=SA:ar"
GOOGLE_NEWS_EN = "https://news.google.com/rss/search?q={query}&hl=en&gl=SA&ceid=SA:en"

STATIC_PERSON_FEEDS = [
    {"name": "Arab News",     "url": "https://www.arabnews.com/rss.xml",                  "lang": "en"},
    {"name": "Arab News Biz", "url": "https://www.arabnews.com/taxonomy/term/2/feed",      "lang": "en"},
    {"name": "Saudi Gazette", "url": "https://saudigazette.com.sa/rss",                   "lang": "en"},
    {"name": "Argaam",        "url": "https://www.argaam.com/ar/article/rss",              "lang": "ar"},
    {"name": "Al Eqtisadiah", "url": "https://www.aleqt.com/rss",                         "lang": "ar"},
    {"name": "Forbes ME",     "url": "https://www.forbesmiddleeast.com/feed/",             "lang": "en"},
    {"name": "CNBC Arabia",   "url": "https://www.cnbcarabia.com/rss",                    "lang": "ar"},
]

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; ProspectSA-Scout/1.0)"}

# ── Individual positive event keywords ─────────────────────────────────────────

INDIVIDUAL_POSITIVE = {
    "obituary":      ["passed away", "died", "death", "obituary", "funeral", "estate", "وفاة", "توفي", "رحيل", "تركة", "إرث"],
    "promotion":     ["promoted", "appointed", "named CEO", "named chairman", "new role", "ترقية", "تعيين", "رئيس جديد"],
    "job_change":    ["joins", "joined", "left", "departed", "new position", "انتقل", "التحق بـ", "استقال", "منصب جديد"],
    "compensation":  ["bonus", "compensation", "salary", "remuneration", "stock award", "مكافأة", "راتب", "تعويض"],
    "vesting":       ["vested", "exercised options", "stock grant", "share sale", "insider sale", "أسهم", "خيارات أسهم"],
    "award":         ["award", "recognition", "honor", "Forbes", "richest", "billionaire", "جائزة", "تقدير", "أثرى", "مليارد"],
    "inheritance":   ["inherited", "heir", "estate", "trust", "will", "وارث", "ميراث", "تركة"],
    "personal_deal": ["personal investment", "family office", "private equity", "angel invest", "استثمار شخصي", "مكتب عائلي"],
}

INDIVIDUAL_NEGATIVE = {
    "personal_lawsuit": ["sued", "lawsuit", "court case", "arrested", "دعوى", "قضية", "اعتقل"],
    "fraud":            ["fraud", "corruption", "bribery", "embezzlement", "غش", "فساد", "رشوة", "اختلاس"],
    "bankruptcy":       ["personal bankruptcy", "insolvent", "debt", "إفلاس شخصي", "ديون"],
    "investigation":    ["under investigation", "probe", "تحقيق", "مراجعة جنائية"],
    "sanctioned":       ["sanctioned", "blacklisted", "debarred", "عقوبات", "قائمة سوداء"],
    "health":           ["health crisis", "hospitalized", "serious illness", "مستشفى", "مرض خطير"],
}

LIQUIDITY_EVENTS = {"obituary", "inheritance", "vesting", "compensation", "personal_deal", "promotion"}
HIGH_BUYING_SIGNAL = {"obituary", "inheritance", "vesting", "personal_deal"}
MODERATE_BUYING_SIGNAL = {"promotion", "compensation", "award", "job_change"}
HIGH_RISK = {"fraud", "personal_lawsuit", "sanctioned", "investigation"}


def _classify_individual_headline(title: str, description: str) -> dict:
    text = f"{title} {description}".lower()
    detected_positive = {}
    detected_negative = {}

    for event_type, keywords in INDIVIDUAL_POSITIVE.items():
        for kw in keywords:
            if kw.lower() in text:
                detected_positive[event_type] = kw
                break

    for event_type, keywords in INDIVIDUAL_NEGATIVE.items():
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

    # Compute individual buying / risk scores
    buying_score = 0
    risk_score = 0
    for et in event_types:
        if et in HIGH_BUYING_SIGNAL:
            buying_score = max(buying_score, 9)
        elif et in MODERATE_BUYING_SIGNAL:
            buying_score = max(buying_score, 6)
        if et in HIGH_RISK:
            risk_score = max(risk_score, 9)

    return {
        "category": category,
        "event_types": event_types,
        "positive_signals": detected_positive,
        "negative_signals": detected_negative,
        "buying_score": buying_score,
        "risk_score": risk_score,
        "is_liquidity_event": any(et in LIQUIDITY_EVENTS for et in event_types),
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


def _entry_matches_person(entry, name_terms: list[str]) -> bool:
    text = " ".join([
        getattr(entry, "title", ""),
        getattr(entry, "summary", ""),
        getattr(entry, "description", ""),
    ]).lower()
    return any(term.lower() in text for term in name_terms)


async def fetch_individual_signals(
    full_name: str,
    full_name_ar: Optional[str] = None,
    company_name: Optional[str] = None,
    title: Optional[str] = None,
    max_articles: int = 30,
) -> dict:
    """
    Fetch personal trigger events for a named individual.
    Searches Google News + Saudi business media for:
    - Death / obituary / inheritance
    - Promotion / new role
    - Job change / departure
    - Bonus / compensation
    - Fraud / arrest / investigation
    """
    name_terms = [full_name]
    if full_name_ar:
        name_terms.append(full_name_ar)
    if company_name:
        name_terms.append(company_name)

    # Build targeted queries
    en_query = quote_plus(f'"{full_name}"')
    ar_query = quote_plus(full_name_ar or full_name)

    # Add obituary-specific query
    obituary_en_query = quote_plus(f'"{full_name}" death OR obituary OR estate OR inheritance OR heir')
    if full_name_ar:
        obituary_ar_query = quote_plus(f'{full_name_ar} وفاة OR ميراث OR تركة OR إرث')
    else:
        obituary_ar_query = None

    # Promotion/job-change query
    career_en_query = quote_plus(f'"{full_name}" appointed OR promoted OR joins OR left OR resigned')

    feed_tasks = [
        ("Google News EN", _fetch_rss(GOOGLE_NEWS_EN.format(query=en_query))),
        ("Google News AR", _fetch_rss(GOOGLE_NEWS_AR.format(query=ar_query))),
        ("Google News Obituary EN", _fetch_rss(GOOGLE_NEWS_EN.format(query=obituary_en_query))),
        ("Google News Career EN", _fetch_rss(GOOGLE_NEWS_EN.format(query=career_en_query))),
    ]
    if obituary_ar_query:
        feed_tasks.append(("Google News Obituary AR", _fetch_rss(GOOGLE_NEWS_AR.format(query=obituary_ar_query))))

    for feed_meta in STATIC_PERSON_FEEDS:
        feed_tasks.append((feed_meta["name"], _fetch_rss(feed_meta["url"])))

    results_raw = await asyncio.gather(*[t[1] for t in feed_tasks], return_exceptions=True)

    all_articles = []
    seen_ids = set()

    for (feed_name, _), entries in zip(feed_tasks, results_raw):
        if isinstance(entries, Exception) or not isinstance(entries, list):
            continue

        is_google = "Google News" in feed_name
        for entry in entries:
            if not is_google:
                if not _entry_matches_person(entry, name_terms):
                    continue

            url = getattr(entry, "link", "") or getattr(entry, "id", "")
            art_id = _article_id(url)
            if art_id in seen_ids:
                continue
            seen_ids.add(art_id)

            art_title = getattr(entry, "title", "").strip()
            summary = getattr(entry, "summary", "") or getattr(entry, "description", "")
            summary = re.sub(r"<[^>]+>", " ", summary).strip()[:500]
            published = _parse_date(entry)

            classification = _classify_individual_headline(art_title, summary)

            all_articles.append({
                "id": art_id,
                "source": feed_name,
                "title": art_title,
                "summary": summary,
                "url": url,
                "published": published,
                "category": classification["category"],
                "event_types": classification["event_types"],
                "positive_signals": classification["positive_signals"],
                "negative_signals": classification["negative_signals"],
                "buying_score": classification["buying_score"],
                "risk_score": classification["risk_score"],
                "is_liquidity_event": classification["is_liquidity_event"],
            })

    all_articles.sort(key=lambda a: a.get("published") or "", reverse=True)
    all_articles = all_articles[:max_articles]

    positive_count = sum(1 for a in all_articles if a["category"] == "positive")
    negative_count = sum(1 for a in all_articles if a["category"] == "negative")
    liquidity_events = [a for a in all_articles if a.get("is_liquidity_event")]

    all_event_types: dict[str, int] = {}
    for a in all_articles:
        for et in a.get("event_types", []):
            all_event_types[et] = all_event_types.get(et, 0) + 1

    overall_buying = max((a["buying_score"] for a in all_articles if a["buying_score"] > 0), default=0)
    overall_risk = max((a["risk_score"] for a in all_articles if a["risk_score"] > 0), default=0)

    if overall_risk >= 9:
        recommended_action = "disqualify"
    elif overall_risk >= 7:
        recommended_action = "hold"
    elif overall_buying >= 7:
        recommended_action = "prioritize"
    else:
        recommended_action = "monitor"

    return {
        "subject": full_name,
        "subject_ar": full_name_ar,
        "company": company_name,
        "title": title,
        "total_articles": len(all_articles),
        "positive_count": positive_count,
        "negative_count": negative_count,
        "liquidity_events_count": len(liquidity_events),
        "event_type_summary": all_event_types,
        "buying_score": overall_buying,
        "risk_score": overall_risk,
        "recommended_action": recommended_action,
        "liquidity_events": liquidity_events[:5],
        "articles": all_articles,
    }
