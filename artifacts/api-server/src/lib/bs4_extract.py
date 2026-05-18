#!/usr/bin/env python3
"""
BeautifulSoup extraction bridge.
Called via subprocess from power-scraper.ts.
Reads HTML from stdin, outputs structured JSON to stdout.

Usage:
  echo "<html>..." | python3 bs4_extract.py [--mode full|text|emails|phones|links]
"""

import sys
import json
import re

try:
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit(json.dumps({"error": "beautifulsoup4 not installed"}))


def extract_emails(text: str) -> list[str]:
    pattern = r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"
    return list(set(re.findall(pattern, text)))[:20]


def extract_phones(text: str) -> list[str]:
    pattern = r"(?:\+966|00966|0)[\s.\-]?\d{2}[\s.\-]?\d{3}[\s.\-]?\d{4}"
    return list(set(re.findall(pattern, text)))[:20]


def extract_links(soup, base_url: str = "") -> list[str]:
    links = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if href and not href.startswith(("#", "mailto:", "tel:", "javascript:")):
            if href.startswith("http"):
                links.append(href)
            elif base_url and href.startswith("/"):
                from urllib.parse import urljoin
                links.append(urljoin(base_url, href))
    return list(set(links))[:100]


def extract_meta(soup) -> dict:
    meta = {}
    title_tag = soup.find("title")
    if title_tag:
        meta["title"] = title_tag.get_text(strip=True)
    desc = soup.find("meta", attrs={"name": "description"})
    if desc:
        meta["description"] = desc.get("content", "")
    og_title = soup.find("meta", attrs={"property": "og:title"})
    if og_title:
        meta["og_title"] = og_title.get("content", "")
    og_desc = soup.find("meta", attrs={"property": "og:description"})
    if og_desc:
        meta["og_description"] = og_desc.get("content", "")
    return meta


def extract_structured_text(soup) -> str:
    for tag in soup(["script", "style", "noscript", "head", "svg", "iframe", "nav", "footer"]):
        tag.decompose()

    blocks = []
    for tag in soup.find_all(["h1", "h2", "h3", "h4", "p", "li", "td", "th", "span", "div"]):
        text = tag.get_text(separator=" ", strip=True)
        if len(text) > 30:
            blocks.append(text)

    seen = set()
    unique = []
    for b in blocks:
        key = b[:80]
        if key not in seen:
            seen.add(key)
            unique.append(b)

    return "\n".join(unique)[:8000]


def main():
    mode = "full"
    base_url = ""
    for i, arg in enumerate(sys.argv[1:]):
        if arg == "--mode" and i + 1 < len(sys.argv[1:]):
            mode = sys.argv[i + 2]
        if arg == "--url" and i + 1 < len(sys.argv[1:]):
            base_url = sys.argv[i + 2]

    html = sys.stdin.buffer.read().decode("utf-8", errors="replace")
    if not html.strip():
        print(json.dumps({"error": "empty input"}))
        return

    soup = BeautifulSoup(html, "lxml")

    if mode == "text":
        print(json.dumps({"text": extract_structured_text(soup)}))
        return

    if mode == "emails":
        raw = soup.get_text(separator=" ")
        print(json.dumps({"emails": extract_emails(raw)}))
        return

    if mode == "phones":
        raw = soup.get_text(separator=" ")
        print(json.dumps({"phones": extract_phones(raw)}))
        return

    if mode == "links":
        print(json.dumps({"links": extract_links(soup, base_url)}))
        return

    raw_text = soup.get_text(separator=" ")
    result = {
        "meta": extract_meta(soup),
        "text": extract_structured_text(soup),
        "emails": extract_emails(raw_text),
        "phones": extract_phones(raw_text),
        "links": extract_links(soup, base_url),
        "char_count": len(raw_text),
        "has_arabic": bool(re.search(r"[\u0600-\u06FF]", raw_text)),
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
