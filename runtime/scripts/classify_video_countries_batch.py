#!/usr/bin/env python3
"""Parallel, resumable target-market country classification for the ad library."""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

COUNTRY_NAMES = {
    "BR": "巴西", "MX": "墨西哥", "US": "美国", "GB": "英国", "PH": "菲律宾",
    "ID": "印度尼西亚", "TH": "泰国", "VN": "越南", "MY": "马来西亚", "SG": "新加坡",
    "CA": "加拿大", "AU": "澳大利亚", "ES": "西班牙", "PT": "葡萄牙", "FR": "法国",
    "DE": "德国", "IT": "意大利", "KR": "韩国", "JP": "日本", "IN": "印度",
    "AE": "阿联酋", "SA": "沙特阿拉伯", "TR": "土耳其", "ZA": "南非", "NG": "尼日利亚",
    "NL": "荷兰", "BE": "比利时", "PL": "波兰", "RU": "俄罗斯", "AR": "阿根廷",
    "CO": "哥伦比亚", "CL": "智利", "PE": "秘鲁", "TW": "中国台湾", "HK": "中国香港",
}
SPECIAL = {"巴西视频": "BR", "墨西哥视频": "MX"}
MARKET_ALIASES = {
    "brazil": "BR", "brasil": "BR", "巴西": "BR", "br": "BR",
    "mexico": "MX", "méxico": "MX", "墨西哥": "MX", "mx": "MX",
}
STRONG_PATTERNS = {
    "BR": [r"\bbrasil\b", r"\bbrazil(?:ian)?\b", r"\bpt[-_ ]?br\b", r"\br\$\s?\d", r"\.com\.br\b"],
    "MX": [r"\bm[eé]xico\b", r"\bmexican[oa]?\b", r"\bes[-_ ]?mx\b", r"\bmxn\b", r"\bcdmx\b", r"\.com\.mx\b"],
    "US": [r"\bunited states\b", r"\bu\.s\.a?\.?\b", r"\btiktok shop us\b", r"\bus-only\b"],
    "GB": [r"\bunited kingdom\b", r"\buk-only\b", r"\b£\s?\d", r"\.co\.uk\b"],
    "PH": [r"\bphilippines\b", r"\bpinoy\b", r"\btagalog\b", r"\bphp\s?\d", r"₱\s?\d"],
    "ID": [r"\bindonesia\b", r"\bbahasa indonesia\b", r"\brp\s?\d"],
    "TH": [r"\bthailand\b", r"ประเทศไทย", r"\bthb\b", r"฿\s?\d"],
    "VN": [r"\bvietnam\b", r"việt nam", r"\bvnd\b", r"₫"],
    "MY": [r"\bmalaysia\b", r"\bmyr\b", r"\brm\s?\d"],
    "SG": [r"\bsingapore\b", r"\bsgd\b", r"\bs\$\s?\d"],
    "CA": [r"\bcanada\b", r"\bcad\b", r"\.ca\b"],
    "AU": [r"\baustralia\b", r"\baud\b", r"\.com\.au\b"],
    "AE": [r"\bunited arab emirates\b", r"\bdubai\b", r"\baed\b"],
    "SA": [r"\bsaudi arabia\b", r"\bsar\b", r"السعودية"],
    "IN": [r"\bindia\b", r"\bindian rupees?\b", r"₹\s?\d"],
}

write_lock = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def request_json(
    url: str,
    method: str = "GET",
    payload: Any = None,
    headers: dict[str, str] | None = None,
    timeout: int = 120,
    attempts: int = 3,
) -> Any:
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    final_headers = {"Accept": "application/json", **(headers or {})}
    if body is not None:
        final_headers["Content-Type"] = "application/json"
    for attempt in range(1, max(1, attempts) + 1):
        request = urllib.request.Request(url, data=body, headers=final_headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            retryable = error.code == 429 or 500 <= error.code < 600
            if not retryable or attempt >= attempts:
                raise
            retry_after = error.headers.get("Retry-After") if error.headers else None
            delay = float(retry_after) if retry_after and retry_after.isdigit() else min(8.0, 1.5 * (2 ** (attempt - 1)))
        except (urllib.error.URLError, TimeoutError):
            if attempt >= attempts:
                raise
            delay = min(8.0, 1.5 * (2 ** (attempt - 1)))
        time.sleep(delay)
    raise RuntimeError("request failed without an error")


def compact(value: Any, limit: int) -> str:
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":")) if isinstance(value, (dict, list)) else str(value or "")
    return text[:limit]


