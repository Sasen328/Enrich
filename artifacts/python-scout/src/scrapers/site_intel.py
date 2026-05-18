"""
Site Intelligence Scraper — httpx + BeautifulSoup
Extracts contacts, social links, meta info from any URL.
Handles Arabic + English content.
"""

import asyncio
import re
import json
from typing import Optional
from urllib.parse import urljoin, urlparse

import httpx
import tldextract
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ar-SA,ar;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}

SAUDI_SOCIAL = {
    "twitter": r"(?:twitter\.com|x\.com)/([A-Za-z0-9_]{1,50})",
    "linkedin": r"linkedin\.com/(?:company|in)/([A-Za-z0-9\-_]+)",
    "instagram": r"instagram\.com/([A-Za-z0-9_.]{1,50})",
    "facebook": r"facebook\.com/([A-Za-z0-9.\-_]+)",
    "youtube": r"youtube\.com/(?:c/|channel/|@)([A-Za-z0-9\-_@.]+)",
    "snapchat": r"snapchat\.com/add/([A-Za-z0-9_.]+)",
    "tiktok": r"tiktok\.com/@([A-Za-z0-9_.]+)",
}

EMAIL_RE = re.compile(
    r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,10}\b"
)
PHONE_SA_RE = re.compile(
    r"(?:\+?966|00966|0)?[\s\-]?(?:[1-9]\d{1,2})[\s\-]?\d{3,4}[\s\-]?\d{4}"
)
CR_RE = re.compile(r"\b10\d{8}\b")
VAT_RE = re.compile(r"\b3\d{13}\b")


def _extract_text_blocks(soup: BeautifulSoup) -> str:
    for tag in soup(["script", "style", "noscript", "head"]):
        tag.decompose()
    return " ".join(soup.stripped_strings)


def _find_emails(text: str, html: str) -> list[str]:
    found = set(EMAIL_RE.findall(text))
    found.update(EMAIL_RE.findall(html))
    junk_domains = {"sentry.io", "example.com", "schema.org", "w3.org"}
    return sorted(
        e for e in found if not any(j in e for j in junk_domains)
    )


def _find_phones(text: str) -> list[str]:
    raw = PHONE_SA_RE.findall(text)
    cleaned = []
    for p in raw:
        digits = re.sub(r"[^\d+]", "", p)
        if len(digits) >= 9:
            cleaned.append(p.strip())
    return list(dict.fromkeys(cleaned))


