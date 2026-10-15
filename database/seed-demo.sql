SET search_path = public;
-- Synthetic demo/reference values only. No production ad records are included.
INSERT INTO public.platforms(platform_code,platform_name,platform_type) VALUES
('tiktok','TikTok','social'),('youtube','YouTube','social'),('instagram','Instagram','social'),
('facebook','Facebook','social'),('pinterest','Pinterest','social'),
('kickstarter','Kickstarter','crowdfunding'),('indiegogo','Indiegogo','crowdfunding')
ON CONFLICT DO NOTHING;
INSERT INTO public.video_types(video_type_code,video_type_name) VALUES
('R1','纯达人 UGC'),('R2','真人专家背书'),('R3','真人使用教程'),('R4','产品展示/品牌广告'),
('R5','真人案例混剪'),('A1','纯 AI 视频'),('A2','AI 与真人或真实产品结合')
ON CONFLICT DO NOTHING;
INSERT INTO public.ads(id,video_id,title,category,created,uploaded_at,play_count,raw_context_json)
VALUES ('handoff_demo_001','handoff_demo_001','交接演示素材：示例产品 A','演示分类',1770000000000,'2026-02-02T02:40:00.000Z',1200,'{"source_platform":"tiktok","demo":true}'::jsonb),
('handoff_demo_002','handoff_demo_002','交接演示素材：示例产品 B','演示分类',1770000001000,'2026-02-02T02:40:01.000Z',2400,'{"source_platform":"tiktok","demo":true}'::jsonb)
ON CONFLICT DO NOTHING;