def rule_result(ad: dict[str, Any]) -> dict[str, Any] | None:
    category = str(ad.get("category") or "").strip()
    if category in SPECIAL:
        code = SPECIAL[category]
        return build_result(ad, code, 1.0, "special_collection", [f"专题库：{category}"])
    text = " ".join(str(ad.get(key) or "") for key in ("title", "copywriting", "searchKeyword", "brand", "tags")).lower()
    hits: dict[str, list[str]] = {}
    for code, patterns in STRONG_PATTERNS.items():
        matched = [pattern for pattern in patterns if re.search(pattern, text, re.IGNORECASE)]
        if matched:
            hits[code] = matched
    market_code = MARKET_ALIASES.get(str(ad.get("market") or "").strip().lower())
    if len(hits) == 1:
        code, evidence = next(iter(hits.items()))
        confidence = 0.91 if market_code == code else 0.87
        source = "metadata_rules" if not market_code else "crawl_task+metadata_rules"
        return build_result(ad, code, confidence, source, [f"强地区信号：{item}" for item in evidence])
    if market_code and not hits:
        return build_result(ad, market_code, 0.72, "crawl_task", [f"历史抓取市场：{ad.get('market')}"] , "review")
    return None


def build_result(ad: dict[str, Any], code: str, confidence: float, source: str, evidence: list[str], status: str | None = None, model: str = "") -> dict[str, Any]:
    code = code if code in COUNTRY_NAMES else "UNKNOWN"
    confidence = max(0.0, min(1.0, float(confidence or 0)))
    if status is None:
        status = "confirmed" if code != "UNKNOWN" and confidence >= 0.85 else "review" if code != "UNKNOWN" and confidence >= 0.60 else "unknown"
    return {
        "id": str(ad.get("id") or ad.get("video_id") or ""),
        "countryCode": code,
        "countryName": COUNTRY_NAMES.get(code, "未知"),
        "countryConfidence": round(confidence, 4),
        "countrySource": source,
        "countryStatus": status,
        "countryEvidence": [str(item)[:240] for item in evidence[:8]],
        "countryModel": model,
        "countryAnalyzedAt": now_iso(),
    }


def extract_output_text(response: dict[str, Any]) -> str:
    chunks: list[str] = []
    if isinstance(response.get("output_text"), str) and response["output_text"].strip():
        chunks.append(response["output_text"])
    for output in response.get("output") or []:
        if output.get("type") != "message":
            continue
        for item in output.get("content") or []:
            if item.get("type") in {"output_text", "text"} and item.get("text"):
                chunks.append(str(item["text"]))
    return "\n".join(chunks)


def parse_json_object(text: str) -> dict[str, Any]:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.IGNORECASE)
    try:
        value = json.loads(cleaned)
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if not match:
            return {}
        value = json.loads(match.group(0))
        return value if isinstance(value, dict) else {}


