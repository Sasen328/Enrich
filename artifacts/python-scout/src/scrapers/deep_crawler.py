"""
Deep Crawler — Scrapy-based recursive site crawler.
Used when a surface-level httpx scan isn't enough.
Runs as an async wrapper around a Scrapy CrawlerProcess.
"""

import asyncio
import re
import json
from multiprocessing import Process, Queue
from typing import Optional
from urllib.parse import urlparse

EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,10}\b")
PHONE_RE = re.compile(r"(?:\+?966|00966|0)?[\s\-]?(?:[1-9]\d{1,2})[\s\-]?\d{3,4}[\s\-]?\d{4}")


def _run_scrapy_in_process(start_url: str, max_pages: int, output_queue: Queue) -> None:
    import scrapy
    from scrapy.crawler import CrawlerProcess
    from scrapy.utils.project import get_project_settings

    parsed = urlparse(start_url)
    base_domain = parsed.netloc

    emails: set = set()
    phones: set = set()
    pages: list = []

    class SaudiSpider(scrapy.Spider):
        name = "saudi_scout"
        allowed_domains = [base_domain]
        start_urls = [start_url]
        custom_settings = {
            "ROBOTSTXT_OBEY": False,
            "DOWNLOAD_TIMEOUT": 15,
            "CONCURRENT_REQUESTS": 8,
            "DEPTH_LIMIT": 3,
            "CLOSESPIDER_PAGECOUNT": max_pages,
            "LOG_LEVEL": "ERROR",
            "DEFAULT_REQUEST_HEADERS": {
                "User-Agent": "Mozilla/5.0 (compatible; Scout/1.0)",
                "Accept-Language": "ar-SA,ar;q=0.9,en;q=0.7",
            },
        }

        def parse(self, response):
            text = " ".join(response.css("*::text").getall())
            found_emails = EMAIL_RE.findall(text)
            found_phones = PHONE_RE.findall(text)
            emails.update(found_emails)
            phones.update(found_phones)
            pages.append({
                "url": response.url,
                "title": response.css("title::text").get(""),
                "email_count": len(found_emails),
                "phone_count": len(found_phones),
                "text_length": len(text),
            })
            for href in response.css("a::attr(href)").getall():
                yield response.follow(href, self.parse)

    settings = get_project_settings()
    settings.setmodule({
        "ROBOTSTXT_OBEY": False,
        "LOG_LEVEL": "ERROR",
    })

    process = CrawlerProcess(settings={
        "ROBOTSTXT_OBEY": False,
        "LOG_LEVEL": "ERROR",
        "DOWNLOAD_TIMEOUT": 15,
        "CONCURRENT_REQUESTS": 8,
        "DEPTH_LIMIT": 3,
        "CLOSESPIDER_PAGECOUNT": max_pages,
        "DEFAULT_REQUEST_HEADERS": {
            "User-Agent": "Mozilla/5.0 (compatible; Scout/1.0)",
        },
    })
    process.crawl(SaudiSpider)
    process.start()

    output_queue.put({
        "emails": sorted(emails),
        "phones": sorted(phones),
        "pages_crawled": pages,
        "total_pages": len(pages),
    })


async def deep_crawl(url: str, max_pages: int = 30) -> dict:
    loop = asyncio.get_event_loop()
    q: Queue = Queue()

    def run_in_thread():
        _run_scrapy_in_process(url, max_pages, q)

    try:
        await asyncio.wait_for(
            loop.run_in_executor(None, run_in_thread),
            timeout=60,
        )
        if not q.empty():
            return q.get()
    except asyncio.TimeoutError:
        return {
            "error": "Crawl timed out after 60 seconds",
            "emails": [],
            "phones": [],
            "pages_crawled": [],
            "total_pages": 0,
        }
    except Exception as e:
        return {
            "error": str(e),
            "emails": [],
            "phones": [],
            "pages_crawled": [],
            "total_pages": 0,
        }

    return {
        "emails": [],
        "phones": [],
        "pages_crawled": [],
        "total_pages": 0,
        "note": "No results from crawler",
    }
