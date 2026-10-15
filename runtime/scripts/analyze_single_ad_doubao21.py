#!/usr/bin/env python3
"""Analyze one website ad with Doubao 2.1 and optionally update only that ad."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path


DEFAULT_SITE = "http://8.217.134.141/tiktok-ad-assistant"
DEFAULT_MODEL = "doubao-seed-2-1-pro-260628"
DEFAULT_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/responses"


PROMPT = """你是一名资深短视频广告导演、素材策略师和逐镜拉片分析师。
请完整观看输入视频，并参考附带的封面/抽帧图，对这条 TikTok 商品广告做可复核、可用于页面展示的深度分析。

硬性要求：
1. 只写视频中真实看见或听见的内容；不确定就写“未确认”，禁止用通用广告话术补齐事实。
2. 覆盖完整视频，从 00:00 到结尾。storyboard 按真实内容变化切分：短视频允许 3–8 段，信息丰富或较长视频可拆 8–18 段；禁止为凑数量制造没有内容变化的微小片段。
3. 每段都给出起止时间、客观画面、可辨识字幕/口播、人物动作、产品动作、景别/运镜、结构作用、卖点、证据、继续观看理由和可复用公式。
4. 前 3 秒分析必须引用具体画面/声音证据，并分别判断首帧、0-1 秒、1-3 秒和产品首次出现。
5. 分开“客观识别”和“策略判断”。不要把推测写成客观事实。
6. 给出保留项、问题项、可执行修改方案和一版 30-40 秒重剪结构；建议要对应原视频的具体时间段。
7. 所有自然语言使用简体中文。只返回 JSON 对象，不要 Markdown 代码块。

严格使用以下 JSON 结构：
{
  "analysis_version": "doubao_2_1_chanmama_storyboard_v3",
  "source": "doubao-seed-2-1-pro-260628-video-analysis",
  "executive_summary": {
    "one_line_verdict": "一句话判断",
    "core_marketing_logic": "核心营销逻辑",
    "content_type": "内容类型",
    "primary_audience": ["目标人群"],
    "strongest_moment": {"time": "00:00-00:00", "reason": "原因"},
    "biggest_problem": {"time": "00:00-00:00", "reason": "原因"},
    "overall_score": 0
  },
  "content_tags": {
    "platform": "TikTok",
    "category": "品类",
    "product": "产品",
    "brand": "品牌或未确认",
    "format": "视频形式",
    "scenes": ["场景"],
    "hook_types": ["钩子类型"],
    "selling_points": ["卖点"],
    "funnel_stages": ["漏斗阶段"]
  },
  "hook_analysis": {
    "hook_summary": "钩子总结",
    "hook_score": 0,
    "first_frame": {"objective_evidence": "证据", "strategy_judgment": "判断"},
    "zero_to_one_second": {"objective_evidence": "证据", "attention_mechanism": "机制"},
    "one_to_three_seconds": {"objective_evidence": "证据", "attention_mechanism": "机制"},
    "product_first_appearance": {"time": "00:00", "appearance_method": "方式", "clarity": "清晰度"},
    "strengths": ["优点"],
    "weaknesses": ["问题"],
    "optimization": ["优化动作"]
  },
  "storyboard": [
    {
      "start": "00:00",
      "end": "00:03",
      "segment_name": "段落名",
      "objective_visual": "客观画面",
      "spoken_or_subtitle": "可辨识的原话；未确认则写未确认",
      "human_action": "人物动作",
      "product_action": "产品如何出现/被使用",
      "shot_and_editing": "景别、机位、运镜、转场或剪辑",
      "structure_role": "钩子/痛点/演示/证明/反转/CTA等",
      "selling_point": "本段传递的卖点，没有则写无",
      "attention_mechanism": "注意力机制",
      "evidence": ["本段可核对证据"],
      "why_keep_watching": "继续观看理由",
      "reusable_formula": "可复用公式",
      "improvement": "具体优化建议"
    }
  ],
  "objective_recognition": {
    "people": ["人物"],
    "products": ["产品及可见细节"],
    "scenes": ["场景"],
    "language_and_audio": "语言、口播、音乐、音效",
    "visual_style": "视觉风格",
    "editing_style": "剪辑风格",
    "unconfirmed_items": ["无法确认内容"]
  },
  "marketing_analysis": {
    "pain_points": ["痛点"],
    "selling_points": ["卖点"],
    "proof_elements": ["证明元素"],
    "objections_handled": ["已处理顾虑"],
    "objections_missing": ["未处理顾虑"],
    "cta": "行动号召",
    "narrative_arc": "叙事弧",
    "persuasion_logic": "说服逻辑",
    "credibility": "可信度判断",
    "visual_craft": "视觉制作判断",
    "language_expression": "语言表达判断"
  },
  "optimization_plan": {
    "keep": [{"time": "00:00-00:00", "reason": "保留原因"}],
    "improve": [{"time": "00:00-00:00", "problem": "问题", "action": "修改动作"}],
    "recommended_duration": "建议时长",
    "recut_structure": [
      {"time": "00:00-00:03", "purpose": "作用", "content": "建议内容"}
    ],
    "ab_test_ideas": ["A/B 测试方案"]
  }
}