def ffmpeg_frame_sheet(ad: dict[str, Any], frame_count: int = 8) -> tuple[str, int, str]:
    video_url = str(ad.get("videoUrl") or "").strip()
    if not video_url:
        return "", 0, "视频地址为空"
    try:
        duration = float(ad.get("seconds") or 0)
    except (TypeError, ValueError):
        duration = 0
    if duration <= 0:
        return "", 0, "视频时长无效"
    count = max(4, min(12, int(frame_count or 8)))
    columns = 4
    rows = (count + columns - 1) // columns
    fps = max(0.05, min(4.0, count / max(1.0, duration)))
    vf = (
        f"fps={fps:.8f},scale='min(420,iw)':-2,"
        f"tile={columns}x{rows}:nb_frames={count}:padding=4:margin=4:color=white"
    )
    try:
        with tempfile.NamedTemporaryFile(prefix="country-video-", suffix=".mp4") as source_file:
            download = urllib.request.Request(video_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(download, timeout=240) as response:
                declared = int(response.headers.get("Content-Length") or 0)
                if declared > 300 * 1024 * 1024:
                    return "", 0, "视频超过300MB抽帧限制"
                downloaded = 0
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    downloaded += len(chunk)
                    if downloaded > 300 * 1024 * 1024:
                        return "", 0, "视频超过300MB抽帧限制"
                    source_file.write(chunk)
            source_file.flush()
            command = [
                os.environ.get("FFMPEG_PATH", "ffmpeg"),
                "-hide_banner", "-loglevel", "error", "-i", source_file.name,
                "-vf", vf, "-frames:v", "1", "-q:v", "4",
                "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
            ]
            completed = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=240)
            image = completed.stdout
            if not image:
                return "", 0, "FFmpeg未生成代表帧"
            if len(image) > 7 * 1024 * 1024:
                return "", 0, "代表帧拼图超过7MB"
            return f"data:image/jpeg;base64,{base64.b64encode(image).decode('ascii')}", count, ""
    except (OSError, subprocess.SubprocessError) as error:
        return "", 0, f"FFmpeg抽帧失败：{str(error)[:180]}"


def ai_result(ad: dict[str, Any], model: str, api_key: str, candidate: dict[str, Any] | None, frame_count: int = 8) -> dict[str, Any]:
    analysis = ad.get("analysis") if isinstance(ad.get("analysis"), dict) else {}
    frame_sheet, extracted_frames, frame_error = ffmpeg_frame_sheet(ad, frame_count)
    metadata = {
        "id": ad.get("id"), "title": ad.get("title"), "caption": ad.get("copywriting"),
        "author": ad.get("brand"), "market_legacy": ad.get("market"), "search_keyword": ad.get("searchKeyword"),
        "tags": ad.get("tags"), "existing_analysis": compact(analysis, 9000),
        "rule_candidate": candidate, "ffmpeg_frames": extracted_frames, "frame_error": frame_error,
    }
    prompt = f"""判定这条 TikTok 营销视频主要面向的目标市场国家。不是作者族裔、人物长相或产品产地。
不得因为 Korean skincare 判韩国，不得因为爬虫代理地区判国家；仅语言不足以区分墨西哥与其他西语国家。
综合口播/字幕语言变体、货币、电话区号、域名、门店、物流、明确国家名和既有分析证据。证据不足必须 UNKNOWN。
如果提供了图片，它是 FFmpeg 按时间均匀抽取、按从左到右再从上到下排列的代表帧拼图。重点读取画面字幕、货币、网址、电话、门店和配送文字，不得根据人物外貌判断国家。
只输出 JSON：{{"country_code":"ISO两字母或UNKNOWN","confidence":0到1,"evidence":["证据"],"reason":"一句话"}}。
元数据：{json.dumps(metadata, ensure_ascii=False)}"""
    content: list[dict[str, str]] = []
    if frame_sheet:
        content.append({"type": "input_image", "image_url": frame_sheet})
    elif not analysis and ad.get("videoUrl"):
        content.append({"type": "input_video", "video_url": str(ad["videoUrl"])})
    content.append({"type": "input_text", "text": prompt})
    payload = {
        "model": model,
        "input": [{"role": "user", "content": content}],
        "thinking": {"type": "disabled"},
        "max_output_tokens": 600,
    }
    endpoint = os.environ.get("ARK_RESPONSES_URL", "https://ark.cn-beijing.volces.com/api/v3/responses")
    response = request_json(endpoint, "POST", payload, {"Authorization": f"Bearer {api_key}"}, timeout=600)
    output_text = extract_output_text(response)
    if os.environ.get("COUNTRY_DEBUG_RESPONSE") == "1":
        shape = {
            "keys": sorted(response.keys()),
            "status": response.get("status"),
            "incomplete_details": response.get("incomplete_details"),
            "usage": response.get("usage"),
            "output": [
                {
                    "type": item.get("type"),
                    "content_types": [part.get("type") for part in item.get("content") or [] if isinstance(part, dict)],
                }
                for item in response.get("output") or [] if isinstance(item, dict)
            ],
            "extracted_text": output_text[:1600],
        }
        print("COUNTRY_RESPONSE_DEBUG " + json.dumps(shape, ensure_ascii=False), file=sys.stderr, flush=True)
    parsed = parse_json_object(output_text)
    code = str(parsed.get("country_code") or "UNKNOWN").strip().upper()
    confidence = float(parsed.get("confidence") or 0)
    evidence = parsed.get("evidence") if isinstance(parsed.get("evidence"), list) else []
    if parsed.get("reason"):
        evidence.append(str(parsed["reason"]))
    if code not in COUNTRY_NAMES:
        code, confidence = "UNKNOWN", 0
    language_only = evidence and all(re.search(r"语言|口播|字幕|english|spanish|portuguese|葡萄牙语|西班牙语|英语", str(item), re.I) for item in evidence)
    if language_only:
        confidence = min(confidence, 0.78)
    source = "ai_ffmpeg_frames+existing_analysis" if frame_sheet and analysis else "ai_ffmpeg_frames" if frame_sheet else "ai_multimodal" if not analysis else "ai_existing_analysis"
    return build_result(ad, code, confidence, source, evidence, model=model)


