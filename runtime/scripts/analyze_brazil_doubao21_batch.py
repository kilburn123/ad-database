#!/usr/bin/env python3
"""Batch-analyze library ads with Doubao 2.1 and update the website.

The run is resumable: one validated JSON file is written per video before the
website PATCH request, and existing successful files/site analyses are skipped.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import random
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

from analyze_single_ad_doubao21 import (
    DEFAULT_ENDPOINT,
    DEFAULT_MODEL,
    DEFAULT_SITE,
    PROMPT,
    output_text,
    parse_model_json,
    request_json,
    validate_analysis,
)


BATCH_PROMPT = PROMPT + """

本次用于批量生成统一的蝉妈妈式详情页。请额外严格返回以下顶层字段：
"score_details": {
  "overall_dimensions": [
    {"label": "评分维度", "score": 0, "weight": 0, "evidence": "对应本视频的具体画面/声音证据"}
  ],
  "hook_dimensions": [
    {"label": "评分维度", "score": 0, "weight": 0, "evidence": "对应前3秒的具体证据"}
  ]
}

评分明细硬性规则：
1. overall_dimensions 与 hook_dimensions 各 5 项；每组 weight 合计必须为 100。
2. score 和 weight 都是 0-100 数字；总分按 Σ(score×weight/100) 计算。
3. overall_score 和 hook_score 必须分别等于对应加权总分四舍五入后的整数。
4. 评分只看内容结构和视频证据，禁止用播放量、点赞量、评论量倒推内容分。
5. 优点、缺点和优化建议必须针对本视频，禁止套用示例视频中的警察、耳机等内容。
"""

INPUT_PRICE_PER_MILLION = 6.0
CACHED_INPUT_PRICE_PER_MILLION = 1.2
OUTPUT_PRICE_PER_MILLION = 30.0
CLIP_PREWARM_WORKERS = 2
clip_prewarm_slots = threading.Semaphore(CLIP_PREWARM_WORKERS)


def timestamp_seconds(value: Any) -> float:
    """Convert storyboard timestamps such as 00:39.8 or 01:02 to seconds."""
    parts = [float(part) for part in str(value or "0").strip().split(":")]
    if not parts or len(parts) > 3:
        raise ValueError(f"invalid timestamp: {value}")
    seconds = parts[-1]
    if len(parts) >= 2:
        seconds += parts[-2] * 60
    if len(parts) == 3:
        seconds += parts[-3] * 3600
    return seconds


def prewarm_storyboard_clips(site: str, ad: dict[str, Any], analysis: dict[str, Any]) -> dict[str, Any]:
    """Render and persist every storyboard clip so playback never waits on FFmpeg.

    The website clip endpoint uploads generated clips to OSS. Keeping only two
    videos in this phase at once prevents FFmpeg from exhausting server memory.
    Clip failures are reported with the analysis result but do not discard an
    otherwise valid Doubao analysis.
    """
    video_id = str(ad.get("video_id") or ad.get("id") or "").strip()
    storyboard = analysis.get("storyboard") if isinstance(analysis.get("storyboard"), list) else []
    try:
        duration = float(ad.get("seconds") or 0)
    except (TypeError, ValueError):
        duration = 0
    if not video_id or not storyboard:
        return {"clips_ready": 0, "clips_failed": 0}

    ready = 0
    failures: list[str] = []
    with clip_prewarm_slots:
        for index, segment in enumerate(storyboard, 1):
            try:
                start = max(0.0, timestamp_seconds(segment.get("start")))
                end = timestamp_seconds(segment.get("end"))
                if duration > 0:
                    end = min(end, duration)
                if end <= start:
                    raise ValueError(f"invalid range {start}-{end}")
                query = urllib.parse.urlencode({"start": f"{start:.3f}", "end": f"{end:.3f}"})
                clip_url = f"{site}/api/ads/{urllib.parse.quote(video_id, safe='')}/clip?{query}"
                request = urllib.request.Request(
                    clip_url,
                    headers={"Range": "bytes=0-1023", "User-Agent": "doubao-storyboard-prewarm/1.0"},
                )
                with urllib.request.urlopen(request, timeout=300) as response:
                    body = response.read(1024)
                    if response.status not in (200, 206) or not str(response.headers.get("Content-Type") or "").startswith("video/mp4") or not body:
                        raise ValueError(f"unexpected clip response: HTTP {response.status}")
                ready += 1
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as exc:
                failures.append(f"SHOT {index}: {type(exc).__name__}: {exc}")
    return {"clips_ready": ready, "clips_failed": len(failures), "clip_errors": failures[:5]}


def usage_record(payload: dict[str, Any]) -> dict[str, Any]:
    usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
    details = usage.get("input_tokens_details") if isinstance(usage.get("input_tokens_details"), dict) else {}
    input_tokens = int(usage.get("input_tokens") or 0)
    output_tokens = int(usage.get("output_tokens") or 0)
    cached_tokens = min(input_tokens, int(details.get("cached_tokens") or 0))
    uncached_tokens = max(0, input_tokens - cached_tokens)
    cost = (
        uncached_tokens * INPUT_PRICE_PER_MILLION
        + cached_tokens * CACHED_INPUT_PRICE_PER_MILLION
        + output_tokens * OUTPUT_PRICE_PER_MILLION
    ) / 1_000_000
    return {
        "input_tokens": input_tokens,
        "cached_input_tokens": cached_tokens,
        "output_tokens": output_tokens,
        "total_tokens": int(usage.get("total_tokens") or input_tokens + output_tokens),
        "estimated_cost_cny": round(cost, 6),
    }


def summed_usage(records: list[dict[str, Any]]) -> dict[str, Any]:
    keys = ("input_tokens", "cached_input_tokens", "output_tokens", "total_tokens")
    result = {key: sum(int(item.get(key) or 0) for item in records) for key in keys}
    result["estimated_cost_cny"] = round(sum(float(item.get("estimated_cost_cny") or 0) for item in records), 6)
    result["model_calls"] = len(records)
    return result


class BilledAttemptError(ValueError):
    def __init__(self, message: str, usage: dict[str, Any]):
        super().__init__(message)
        self.usage = usage


def fetch_ads(site: str, category: Optional[str] = "巴西视频") -> list[dict[str, Any]]:
    ads: list[dict[str, Any]] = []
    page = 1
    while True:
        query_params: dict[str, Any] = {"page": page, "pageSize": 100, "sort": "quality"}
        if category:
            query_params["category"] = category
        query = urllib.parse.urlencode(query_params)
        payload = request_json(f"{site}/api/ads?{query}")
        rows = payload.get("ads") or []
        ads.extend(row for row in rows if not category or row.get("category") == category)
        if len(ads) >= int(payload.get("count") or 0) or not rows:
            break
        page += 1
    unique: dict[str, dict[str, Any]] = {}
    for ad in ads:
        unique[str(ad.get("video_id") or ad.get("id"))] = ad
    return list(unique.values())


def fetch_ads_by_ids(site: str, video_ids: list[str]) -> list[dict[str, Any]]:
    """Fetch only explicitly requested ads without scanning the full library."""
    ads: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw_video_id in video_ids:
        video_id = str(raw_video_id).strip()
        if not video_id or video_id in seen:
            continue
        seen.add(video_id)
        payload = request_json(f"{site}/api/ads/{urllib.parse.quote(video_id, safe='')}")
        ad = payload.get("ad") or {}
        if ad:
            ads.append(ad)
    return ads


def fetch_ads_by_video_urls(site: str, video_urls: list[str]) -> list[dict[str, Any]]:
    """Build analysis inputs from public URLs and attach known library metadata."""
    ads: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw_url in video_urls:
        video_url = str(raw_url).strip()
        if not video_url or video_url in seen:
            continue
        seen.add(video_url)
        matches = re.findall(r"(?<!\d)(\d{8,24})(?!\d)", urllib.parse.unquote(video_url))
        video_id = matches[-1] if matches else "url-" + hashlib.sha256(video_url.encode("utf-8")).hexdigest()[:16]
        ad: dict[str, Any] = {}
        if matches:
            try:
                ad = request_json(f"{site}/api/ads/{urllib.parse.quote(video_id, safe='')}").get("ad") or {}
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
                ad = {}
        if ad:
            ad = dict(ad)
            ad["videoUrl"] = video_url
            ad["_update_site"] = True
        else:
            ad = {
                "id": video_id,
                "video_id": video_id,
                "videoUrl": video_url,
                "title": "",
                "copywriting": "",
                "brand": "",
                "classificationTag": "",
                "seconds": None,
                "publishedAt": None,
                "_update_site": False,
            }
        ads.append(ad)
    return ads


def normalize_score_group(value: Any, name: str) -> tuple[list[dict[str, Any]], int]:
    if not isinstance(value, list) or len(value) != 5:
        raise ValueError(f"{name} must contain exactly 5 dimensions")
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(value, 1):
        if not isinstance(item, dict):
            raise ValueError(f"{name}[{index}] must be an object")
        label = str(item.get("label") or "").strip()
        evidence = str(item.get("evidence") or "").strip()
        score = float(item.get("score"))
        weight = float(item.get("weight"))
        if not label or not evidence or not 0 <= score <= 100 or not 0 < weight <= 100:
            raise ValueError(f"{name}[{index}] is invalid")
        normalized.append({"label": label, "score": round(score, 2), "weight": round(weight, 2), "evidence": evidence})
    weight_sum = sum(item["weight"] for item in normalized)
    if abs(weight_sum - 100) > 0.05:
        raise ValueError(f"{name} weights sum to {weight_sum}, expected 100")
    total = sum(item["score"] * item["weight"] / 100 for item in normalized)
    return normalized, round(total)


def normalize_analysis(analysis: dict[str, Any], video_id: str, model: str, elapsed: float) -> dict[str, Any]:
    validate_analysis(analysis)
    score_details = analysis.get("score_details")
    if not isinstance(score_details, dict):
        raise ValueError("analysis missing score_details")
    overall_dimensions, overall_score = normalize_score_group(score_details.get("overall_dimensions"), "overall_dimensions")
    hook_dimensions, hook_score = normalize_score_group(score_details.get("hook_dimensions"), "hook_dimensions")
    analysis["score_details"] = {"overall_dimensions": overall_dimensions, "hook_dimensions": hook_dimensions}
    analysis["executive_summary"]["overall_score"] = overall_score
    analysis["hook_analysis"]["hook_score"] = hook_score
    analysis["analysis_version"] = "doubao_2_1_chanmama_storyboard_v3"
    analysis["source"] = f"{model}-video-analysis"
    analysis["ad_id"] = video_id
    analysis["video_id"] = video_id
    analysis["model"] = model
    analysis["analyzed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    analysis["analysis_seconds"] = round(elapsed, 2)
    return analysis


SECTION_ORDER = [
    "basic_information",
    "analysis_overview",
    "first_three_seconds",
    "flow_structure",
    "smart_storyboard",
    "marketing_formula",
    "comprehensive_evaluation",
]


def first_text(value: Any, fallback: str = "") -> str:
    if isinstance(value, list):
        for item in value:
            text = str(item or "").strip()
            if text:
                return text
        return fallback
    text = str(value or "").strip()
    return text or fallback


def build_basic_information(ad: dict[str, Any], analysis: dict[str, Any]) -> dict[str, Any]:
    """Combine persisted ad metadata with model-recognized classification."""
    content_tags = analysis.get("content_tags") if isinstance(analysis.get("content_tags"), dict) else {}
    raw_context = ad.get("rawContext") if isinstance(ad.get("rawContext"), dict) else {}
    auto_classification = raw_context.get("auto_classification") if isinstance(raw_context.get("auto_classification"), dict) else {}
    product = first_text(
        ad.get("productTags"),
        first_text(auto_classification.get("productTags"), first_text(content_tags.get("product"), first_text(ad.get("category"), "未确认"))),
    )
    video_type = first_text(ad.get("classificationTag"), first_text(content_tags.get("format"), "未确认"))
    play_count = ad.get("playCount") if ad.get("playCount") is not None else ad.get("play")
    like_count = ad.get("likeCount")
    comment_count = ad.get("commentCount")
    share_count = ad.get("shareCount") if ad.get("shareCount") is not None else ad.get("share")
    engagement_rate = ad.get("engagement")
    return {
        "metrics": {
            "play_count": play_count,
            "like_count": like_count,
            "comment_count": comment_count,
            "share_count": share_count,
            "engagement_rate": engagement_rate,
        },
        "ad_id": str(ad.get("video_id") or ad.get("id") or analysis.get("video_id") or analysis.get("ad_id") or ""),
        "video_type": video_type,
        "category": first_text(ad.get("category"), first_text(content_tags.get("category"), "未确认")),
        "product": product,
        "platform": first_text(ad.get("platform"), first_text(content_tags.get("platform"), "TikTok")),
        "author_brand": first_text(ad.get("brand"), first_text(content_tags.get("brand"), "未确认")),
        "published_at": ad.get("publishedAt"),
        "duration_seconds": ad.get("seconds") if ad.get("seconds") is not None else ad.get("duration"),
        "search_keyword": ad.get("searchKeyword"),
        "download_source": ad.get("downloadSource"),
        "imported_at": ad.get("uploadedAt"),
        "copywriting": first_text(ad.get("copywriting"), first_text(ad.get("title"))),
        "source_url": ad.get("sourceUrl"),
        "video_url": ad.get("videoUrl"),
    }


def build_page_sections(ad: dict[str, Any], analysis: dict[str, Any]) -> dict[str, Any]:
    """Return the exact seven logical sections rendered by the Doubao page."""
    storyboard = analysis.get("storyboard") if isinstance(analysis.get("storyboard"), list) else []
    executive_summary = analysis.get("executive_summary") if isinstance(analysis.get("executive_summary"), dict) else {}
    content_tags = analysis.get("content_tags") if isinstance(analysis.get("content_tags"), dict) else {}
    hook_analysis = analysis.get("hook_analysis") if isinstance(analysis.get("hook_analysis"), dict) else {}
    objective_recognition = analysis.get("objective_recognition") if isinstance(analysis.get("objective_recognition"), dict) else {}
    marketing_analysis = analysis.get("marketing_analysis") if isinstance(analysis.get("marketing_analysis"), dict) else {}
    optimization_plan = analysis.get("optimization_plan") if isinstance(analysis.get("optimization_plan"), dict) else {}
    score_details = analysis.get("score_details") if isinstance(analysis.get("score_details"), dict) else {}
    return {
        "basic_information": build_basic_information(ad, analysis),
        "analysis_overview": {
            "executive_summary": executive_summary,
            "content_tags": content_tags,
            "objective_recognition": objective_recognition,
            "score_details": score_details,
        },
        "first_three_seconds": hook_analysis,
        "flow_structure": {
            "narrative_arc": marketing_analysis.get("narrative_arc"),
            "persuasion_logic": marketing_analysis.get("persuasion_logic"),
            "segments": storyboard,
        },
        "smart_storyboard": {
            "segment_count": len(storyboard),
            "segments": storyboard,
        },
        "marketing_formula": marketing_analysis,
        "comprehensive_evaluation": {
            "executive_summary": executive_summary,
            "strengths": hook_analysis.get("strengths") or [],
            "weaknesses": hook_analysis.get("weaknesses") or [],
            "optimization_plan": optimization_plan,
            "score_details": score_details,
        },
    }


def build_result_envelope(ad: dict[str, Any], analysis: dict[str, Any], status: str) -> dict[str, Any]:
    sections = build_page_sections(ad, analysis)
    return {
        "schema_version": "doubao_complete_page_v1",
        "video_id": str(ad.get("video_id") or ad.get("id") or analysis.get("video_id") or analysis.get("ad_id") or ""),
        "status": status,
        "section_order": SECTION_ORDER,
        "sections": sections,
        "analysis": analysis,
    }


def doubao_request(ad: dict[str, Any], api_key: str, endpoint: str, model: str) -> tuple[dict[str, Any], dict[str, Any]]:
    video_id = str(ad.get("video_id") or ad.get("id"))
    video_url = str(ad.get("videoUrl") or "")
    if not video_url:
        raise ValueError("missing public videoUrl")
    metadata = {
        "video_id": video_id,
        "title": ad.get("title"),
        "copywriting": ad.get("copywriting"),
        "author": ad.get("brand"),
        "classification": ad.get("classificationTag"),
        "duration_seconds": ad.get("seconds"),
        "published_at": ad.get("publishedAt"),
    }
    content: list[dict[str, Any]] = [
        {"type": "input_video", "video_url": video_url},
        {"type": "input_text", "text": BATCH_PROMPT + "\n网站元数据仅用于辅助识别：\n" + json.dumps(metadata, ensure_ascii=False)},
    ]
    for key in ("hookImageUrl", "fullImageUrl", "coverImageUrl"):
        if ad.get(key):
            content.append({"type": "input_image", "image_url": ad[key]})
    body = {"model": model, "input": [{"role": "user", "content": content}], "thinking": {"type": "disabled"}}
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "User-Agent": "Brazil-Doubao21-batch/1.0"},
    )
    started = time.monotonic()
    with urllib.request.urlopen(request, timeout=1200) as response:
        payload = json.load(response)
    billed = usage_record(payload)
    try:
        analysis = normalize_analysis(parse_model_json(output_text(payload)), video_id, model, time.monotonic() - started)
    except (ValueError, json.JSONDecodeError) as exc:
        raise BilledAttemptError(str(exc), billed) from exc
    analysis["model_usage"] = billed
    return analysis, billed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", default=DEFAULT_SITE)
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--output", type=Path, default=Path("runs/brazil-doubao21-chanmama-20260803"))
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--category", default="巴西视频", help="Only analyze this category (default: 巴西视频)")
    parser.add_argument("--all-ads", action="store_true", help="Analyze the complete ad library, ignoring --category")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--ids", nargs="*")
    parser.add_argument("--video-urls", nargs="*")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--no-update-site", action="store_true")
    args = parser.parse_args()

    api_key = os.environ.get("ARK_API_KEY", "")
    if not api_key or not api_key.isascii():
        raise SystemExit("Set a valid ASCII ARK_API_KEY in the process environment")
    site = args.site.rstrip("/")
    output_dir = args.output.resolve()
    analyses_dir = output_dir / "analyses"
    results_dir = output_dir / "results"
    analyses_dir.mkdir(parents=True, exist_ok=True)
    results_dir.mkdir(parents=True, exist_ok=True)
    category = None if args.all_ads else args.category
    if args.video_urls:
        ads = fetch_ads_by_video_urls(site, args.video_urls)
    elif args.ids:
        ads = fetch_ads_by_ids(site, args.ids)
    else:
        ads = fetch_ads(site, category)
    if args.limit:
        ads = ads[: args.limit]

    manifest = {"started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "site": site, "model": args.model, "scope": "all" if category is None else category, "count": len(ads), "video_ids": [str(ad.get("video_id") or ad.get("id")) for ad in ads]}
    (output_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    write_lock = threading.Lock()
    status_path = output_dir / "status.jsonl"

    def record_status(row: dict[str, Any]) -> None:
        with write_lock:
            with status_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
            print(json.dumps(row, ensure_ascii=False), flush=True)

    def process(ad: dict[str, Any]) -> dict[str, Any]:
        video_id = str(ad.get("video_id") or ad.get("id"))
        update_site = bool(ad.get("_update_site", True))
        output_path = analyses_dir / f"{video_id}.json"
        result_path = results_dir / f"{video_id}.json"

        def save_result(analysis: dict[str, Any], status: str) -> None:
            result_path.write_text(
                json.dumps(build_result_envelope(ad, analysis, status), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

        if output_path.exists() and not args.force:
            analysis = json.loads(output_path.read_text(encoding="utf-8"))
            normalize_analysis(analysis, video_id, args.model, float(analysis.get("analysis_seconds") or 0))
            if not args.no_update_site and update_site:
                request_json(f"{site}/api/ads/{video_id}", method="PATCH", body={"analysis": analysis})
            clip_status = prewarm_storyboard_clips(site, ad, analysis) if update_site and not args.no_update_site else {"clips_ready": 0, "clips_failed": 0}
            save_result(analysis, "resumed")
            return {"video_id": video_id, "status": "resumed", "segments": len(analysis["storyboard"]), "result_path": str(result_path), **clip_status}

        if not args.force and update_site:
            current = (request_json(f"{site}/api/ads/{video_id}").get("ad") or {}).get("analysis") or {}
            if current.get("analysis_version") == "doubao_2_1_chanmama_storyboard_v3" and current.get("score_details"):
                output_path.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
                clip_status = prewarm_storyboard_clips(site, ad, current) if not args.no_update_site else {"clips_ready": 0, "clips_failed": 0}
                save_result(current, "already_on_site")
                return {"video_id": video_id, "status": "already_on_site", "segments": len(current.get("storyboard") or []), "result_path": str(result_path), **clip_status}

        last_error = ""
        billed_attempts: list[dict[str, Any]] = []
        for attempt in range(1, 5):
            try:
                analysis, billed = doubao_request(ad, api_key, args.endpoint, args.model)
                billed_attempts.append(billed)
                output_path.write_text(json.dumps(analysis, ensure_ascii=False, indent=2), encoding="utf-8")
                if not args.no_update_site and update_site:
                    updated = request_json(f"{site}/api/ads/{video_id}", method="PATCH", body={"analysis": analysis})
                    returned = (updated.get("ad") or {}).get("analysis") or {}
                    if returned.get("analysis_version") != analysis["analysis_version"]:
                        raise ValueError("site returned unexpected analysis version")
                clip_status = prewarm_storyboard_clips(site, ad, analysis) if update_site and not args.no_update_site else {"clips_ready": 0, "clips_failed": 0}
                save_result(analysis, "completed")
                totals = summed_usage(billed_attempts)
                return {
                    "video_id": video_id,
                    "video_url": str(ad.get("videoUrl") or ""),
                    "updated_site": update_site and not args.no_update_site,
                    "status": "completed",
                    "segments": len(analysis["storyboard"]),
                    "result_path": str(result_path),
                    "seconds": analysis["analysis_seconds"],
                    **clip_status,
                    **totals,
                }
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
                if isinstance(exc, BilledAttemptError):
                    billed_attempts.append(exc.usage)
                if isinstance(exc, urllib.error.HTTPError):
                    detail = exc.read().decode("utf-8", errors="replace")[-1200:]
                    last_error = f"HTTP {exc.code}: {detail or exc.reason}"
                    retryable = exc.code == 429 or exc.code >= 500
                else:
                    last_error = f"{type(exc).__name__}: {exc}"
                    retryable = True
                if attempt == 4 or not retryable:
                    break
                time.sleep(min(90, 5 * (2 ** (attempt - 1))) + random.random() * 2)
        return {"video_id": video_id, "status": "failed", "error": last_error, **summed_usage(billed_attempts)}

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = [pool.submit(process, ad) for ad in ads]
        for future in concurrent.futures.as_completed(futures):
            try:
                record_status(future.result())
            except Exception as exc:  # protects the remaining queue from an unexpected worker bug
                record_status({"video_id": "unknown", "status": "failed", "error": f"{type(exc).__name__}: {exc}"})

    final_rows = [json.loads(line) for line in status_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    latest = {row.get("video_id"): row for row in final_rows}
    summary = {
        "count": len(ads),
        "completed": sum(row.get("status") in {"completed", "resumed", "already_on_site"} for row in latest.values()),
        "failed": sum(row.get("status") == "failed" for row in latest.values()),
        "input_tokens": sum(int(row.get("input_tokens") or 0) for row in latest.values()),
        "cached_input_tokens": sum(int(row.get("cached_input_tokens") or 0) for row in latest.values()),
        "output_tokens": sum(int(row.get("output_tokens") or 0) for row in latest.values()),
        "total_tokens": sum(int(row.get("total_tokens") or 0) for row in latest.values()),
        "model_calls": sum(int(row.get("model_calls") or 0) for row in latest.values()),
        "estimated_cost_cny": round(sum(float(row.get("estimated_cost_cny") or 0) for row in latest.values()), 4),
        "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
