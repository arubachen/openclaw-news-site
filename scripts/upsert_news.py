#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

TZ_SH = timezone(timedelta(hours=8))
DEFAULT_SITE_DATA = Path(__file__).resolve().parents[1] / 'data' / 'news.json'


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upsert news/intel records into the site data store")
    parser.add_argument("--input", help="Path to a JSON file containing one item or an array of items")
    parser.add_argument("--site-data", default=str(DEFAULT_SITE_DATA))
    parser.add_argument("--max-items", type=int, default=2000)
    return parser.parse_args()


def load_payload(args: argparse.Namespace) -> list[dict[str, Any]]:
    if args.input:
        raw = Path(args.input).read_text(encoding="utf-8")
    else:
        raw = sys.stdin.read()
    data = json.loads(raw)
    if isinstance(data, dict):
        if isinstance(data.get("items"), list):
            return [item for item in data["items"] if isinstance(item, dict)]
        return [data]
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    raise ValueError("Input must be a JSON object or array")


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def normalize_tags(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        parts = re.split(r"[\s,，]+", value)
        return [part.lstrip("#").strip() for part in parts if part.strip()]
    if isinstance(value, list):
        tags: list[str] = []
        for item in value:
            text = clean_text(item).lstrip("#")
            if text:
                tags.append(text)
        return list(dict.fromkeys(tags))
    return []


def normalize_facts(value: Any) -> list[dict[str, str]]:
    if value is None:
        return []
    if isinstance(value, dict):
        value = [{"label": k, "value": v} for k, v in value.items()]
    facts: list[dict[str, str]] = []
    if isinstance(value, list):
        for item in value:
            if not isinstance(item, dict):
                continue
            label = clean_text(item.get("label") or item.get("key") or item.get("name"))
            text = clean_text(item.get("value") or item.get("text") or item.get("content"))
            if label and text:
                facts.append({"label": label, "value": text})
    return facts


def parse_score(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    try:
        return round(float(value), 1)
    except Exception:
        return 0.0


def normalize_timestamp(value: Any, *, fallback_now: bool = True) -> str:
    text = clean_text(value)
    if not text:
        return datetime.now(TZ_SH).isoformat(timespec="seconds") if fallback_now else ""
    try:
        if text.endswith("Z"):
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        else:
            dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=TZ_SH)
        return dt.astimezone(TZ_SH).isoformat(timespec="seconds")
    except Exception:
        return text


def normalize_published_at(value: Any) -> str:
    return normalize_timestamp(value, fallback_now=True)


def normalize_ingested_at(value: Any, fallback: Any = None) -> str:
    text = clean_text(value)
    if text:
        return normalize_timestamp(text, fallback_now=True)
    fallback_text = clean_text(fallback)
    if fallback_text:
        return normalize_timestamp(fallback_text, fallback_now=True)
    return datetime.now(TZ_SH).isoformat(timespec="seconds")


def stable_id(item: dict[str, Any]) -> str:
    explicit = clean_text(item.get("id"))
    if explicit:
        return explicit
    base = "|".join([
        clean_text(item.get("channel")),
        clean_text(item.get("title")),
        clean_text(item.get("sourceUrl")),
        clean_text(item.get("publishedAt")),
    ])
    digest = hashlib.sha1(base.encode("utf-8")).hexdigest()[:16]
    date_prefix = clean_text(item.get("publishedAt"))[:10] or datetime.now(TZ_SH).strftime("%Y-%m-%d")
    return f"{date_prefix}-{digest}"


def slugify(text: str, fallback_id: str) -> str:
    base = clean_text(text).lower()
    base = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", base)
    base = re.sub(r"-+", "-", base).strip("-")
    if base:
        return base[:80]
    return f"item-{fallback_id[-12:]}"


def normalize_item(raw: dict[str, Any]) -> dict[str, Any]:
    item = {
        "channel": clean_text(raw.get("channel")),
        "title": clean_text(raw.get("title")),
        "score": parse_score(raw.get("score")),
        "publishedAt": normalize_published_at(raw.get("publishedAt")),
        "ingestedAt": normalize_ingested_at(
            raw.get("ingestedAt") or raw.get("sentAt") or raw.get("insertedAt")
        ),
        "summary": clean_text(raw.get("summary")),
        "facts": normalize_facts(raw.get("facts")),
        "judgment": clean_text(raw.get("judgment")),
        "tags": normalize_tags(raw.get("tags")),
        "sourceName": clean_text(raw.get("sourceName")),
        "sourceType": clean_text(raw.get("sourceType")) or "原文",
        "sourceUrl": clean_text(raw.get("sourceUrl")),
    }
    item["id"] = stable_id(item | {"id": raw.get("id")})
    item["slug"] = clean_text(raw.get("slug")) or slugify(item["title"], item["id"])
    if not item["channel"] or not item["title"] or not item["sourceUrl"]:
        raise ValueError(f"Missing required fields for item: {item}")
    return item


def parse_dt(value: str) -> datetime:
    try:
        if value.endswith("Z"):
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        dt = datetime.fromisoformat(value)
        return dt if dt.tzinfo else dt.replace(tzinfo=TZ_SH)
    except Exception:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)


def load_existing(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else []


def sort_dt(item: dict[str, Any]) -> datetime:
    return parse_dt(item.get("ingestedAt") or item.get("publishedAt") or "")



def upsert(existing: list[dict[str, Any]], incoming: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int, int]:
    by_key: dict[str, dict[str, Any]] = {}
    order: list[str] = []

    def keys_for(item: dict[str, Any]) -> list[str]:
        keys = [f"id:{item['id']}"]
        if item.get("sourceUrl"):
            keys.append(f"url:{item['sourceUrl']}")
        keys.append(f"title:{item['channel']}|{item['title']}")
        return keys

    for item in existing:
        primary = f"id:{item.get('id')}"
        order.append(primary)
        for key in keys_for(item):
            by_key[key] = item

    added = 0
    updated = 0
    for item in incoming:
        match = None
        for key in keys_for(item):
            match = by_key.get(key)
            if match is not None:
                break
        if match is None:
            added += 1
            primary = f"id:{item['id']}"
            order.append(primary)
            for key in keys_for(item):
                by_key[key] = item
        else:
            updated += 1
            merged = match | item
            merged["ingestedAt"] = clean_text(match.get("ingestedAt")) or clean_text(item.get("ingestedAt")) or normalize_ingested_at(None, merged.get("publishedAt"))
            for key in keys_for(merged):
                by_key[key] = merged

    deduped: dict[str, dict[str, Any]] = {}
    for key, item in by_key.items():
        deduped[f"id:{item['id']}"] = item

    result = sorted(deduped.values(), key=sort_dt, reverse=True)
    return result, added, updated


def main() -> None:
    args = parse_args()
    payload = [normalize_item(item) for item in load_payload(args)]
    data_path = Path(args.site_data)
    data_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = data_path.with_suffix(data_path.suffix + '.lock')

    with open(lock_path, 'w', encoding='utf-8') as lock_fp:
        fcntl.flock(lock_fp, fcntl.LOCK_EX)
        existing = load_existing(data_path)
        merged, added, updated = upsert(existing, payload)
        if args.max_items > 0:
            merged = merged[: args.max_items]
        tmp_path = data_path.with_suffix(data_path.suffix + '.tmp')
        tmp_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        os.replace(tmp_path, data_path)
        fcntl.flock(lock_fp, fcntl.LOCK_UN)

    print(json.dumps({
        'written': len(payload),
        'added': added,
        'updated': updated,
        'total': len(merged),
        'path': str(data_path),
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