def append_jsonl(path: Path, row: dict[str, Any]) -> None:
    with write_lock, path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def classify_one(ad: dict[str, Any], args: argparse.Namespace, api_key: str, status_path: Path, results_path: Path) -> dict[str, Any]:
    ad_id = str(ad.get("id") or "")
    try:
        existing_status = str(ad.get("countryStatus") or "")
        if existing_status in {"manual", "confirmed"} and ad.get("countryCode") and not args.force and ad.get("category") not in SPECIAL:
            result = build_result(ad, str(ad.get("countryCode")), float(ad.get("countryConfidence") or 1), str(ad.get("countrySource") or "existing"), list(ad.get("countryEvidence") or []), existing_status, str(ad.get("countryModel") or ""))
        else:
            detail = request_json(f"{args.site}/api/ads/{urllib.parse.quote(ad_id)}", timeout=120).get("ad") or ad
            candidate = rule_result(detail)
            result = candidate if candidate and candidate["countryConfidence"] >= 0.85 else ai_result(detail, args.model, api_key, candidate, args.frame_count)
        append_jsonl(results_path, result)
        if not args.dry_run:
            request_json(
                f"{args.site}/api/country-analysis/result", "POST", result,
                {"X-Country-Job-Token": args.job_token}, timeout=120,
            )
        status = {"id": ad_id, "status": "completed", "country_code": result["countryCode"], "confidence": result["countryConfidence"]}
        append_jsonl(status_path, status)
        return status
    except Exception as error:
        status = {"id": ad_id, "status": "failed", "error": str(error)[:500]}
        append_jsonl(status_path, status)
        return status


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--model", default="doubao-seed-2-1-pro-260628")
    parser.add_argument("--job-token", required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--frame-count", type=int, default=8)
    parser.add_argument("--unresolved-only", action="store_true")
    args = parser.parse_args()
    args.site = args.site.rstrip("/")
    args.output.mkdir(parents=True, exist_ok=True)
    api_key = os.environ.get("ARK_API_KEY", "")
    if not api_key:
        raise SystemExit("ARK_API_KEY is required")
    payload = request_json(f"{args.site}/api/ads?page=1&pageSize=5000&sort=recent", timeout=180)
    ads = list(payload.get("ads") or [])
    if args.unresolved_only:
        ads = [
            ad for ad in ads
            if str(ad.get("countryStatus") or "") not in {"manual", "confirmed"}
            or not ad.get("countryCode")
        ]
    if args.limit > 0:
        ads = ads[: args.limit]
    (args.output / "manifest.json").write_text(json.dumps({"count": len(ads), "dry_run": args.dry_run, "started_at": now_iso()}, ensure_ascii=False, indent=2), encoding="utf-8")
    status_path = args.output / "status.jsonl"
    results_path = args.output / "results.jsonl"
    workers = max(1, min(8, args.workers))
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(classify_one, ad, args, api_key, status_path, results_path) for ad in ads]
        rows = [future.result() for future in concurrent.futures.as_completed(futures)]
    summary = {
        "count": len(rows),
        "completed": sum(row["status"] == "completed" for row in rows),
        "failed": sum(row["status"] == "failed" for row in rows),
        "finished_at": now_iso(),
    }
    (args.output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