评分均使用 0-100 的整数。storyboard 必须覆盖到视频结尾且时间连续或合理衔接。
"""


def request_json(url: str, *, method: str = "GET", body: dict | None = None) -> dict:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json", "User-Agent": "Doubao-single-ad-analyzer/1.0"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def output_text(payload: dict) -> str:
    if isinstance(payload.get("output_text"), str):
        return payload["output_text"]
    chunks: list[str] = []
    for item in payload.get("output") or []:
        for part in item.get("content") or []:
            if part.get("type") == "output_text" and isinstance(part.get("text"), str):
                chunks.append(part["text"])
    if not chunks:
        raise ValueError("Doubao response did not contain output_text")
    return "".join(chunks)


def parse_model_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if not match:
            raise
        value = json.loads(match.group(0))
    if not isinstance(value, dict):
        raise ValueError("Doubao analysis must be a JSON object")
    return value


def validate_analysis(analysis: dict) -> None:
    required = {
        "analysis_version",
        "source",
        "executive_summary",
        "content_tags",
        "hook_analysis",
        "storyboard",
        "objective_recognition",
        "marketing_analysis",
        "optimization_plan",
    }
    missing = sorted(required - set(analysis))
    if missing:
        raise ValueError("analysis missing fields: " + ", ".join(missing))
    storyboard = analysis.get("storyboard")
    # Very short ads often have fewer than eight meaningful shots. Requiring
    # artificial micro-segments makes the reusable flow less accurate, so keep
    # the upper bound while accepting a concise three-step structure.
    if not isinstance(storyboard, list) or not 3 <= len(storyboard) <= 18:
        raise ValueError("storyboard must contain 3 to 18 segments")
    for index, segment in enumerate(storyboard, 1):
        for field in (
            "start",
            "end",
            "segment_name",
            "objective_visual",
            "structure_role",
            "evidence",
            "improvement",
        ):
            if field not in segment:
                raise ValueError(f"storyboard segment {index} missing {field}")
    for path in (
        ("executive_summary", "overall_score"),
        ("hook_analysis", "hook_score"),
    ):
        value = analysis[path[0]].get(path[1])
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 100:
            raise ValueError(".".join(path) + " must be between 0 and 100")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("video_id")
    parser.add_argument("--site", default=DEFAULT_SITE)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--update-site", action="store_true")
    parser.add_argument("--apply-existing", type=Path, help="Patch a validated saved analysis without calling the model")
    args = parser.parse_args()

    site = args.site.rstrip("/")
    detail = request_json(f"{site}/api/ads/{args.video_id}")
    ad = detail.get("ad") or {}
    if not ad:
        raise SystemExit(f"Ad not found: {args.video_id}")

    if args.apply_existing:
        analysis = json.loads(args.apply_existing.read_text(encoding="utf-8"))
        validate_analysis(analysis)
        if str(analysis.get("video_id") or analysis.get("ad_id")) != args.video_id:
            raise SystemExit("Saved analysis belongs to a different video")
        backup = args.apply_existing.with_name("analysis-before.json")
        if not backup.exists():
            backup.write_text(json.dumps(ad.get("analysis") or {}, ensure_ascii=False, indent=2), encoding="utf-8")
        updated = request_json(f"{site}/api/ads/{args.video_id}", method="PATCH", body={"analysis": analysis})
        returned = (updated.get("ad") or {}).get("analysis") or {}
        if returned.get("analysis_version") != analysis["analysis_version"]:
            raise SystemExit("Site update returned an unexpected analysis version")
        print(json.dumps({"updated_site": True, "backup": str(backup.resolve()), "segments": len(analysis["storyboard"])}, ensure_ascii=False))
        return

    video_url = str(ad.get("videoUrl") or "")
    if not video_url:
        raise SystemExit("Ad does not have a public videoUrl")

    api_key = os.environ.get("ARK_API_KEY", "")
    if not api_key:
        api_key = getpass.getpass("ARK_API_KEY: ")
    if not api_key or not api_key.isascii():
        raise SystemExit("A valid ASCII ARK_API_KEY is required")

    content: list[dict] = [
        {"type": "input_video", "video_url": video_url},
        {
            "type": "input_text",
            "text": PROMPT
            + "\n网站已有元数据（只能辅助，不得覆盖视频证据）：\n"
            + json.dumps(
                {
                    "video_id": ad.get("video_id") or ad.get("id"),
                    "title": ad.get("title"),
                    "copywriting": ad.get("copywriting"),
                    "brand": ad.get("brand"),
                    "duration_seconds": ad.get("seconds"),
                    "play_count": ad.get("playCount"),
                    "like_count": ad.get("likeCount"),
                    "comment_count": ad.get("commentCount"),
                    "share_count": ad.get("shareCount"),
                },
                ensure_ascii=False,
            ),
        },
    ]
    for key in ("hookImageUrl", "fullImageUrl", "coverImageUrl"):
        if ad.get(key):
            content.append({"type": "input_image", "image_url": ad[key]})
    body = {
        "model": args.model,
        "input": [{"role": "user", "content": content}],
        "thinking": {"type": "disabled"},
    }
    request = urllib.request.Request(
        args.endpoint,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "TikTok-Ad-Assistant-Doubao21/1.0",
        },
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=900) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        detail_text = exc.read().decode("utf-8", errors="replace")[-2000:]
        raise SystemExit(f"Doubao HTTP {exc.code}: {detail_text or exc.reason}") from None
    analysis = parse_model_json(output_text(payload))
    validate_analysis(analysis)
    analysis["ad_id"] = args.video_id
    analysis["video_id"] = args.video_id
    analysis["model"] = args.model
    analysis["analyzed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    analysis["analysis_seconds"] = round(time.monotonic() - started, 2)

    output = args.output or Path("outputs") / f"doubao21-{args.video_id}" / "analysis.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(analysis, ensure_ascii=False, indent=2), encoding="utf-8")
    result = {"output": str(output.resolve()), "segments": len(analysis["storyboard"])}
    if args.update_site:
        updated = request_json(
            f"{site}/api/ads/{args.video_id}",
            method="PATCH",
            body={"analysis": analysis},
        )
        returned = (updated.get("ad") or {}).get("analysis") or {}
        if returned.get("analysis_version") != analysis["analysis_version"]:
            raise SystemExit("Site update returned an unexpected analysis version")
        result["updated_site"] = True
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
