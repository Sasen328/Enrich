"""
Social Presence Scanner — Sherlock-style
Checks Arabic/Saudi-focused + global platforms for username presence.
Returns profile URLs, bios, follower counts where available.
"""

import asyncio
import re
from typing import Optional
import httpx

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ar-SA,ar;q=0.9,en;q=0.7",
}

PLATFORMS = [
    {"name": "Twitter/X",         "url": "https://x.com/{username}",                    "not_found": ["This account doesn't exist", "page not found"]},
    {"name": "Instagram",         "url": "https://www.instagram.com/{username}/",        "not_found": ["page not found", "Sorry, this page"]},
    {"name": "LinkedIn (Company)","url": "https://www.linkedin.com/company/{username}",  "not_found": ["Page not found", "No results found"]},
    {"name": "Facebook",          "url": "https://www.facebook.com/{username}",          "not_found": ["page not found", "This content isn't available"]},
    {"name": "YouTube",           "url": "https://www.youtube.com/@{username}",          "not_found": ["404", "This page isn't available"]},
    {"name": "TikTok",            "url": "https://www.tiktok.com/@{username}",           "not_found": ["Couldn't find this account"]},
    {"name": "Snapchat",          "url": "https://www.snapchat.com/add/{username}",      "not_found": ["Sorry, we couldn't find"]},
    {"name": "GitHub",            "url": "https://github.com/{username}",                "not_found": ["Not Found"]},
    {"name": "GitLab",            "url": "https://gitlab.com/{username}",                "not_found": ["404"]},
    {"name": "Medium",            "url": "https://medium.com/@{username}",               "not_found": ["404"]},
    {"name": "Behance",           "url": "https://www.behance.net/{username}",           "not_found": ["404", "page not found"]},
    {"name": "Pinterest",         "url": "https://www.pinterest.com/{username}/",        "not_found": ["404"]},
    {"name": "SoundCloud",        "url": "https://soundcloud.com/{username}",            "not_found": ["404"]},
    {"name": "Twitch",            "url": "https://www.twitch.tv/{username}",             "not_found": ["Sorry. Unless you've got a time machine"]},
    {"name": "Reddit",            "url": "https://www.reddit.com/user/{username}",       "not_found": ["page not found"]},
]

TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
OG_TITLE_RE = re.compile(r'<meta[^>]*property=["\']og:title["\'][^>]*content=["\'](.*?)["\']', re.IGNORECASE)
DESC_RE = re.compile(r'<meta[^>]*name=["\']description["\'][^>]*content=["\'](.*?)["\']', re.IGNORECASE)


def _extract_meta(html: str) -> dict:
    title = ""
    desc = ""
    m = OG_TITLE_RE.search(html) or TITLE_RE.search(html)
    if m:
        title = m.group(1).strip()[:120]
    d = DESC_RE.search(html)
    if d:
        desc = d.group(1).strip()[:200]
    return {"title": title, "description": desc}


async def _check_platform(
    client: httpx.AsyncClient,
    platform: dict,
    username: str,
) -> Optional[dict]:
    url = platform["url"].format(username=username)
    try:
        r = await client.get(url, timeout=10)
        if r.status_code == 404:
            return None
        if r.status_code >= 500:
            return {"platform": platform["name"], "url": url, "status": "error", "status_code": r.status_code}

        html = r.text
        not_found_signals = platform.get("not_found", [])
        for signal in not_found_signals:
            if signal.lower() in html.lower():
                return None

        meta = _extract_meta(html)
        return {
            "platform": platform["name"],
            "url": url,
            "status": "found",
            "status_code": r.status_code,
            "title": meta["title"],
            "description": meta["description"],
        }
    except Exception as e:
        return {"platform": platform["name"], "url": url, "status": "error", "error": str(e)}


async def scan_social_presence(
    username: str,
    platforms: Optional[list[str]] = None,
) -> dict:
    target_platforms = PLATFORMS
    if platforms:
        pl_lower = [p.lower() for p in platforms]
        target_platforms = [p for p in PLATFORMS if p["name"].lower() in pl_lower]

    result: dict = {
        "username": username,
        "found": [],
        "not_found": [],
        "errors": [],
        "total_checked": len(target_platforms),
    }

    async with httpx.AsyncClient(
        headers=HEADERS,
        follow_redirects=True,
        verify=False,
    ) as client:
        sem = asyncio.Semaphore(8)

        async def guarded(platform: dict) -> Optional[dict]:
            async with sem:
                return await _check_platform(client, platform, username)

        tasks = [guarded(p) for p in target_platforms]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    for r in results:
        if isinstance(r, Exception):
            result["errors"].append(str(r))
        elif r is None:
            result["not_found"].append(r)
        elif isinstance(r, dict):
            if r.get("status") == "found":
                result["found"].append(r)
            elif r.get("status") == "error":
                result["errors"].append(r)

    result["found_count"] = len(result["found"])
    return result