def _find_socials(html: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for platform, pattern in SAUDI_SOCIAL.items():
        m = re.search(pattern, html, re.IGNORECASE)
        if m:
            found[platform] = m.group(0)
    return found


def _find_cr_vat(text: str) -> dict[str, str]:
    result: dict[str, str] = {}
    cr = CR_RE.search(text)
    vat = VAT_RE.search(text)
    if cr:
        result["cr_number"] = cr.group(0)
    if vat:
        result["vat_number"] = vat.group(0)
    return result


def _extract_meta(soup: BeautifulSoup, base_url: str) -> dict:
    meta: dict = {}
    title = soup.find("title")
    if title:
        meta["title"] = title.get_text(strip=True)

    for name in ["description", "keywords", "author"]:
        tag = soup.find("meta", attrs={"name": name}) or soup.find(
            "meta", attrs={"property": f"og:{name}"}
        )
        if tag and tag.get("content"):
            meta[name] = tag["content"]

    og_image = soup.find("meta", attrs={"property": "og:image"})
    if og_image and og_image.get("content"):
        meta["og_image"] = og_image["content"]

    logo = soup.find("link", rel=lambda r: r and "icon" in r)
    if logo and logo.get("href"):
        meta["favicon"] = urljoin(base_url, logo["href"])

    return meta


def _extract_nav_links(soup: BeautifulSoup, base_url: str) -> list[str]:
    nav = soup.find("nav") or soup.find(attrs={"role": "navigation"})
    if not nav:
        return []
    links = []
    for a in nav.find_all("a", href=True):
        href = a["href"]
        if href.startswith("http"):
            links.append(href)
        elif href.startswith("/"):
            links.append(urljoin(base_url, href))
    return list(dict.fromkeys(links))[:20]


def _detect_language(text: str) -> str:
    arabic_chars = len(re.findall(r"[\u0600-\u06FF]", text))
    total = len(text.replace(" ", ""))
    if total == 0:
        return "unknown"
    ratio = arabic_chars / total
    if ratio > 0.5:
        return "arabic"
    elif ratio > 0.1:
        return "bilingual"
    return "english"


def _detect_cms(html: str) -> Optional[str]:
    sigs = {
        "WordPress": ["wp-content", "wp-includes", "wp-json"],
        "Drupal": ["sites/default", "drupal.js"],
        "Joomla": ["joomla", "/components/com_"],
        "Wix": ["wix.com", "_wix_"],
        "Squarespace": ["squarespace.com", "static1.squarespace"],
        "Shopify": ["shopify.com", "myshopify"],
        "Webflow": ["webflow.io", "webflow.com"],
    }
    for cms, patterns in sigs.items():
        if any(p.lower() in html.lower() for p in patterns):
            return cms
    return None


def _detect_tech(html: str, headers: dict) -> list[str]:
    tech = []
    checks = [
        ("React", ["react", "__react", "react-root"]),
        ("Vue.js", ["vue.", "__vue", "nuxt"]),
        ("Angular", ["ng-version", "angular", "ng-app"]),
        ("jQuery", ["jquery", "jQuery"]),
        ("Bootstrap", ["bootstrap", "btn btn-"]),
        ("Tailwind CSS", ["tailwind", "tw-"]),
        ("Google Analytics", ["gtag(", "GA_TRACKING", "google-analytics"]),
        ("Google Tag Manager", ["googletagmanager"]),
        ("Hotjar", ["hotjar"]),
        ("Intercom", ["intercom"]),
        ("HubSpot", ["hubspot", "hs-scripts"]),
    ]
    server = headers.get("server", "")
    if server:
        tech.append(f"Server: {server}")
    powered = headers.get("x-powered-by", "")
    if powered:
        tech.append(f"Powered-by: {powered}")
    for name, patterns in checks:
        if any(p.lower() in html.lower() for p in patterns):
            tech.append(name)
    return tech


async def scrape_site_intel(
    url: str,
    follow_about: bool = True,
    timeout: int = 20,
) -> dict:
    parsed = urlparse(url)
    if not parsed.scheme:
        url = "https://" + url
        parsed = urlparse(url)
    base_url = f"{parsed.scheme}://{parsed.netloc}"

    result: dict = {
        "url": url,
        "base_url": base_url,
        "domain": tldextract.extract(url).registered_domain,
        "ok": False,
        "status_code": None,
        "meta": {},
        "language": "unknown",
        "cms": None,
        "tech_stack": [],
        "emails": [],
        "phones": [],
        "socials": {},
        "cr_vat": {},
        "nav_links": [],
        "about_page": {},
        "contact_page": {},
        "raw_text_snippet": "",
        "errors": [],
    }

    async with httpx.AsyncClient(
        headers=HEADERS,
        follow_redirects=True,
        timeout=timeout,
        verify=False,
    ) as client:
        try:
            resp = await client.get(url)
            result["status_code"] = resp.status_code
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            result["errors"].append(f"HTTP {e.response.status_code}: {url}")
            return result
        except Exception as e:
            result["errors"].append(str(e))
            return result

        html = resp.text
        soup = BeautifulSoup(html, "lxml")
        text = _extract_text_blocks(soup)
        resp_headers = dict(resp.headers)

        result["ok"] = True
        result["meta"] = _extract_meta(soup, base_url)
        result["language"] = _detect_language(text)
        result["cms"] = _detect_cms(html)
        result["tech_stack"] = _detect_tech(html, resp_headers)
        result["emails"] = _find_emails(text, html)
        result["phones"] = _find_phones(text)
        result["socials"] = _find_socials(html)
        result["cr_vat"] = _find_cr_vat(text)
        result["nav_links"] = _extract_nav_links(soup, base_url)
        result["raw_text_snippet"] = text[:3000]

        if follow_about:
            sub_tasks = []
            about_url = None
            contact_url = None

            for link in result["nav_links"]:
                lpath = link.lower()
                if any(k in lpath for k in ["about", "من-نحن", "عن-الشركة", "about-us", "company"]):
                    if not about_url:
                        about_url = link
                if any(k in lpath for k in ["contact", "اتصل", "تواصل", "contact-us"]):
                    if not contact_url:
                        contact_url = link

            async def fetch_sub(sub_url: str) -> dict:
                try:
                    r = await client.get(sub_url)
                    s = BeautifulSoup(r.text, "lxml")
                    t = _extract_text_blocks(s)
                    return {
                        "url": sub_url,
                        "emails": _find_emails(t, r.text),
                        "phones": _find_phones(t),
                        "text_snippet": t[:1500],
                    }
                except Exception as ex:
                    return {"url": sub_url, "error": str(ex)}

            if about_url and about_url != url:
                result["about_page"] = await fetch_sub(about_url)
            if contact_url and contact_url != url:
                result["contact_page"] = await fetch_sub(contact_url)

            all_emails = set(result["emails"])
            for page in [result["about_page"], result["contact_page"]]:
                all_emails.update(page.get("emails", []))
            result["emails"] = sorted(all_emails)

    return result
