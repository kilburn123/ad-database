--
-- PostgreSQL database dump
--

\restrict 8fhvrDpFLhsXuhSJso4mR5oO8KnyvXmgY6zxP2z1zfkW4a8OhqcNP0dTNfTyQMr

-- Dumped from database version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: ad_library_first_level_category(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ad_library_first_level_category(source_category text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT CASE
    WHEN source_category IN ('数码', '3C数码', '美国扫地机器人广告') THEN '数码'
    WHEN source_category IN ('美妆', '美妆个护') THEN '美妆'
    WHEN source_category IN ('大健康', '生活用品', '尊爱素材') THEN source_category
    ELSE source_category
  END
$$;


--
-- Name: detect_ad_platform(jsonb, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_ad_platform(p_raw_context jsonb, p_source_url text, p_download_source text, p_ad_id text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN lower(coalesce(p_raw_context->>'source_platform','') || ' ' || coalesce(p_source_url,'') || ' ' || coalesce(p_download_source,'') || ' ' || coalesce(p_ad_id,'')) LIKE '%kickstarter%' THEN 'kickstarter'
    WHEN lower(coalesce(p_raw_context->>'source_platform','') || ' ' || coalesce(p_source_url,'') || ' ' || coalesce(p_download_source,'') || ' ' || coalesce(p_ad_id,'')) LIKE '%indiegogo%' THEN 'indiegogo'
    WHEN lower(coalesce(p_raw_context->>'source_platform','') || ' ' || coalesce(p_source_url,'') || ' ' || coalesce(p_download_source,'') || ' ' || coalesce(p_ad_id,'')) LIKE '%pinterest%' THEN 'pinterest'
    WHEN lower(coalesce(p_raw_context->>'source_platform','') || ' ' || coalesce(p_source_url,'') || ' ' || coalesce(p_download_source,'') || ' ' || coalesce(p_ad_id,'')) LIKE '%instagram%' THEN 'instagram'
    WHEN lower(coalesce(p_raw_context->>'source_platform','') || ' ' || coalesce(p_source_url,'') || ' ' || coalesce(p_download_source,'') || ' ' || coalesce(p_ad_id,'')) LIKE '%facebook%' THEN 'facebook'
    WHEN lower(coalesce(p_raw_context->>'source_platform','') || ' ' || coalesce(p_source_url,'') || ' ' || coalesce(p_download_source,'') || ' ' || coalesce(p_ad_id,'')) LIKE '%youtube%'
      OR lower(coalesce(p_source_url,'')) LIKE '%youtu.be%' THEN 'youtube'
    WHEN lower(coalesce(p_raw_context->>'source_platform','') || ' ' || coalesce(p_source_url,'') || ' ' || coalesce(p_download_source,'') || ' ' || coalesce(p_ad_id,'')) LIKE '%tiktok%' THEN 'tiktok'
    ELSE NULL
  END;
$$;


--
-- Name: preserve_country_dictionary_zh(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.preserve_country_dictionary_zh() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.country_name_zh ~ '[一-龥]'
     AND NEW.country_name_zh !~ '[一-龥]' THEN
    NEW.country_name_zh := OLD.country_name_zh;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: sync_ads_normalized_core(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_ads_normalized_core() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_platform_code TEXT;
  v_category_id BIGINT;
BEGIN
  v_platform_code := detect_ad_platform(NEW.raw_context_json, NEW.source_url, NEW.download_source, NEW.id);

  INSERT INTO ad_sources (
    ad_id, platform_code, platform_content_id, source_url, source_published_at_raw,
    search_keyword, download_source, author_name, raw_context
  ) VALUES (
    NEW.id, v_platform_code, NEW.video_id, NEW.source_url, NEW.published_at,
    NEW.search_keyword, NEW.download_source, NEW.brand, NEW.raw_context_json
  )
  ON CONFLICT (ad_id) DO UPDATE SET
    platform_code = EXCLUDED.platform_code,
    platform_content_id = EXCLUDED.platform_content_id,
    source_url = EXCLUDED.source_url,
    source_published_at_raw = EXCLUDED.source_published_at_raw,
    search_keyword = EXCLUDED.search_keyword,
    download_source = EXCLUDED.download_source,
    author_name = EXCLUDED.author_name,
    raw_context = EXCLUDED.raw_context,
    updated_at = now();

  IF TG_OP = 'INSERT' THEN
    INSERT INTO ad_metric_snapshots (
      ad_id, captured_at, metric_source, play_count, like_count, comment_count, share_count
    ) VALUES (
      NEW.id, clock_timestamp(), 'ads_write_trigger', NEW.play_count, NEW.like_count, NEW.comment_count, NEW.share_count
    );
  ELSIF ROW(OLD.play_count, OLD.like_count, OLD.comment_count, OLD.share_count)
      IS DISTINCT FROM ROW(NEW.play_count, NEW.like_count, NEW.comment_count, NEW.share_count) THEN
    INSERT INTO ad_metric_snapshots (
      ad_id, captured_at, metric_source, play_count, like_count, comment_count, share_count
    ) VALUES (
      NEW.id, clock_timestamp(), 'ads_write_trigger', NEW.play_count, NEW.like_count, NEW.comment_count, NEW.share_count
    );
  END IF;

  IF NEW.video_url <> '' OR NEW.video_path <> '' OR NEW.oss_key <> '' THEN
    INSERT INTO ad_media_assets (
      ad_id, asset_type, storage_provider, oss_key, asset_url, local_path,
      file_name, duration_seconds, is_primary
    ) VALUES (
      NEW.id, 'video', NEW.storage_provider, NEW.oss_key, NEW.video_url,
      NEW.video_path, NEW.filename, NEW.duration_seconds, true
    )
    ON CONFLICT (ad_id, asset_type) WHERE is_primary DO UPDATE SET
      storage_provider = EXCLUDED.storage_provider,
      oss_key = EXCLUDED.oss_key,
      asset_url = EXCLUDED.asset_url,
      local_path = EXCLUDED.local_path,
      file_name = EXCLUDED.file_name,
      duration_seconds = EXCLUDED.duration_seconds,
      updated_at = now();
  ELSE
    DELETE FROM ad_media_assets
    WHERE ad_id = NEW.id AND asset_type = 'video' AND is_primary;
  END IF;

  IF NEW.cover_image_url <> '' THEN
    INSERT INTO ad_media_assets(ad_id, asset_type, asset_url, is_primary)
    VALUES (NEW.id, 'cover', NEW.cover_image_url, true)
    ON CONFLICT (ad_id, asset_type) WHERE is_primary DO UPDATE SET
      asset_url = EXCLUDED.asset_url, updated_at = now();
  ELSE
    DELETE FROM ad_media_assets
    WHERE ad_id = NEW.id AND asset_type = 'cover' AND is_primary;
  END IF;

  IF NEW.hook_image_url <> '' THEN
    INSERT INTO ad_media_assets(ad_id, asset_type, asset_url, is_primary)
    VALUES (NEW.id, 'hook_image', NEW.hook_image_url, true)
    ON CONFLICT (ad_id, asset_type) WHERE is_primary DO UPDATE SET
      asset_url = EXCLUDED.asset_url, updated_at = now();
  ELSE
    DELETE FROM ad_media_assets
    WHERE ad_id = NEW.id AND asset_type = 'hook_image' AND is_primary;
  END IF;

  IF NEW.full_image_url <> '' THEN
    INSERT INTO ad_media_assets(ad_id, asset_type, asset_url, is_primary)
    VALUES (NEW.id, 'full_analysis_image', NEW.full_image_url, true)
    ON CONFLICT (ad_id, asset_type) WHERE is_primary DO UPDATE SET
      asset_url = EXCLUDED.asset_url, updated_at = now();
  ELSE
    DELETE FROM ad_media_assets
    WHERE ad_id = NEW.id AND asset_type = 'full_analysis_image' AND is_primary;
  END IF;

  IF TG_OP = 'INSERT'
     OR OLD.category IS DISTINCT FROM NEW.category
     OR OLD.brand IS DISTINCT FROM NEW.brand THEN
    UPDATE ad_product_classifications
    SET is_current = false, valid_to = now()
    WHERE ad_id = NEW.id AND is_current AND is_primary;

    IF NEW.category <> '' THEN
      INSERT INTO product_categories(category_name, category_level)
      VALUES (NEW.category, 1)
      ON CONFLICT DO NOTHING;

      SELECT category_id INTO v_category_id
      FROM product_categories
      WHERE parent_category_id IS NULL AND lower(category_name) = lower(NEW.category)
      ORDER BY category_id LIMIT 1;

      INSERT INTO ad_product_classifications(
        ad_id, category_id, brand_name, classification_source,
        review_status, is_primary, is_current
      ) VALUES (
        NEW.id, v_category_id, NEW.brand, 'legacy_ads.category',
        'confirmed', true, true
      );
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR OLD.classification_tag IS DISTINCT FROM NEW.classification_tag THEN
    UPDATE ad_video_type_classifications
    SET is_current = false, valid_to = now()
    WHERE ad_id = NEW.id AND is_current;

    IF NEW.classification_tag <> '' THEN
      INSERT INTO ad_video_type_classifications(
        ad_id, video_type_code, classification_source, review_status, is_current
      ) VALUES (
        NEW.id, NEW.classification_tag, 'legacy_ads.classification_tag', 'confirmed', true
      );
    END IF;
  END IF;

  IF TG_OP = 'INSERT'
     OR ROW(OLD.country_code, OLD.country_name, OLD.country_confidence, OLD.country_source,
            OLD.country_status, OLD.country_evidence, OLD.country_model, OLD.country_analyzed_at)
        IS DISTINCT FROM
        ROW(NEW.country_code, NEW.country_name, NEW.country_confidence, NEW.country_source,
            NEW.country_status, NEW.country_evidence, NEW.country_model, NEW.country_analyzed_at) THEN
    UPDATE ad_country_analyses
    SET is_current = false, valid_to = now()
    WHERE ad_id = NEW.id AND is_current;

    IF NEW.country_code <> '' THEN
      INSERT INTO countries(country_code, country_name_zh)
      VALUES (upper(NEW.country_code), NEW.country_name)
      ON CONFLICT (country_code) DO UPDATE SET country_name_zh = EXCLUDED.country_name_zh;
    END IF;

    INSERT INTO ad_country_analyses(
      ad_id, country_code, country_name_snapshot, confidence, status,
      analysis_source, evidence, model_name, analyzed_at_raw, is_current
    ) VALUES (
      NEW.id, nullif(upper(NEW.country_code), ''), NEW.country_name,
      NEW.country_confidence, NEW.country_status, NEW.country_source,
      NEW.country_evidence, NEW.country_model, NEW.country_analyzed_at, true
    );
  END IF;

  IF TG_OP = 'INSERT' OR OLD.analysis_json IS DISTINCT FROM NEW.analysis_json THEN
    UPDATE ad_ai_analyses
    SET is_current = false
    WHERE ad_id = NEW.id AND analysis_type = 'full_video_analysis' AND is_current;

    IF NEW.analysis_json <> '{}'::jsonb THEN
      INSERT INTO ad_ai_analyses(
        ad_id, analysis_type, analysis_version, status, result, is_current
      ) VALUES (
        NEW.id, 'full_video_analysis', 'legacy', 'completed', NEW.analysis_json, true
      );
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR OLD.favorite IS DISTINCT FROM NEW.favorite THEN
    INSERT INTO ad_user_actions(ad_id, actor_id, action_type, action_value, reason)
    VALUES (NEW.id, 'legacy-user', 'favorite', NEW.favorite, 'synchronized from ads.favorite')
    ON CONFLICT (ad_id, actor_id, action_type) DO UPDATE SET
      action_value = EXCLUDED.action_value, occurred_at = now(), updated_at = now();
  END IF;

  IF TG_OP = 'INSERT' OR OLD.positive_favorite IS DISTINCT FROM NEW.positive_favorite THEN
    INSERT INTO ad_user_actions(ad_id, actor_id, action_type, action_value, reason)
    VALUES (NEW.id, 'legacy-user', 'positive_rating', NEW.positive_favorite, 'synchronized from ads.positive_favorite')
    ON CONFLICT (ad_id, actor_id, action_type) DO UPDATE SET
      action_value = EXCLUDED.action_value, occurred_at = now(), updated_at = now();
  END IF;

  IF TG_OP = 'INSERT' OR OLD.negative_favorite IS DISTINCT FROM NEW.negative_favorite THEN
    INSERT INTO ad_user_actions(ad_id, actor_id, action_type, action_value, reason)
    VALUES (NEW.id, 'legacy-user', 'negative_rating', NEW.negative_favorite, 'synchronized from ads.negative_favorite')
    ON CONFLICT (ad_id, actor_id, action_type) DO UPDATE SET
      action_value = EXCLUDED.action_value, occurred_at = now(), updated_at = now();
  END IF;

  IF TG_OP = 'INSERT' OR OLD.priority_favorite IS DISTINCT FROM NEW.priority_favorite THEN
    INSERT INTO ad_user_actions(ad_id, actor_id, action_type, action_value, reason)
    VALUES (NEW.id, 'legacy-user', 'priority', NEW.priority_favorite, 'synchronized from ads.priority_favorite')
    ON CONFLICT (ad_id, actor_id, action_type) DO UPDATE SET
      action_value = EXCLUDED.action_value, occurred_at = now(), updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_metric_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_metric_snapshots (
    id bigint NOT NULL,
    ad_id text NOT NULL,
    account_key text NOT NULL,
    username text DEFAULT ''::text NOT NULL,
    captured_at bigint NOT NULL,
    play_count bigint DEFAULT 0 NOT NULL,
    like_count bigint DEFAULT 0 NOT NULL,
    comment_count bigint DEFAULT 0 NOT NULL,
    share_count bigint DEFAULT 0 NOT NULL
);


--
-- Name: account_metric_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.account_metric_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: account_metric_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.account_metric_snapshots_id_seq OWNED BY public.account_metric_snapshots.id;


--
-- Name: account_monitor_disabled; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_monitor_disabled (
    account_key text NOT NULL,
    username text DEFAULT ''::text NOT NULL,
    disabled_at bigint NOT NULL,
    reason text DEFAULT ''::text NOT NULL
);


--
-- Name: account_monitor_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_monitor_jobs (
    id text NOT NULL,
    username text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    mode text DEFAULT 'metadata'::text NOT NULL,
    requested_at bigint NOT NULL,
    started_at bigint DEFAULT 0 NOT NULL,
    finished_at bigint DEFAULT 0 NOT NULL,
    error text DEFAULT ''::text NOT NULL,
    config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    result_json jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: ad_ai_analyses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_ai_analyses (
    analysis_id bigint NOT NULL,
    ad_id text NOT NULL,
    analysis_type text DEFAULT 'full_video_analysis'::text NOT NULL,
    analysis_version text DEFAULT 'legacy'::text NOT NULL,
    model_name text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    analyzed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_ai_analyses_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: ad_ai_analyses_analysis_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ad_ai_analyses ALTER COLUMN analysis_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ad_ai_analyses_analysis_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ad_country_analyses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_country_analyses (
    analysis_id bigint NOT NULL,
    ad_id text NOT NULL,
    country_code text,
    country_name_snapshot text DEFAULT '未知'::text NOT NULL,
    confidence double precision DEFAULT 0 NOT NULL,
    status text NOT NULL,
    analysis_source text DEFAULT 'unclassified'::text NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    model_name text DEFAULT ''::text NOT NULL,
    analyzed_at_raw text DEFAULT ''::text NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    valid_to timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_country_analyses_check CHECK (((is_current AND (valid_to IS NULL)) OR ((NOT is_current) AND (valid_to IS NOT NULL)))),
    CONSTRAINT ad_country_analyses_confidence_check CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision))),
    CONSTRAINT ad_country_analyses_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'review'::text, 'confirmed'::text, 'rejected'::text])))
);


--
-- Name: ad_country_analyses_analysis_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ad_country_analyses ALTER COLUMN analysis_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ad_country_analyses_analysis_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ad_media_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_media_assets (
    asset_id bigint NOT NULL,
    ad_id text NOT NULL,
    asset_type text NOT NULL,
    storage_provider text DEFAULT ''::text NOT NULL,
    oss_key text DEFAULT ''::text NOT NULL,
    asset_url text DEFAULT ''::text NOT NULL,
    local_path text DEFAULT ''::text NOT NULL,
    file_name text DEFAULT ''::text NOT NULL,
    mime_type text DEFAULT ''::text NOT NULL,
    file_size_bytes bigint,
    width integer,
    height integer,
    duration_seconds double precision,
    is_primary boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_media_assets_asset_type_check CHECK ((asset_type = ANY (ARRAY['video'::text, 'cover'::text, 'hook_image'::text, 'full_analysis_image'::text, 'other'::text]))),
    CONSTRAINT ad_media_assets_duration_seconds_check CHECK (((duration_seconds IS NULL) OR (duration_seconds >= (0)::double precision))),
    CONSTRAINT ad_media_assets_file_size_bytes_check CHECK (((file_size_bytes IS NULL) OR (file_size_bytes >= 0)))
);


--
-- Name: ad_metric_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_metric_snapshots (
    snapshot_id bigint NOT NULL,
    ad_id text NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    metric_source text DEFAULT 'platform'::text NOT NULL,
    play_count bigint,
    like_count bigint,
    comment_count bigint,
    share_count bigint,
    save_count bigint,
    follower_count bigint,
    supporter_count bigint,
    funded_amount numeric(20,2),
    currency_code text,
    raw_metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_metric_snapshots_comment_count_check CHECK (((comment_count IS NULL) OR (comment_count >= 0))),
    CONSTRAINT ad_metric_snapshots_follower_count_check CHECK (((follower_count IS NULL) OR (follower_count >= 0))),
    CONSTRAINT ad_metric_snapshots_like_count_check CHECK (((like_count IS NULL) OR (like_count >= 0))),
    CONSTRAINT ad_metric_snapshots_play_count_check CHECK (((play_count IS NULL) OR (play_count >= 0))),
    CONSTRAINT ad_metric_snapshots_save_count_check CHECK (((save_count IS NULL) OR (save_count >= 0))),
    CONSTRAINT ad_metric_snapshots_share_count_check CHECK (((share_count IS NULL) OR (share_count >= 0))),
    CONSTRAINT ad_metric_snapshots_supporter_count_check CHECK (((supporter_count IS NULL) OR (supporter_count >= 0)))
);


--
-- Name: ad_product_classifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_product_classifications (
    classification_id bigint NOT NULL,
    ad_id text NOT NULL,
    category_id bigint,
    product_name text DEFAULT ''::text NOT NULL,
    brand_name text DEFAULT ''::text NOT NULL,
    classification_source text DEFAULT ''::text NOT NULL,
    confidence double precision,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    review_status text DEFAULT 'pending'::text NOT NULL,
    model_name text DEFAULT ''::text NOT NULL,
    is_primary boolean DEFAULT true NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    valid_to timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_product_classifications_check CHECK (((is_current AND (valid_to IS NULL)) OR ((NOT is_current) AND (valid_to IS NOT NULL)))),
    CONSTRAINT ad_product_classifications_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::double precision) AND (confidence <= (1)::double precision)))),
    CONSTRAINT ad_product_classifications_review_status_check CHECK ((review_status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'rejected'::text])))
);


--
-- Name: ad_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_sources (
    ad_id text NOT NULL,
    platform_code text NOT NULL,
    platform_content_id text NOT NULL,
    source_url text DEFAULT ''::text NOT NULL,
    source_published_at_raw text DEFAULT ''::text NOT NULL,
    search_keyword text DEFAULT ''::text NOT NULL,
    download_source text DEFAULT ''::text NOT NULL,
    author_name text DEFAULT ''::text NOT NULL,
    collected_at timestamp with time zone DEFAULT now() NOT NULL,
    raw_context jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ad_video_type_classifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_video_type_classifications (
    classification_id bigint NOT NULL,
    ad_id text NOT NULL,
    video_type_code text NOT NULL,
    classification_source text DEFAULT ''::text NOT NULL,
    confidence double precision,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    review_status text DEFAULT 'pending'::text NOT NULL,
    model_name text DEFAULT ''::text NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    valid_to timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_video_type_classifications_check CHECK (((is_current AND (valid_to IS NULL)) OR ((NOT is_current) AND (valid_to IS NOT NULL)))),
    CONSTRAINT ad_video_type_classifications_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::double precision) AND (confidence <= (1)::double precision)))),
    CONSTRAINT ad_video_type_classifications_review_status_check CHECK ((review_status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'rejected'::text])))
);


--
-- Name: ads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ads (
    id text NOT NULL,
    video_id text NOT NULL,
    copywriting text DEFAULT ''::text NOT NULL,
    source_url text DEFAULT ''::text NOT NULL,
    market text DEFAULT ''::text NOT NULL,
    published_at text DEFAULT ''::text NOT NULL,
    duration_seconds double precision DEFAULT 0 NOT NULL,
    duration_label text DEFAULT ''::text NOT NULL,
    play_count bigint DEFAULT 0 NOT NULL,
    like_count bigint DEFAULT 0 NOT NULL,
    comment_count bigint DEFAULT 0 NOT NULL,
    share_count bigint DEFAULT 0 NOT NULL,
    search_keyword text DEFAULT ''::text NOT NULL,
    download_source text DEFAULT ''::text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    category text DEFAULT ''::text NOT NULL,
    quality integer DEFAULT 75 NOT NULL,
    schema_score integer DEFAULT 75 NOT NULL,
    risk text DEFAULT 'low'::text NOT NULL,
    scope text DEFAULT 'assist'::text NOT NULL,
    favorite boolean DEFAULT false NOT NULL,
    fav_time text,
    created bigint NOT NULL,
    cover integer DEFAULT 0 NOT NULL,
    brand text DEFAULT ''::text NOT NULL,
    tags_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    uploaded_at text NOT NULL,
    raw_context_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    filename text DEFAULT ''::text NOT NULL,
    video_path text DEFAULT ''::text NOT NULL,
    video_url text DEFAULT ''::text NOT NULL,
    storage_provider text DEFAULT 'local'::text NOT NULL,
    oss_key text DEFAULT ''::text NOT NULL,
    analysis_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    hook_image_url text DEFAULT ''::text NOT NULL,
    full_image_url text DEFAULT ''::text NOT NULL,
    cover_image_url text DEFAULT ''::text NOT NULL,
    positive_favorite boolean DEFAULT false NOT NULL,
    negative_favorite boolean DEFAULT false NOT NULL,
    rating_time text,
    classification_tag text DEFAULT ''::text NOT NULL,
    country_code text DEFAULT ''::text NOT NULL,
    country_name text DEFAULT '未知'::text NOT NULL,
    country_confidence double precision DEFAULT 0 NOT NULL,
    country_source text DEFAULT 'unclassified'::text NOT NULL,
    country_status text DEFAULT 'pending'::text NOT NULL,
    country_evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    country_model text DEFAULT ''::text NOT NULL,
    country_analyzed_at text DEFAULT ''::text NOT NULL,
    priority_favorite boolean DEFAULT false NOT NULL,
    CONSTRAINT ads_classification_tag_check CHECK (((classification_tag = ''::text) OR (classification_tag = ANY (ARRAY['R1'::text, 'R2'::text, 'R3'::text, 'R4'::text, 'R5'::text, 'A1'::text, 'A2'::text]))))
);


--
-- Name: TABLE ads; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ads IS '广告视频兼容主表；规范化迁移期间保留，新增业务优先写入关联表';


--
-- Name: countries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.countries (
    country_code text NOT NULL,
    country_name_zh text NOT NULL,
    country_name_en text DEFAULT ''::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT countries_country_code_check CHECK ((country_code = upper(country_code)))
);


--
-- Name: product_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_categories (
    category_id bigint NOT NULL,
    parent_category_id bigint,
    category_name text NOT NULL,
    category_level smallint DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_categories_category_level_check CHECK (((category_level >= 1) AND (category_level <= 10)))
);


--
-- Name: ad_data_overview; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ad_data_overview AS
 SELECT a.id AS ad_id,
    s.platform_code,
    s.platform_content_id,
    a.title,
    a.copywriting,
    a.published_at,
    a.duration_seconds,
    a.brand,
    public.ad_library_first_level_category(pc.category_name) AS category_name,
    apc.product_name,
    avtc.video_type_code,
    aca.country_code,
        CASE
            WHEN (aca.country_code IS NULL) THEN '未标注'::text
            WHEN ((aca.country_name_snapshot ~ '[一-龥]'::text) AND (aca.country_name_snapshot !~* '^(未知|未标注|unknown)$'::text)) THEN aca.country_name_snapshot
            ELSE COALESCE(NULLIF(c.country_name_zh, ''::text), NULLIF(aca.country_name_snapshot, ''::text), '未标注'::text)
        END AS country_name,
    aca.status AS country_status,
    ams.play_count,
    ams.like_count,
    ams.comment_count,
    ams.share_count,
    ams.captured_at AS metrics_captured_at,
    video.asset_url AS video_url,
    cover.asset_url AS cover_image_url,
    (EXISTS ( SELECT 1
           FROM public.ad_ai_analyses aa
          WHERE ((aa.ad_id = a.id) AND (aa.analysis_type = 'full_video_analysis'::text) AND aa.is_current))) AS is_analyzed
   FROM (((((((((public.ads a
     JOIN public.ad_sources s ON ((s.ad_id = a.id)))
     LEFT JOIN public.ad_product_classifications apc ON (((apc.ad_id = a.id) AND apc.is_current AND apc.is_primary)))
     LEFT JOIN public.product_categories pc ON ((pc.category_id = apc.category_id)))
     LEFT JOIN public.ad_video_type_classifications avtc ON (((avtc.ad_id = a.id) AND avtc.is_current)))
     LEFT JOIN public.ad_country_analyses aca ON (((aca.ad_id = a.id) AND aca.is_current)))
     LEFT JOIN public.countries c ON ((c.country_code = aca.country_code)))
     LEFT JOIN LATERAL ( SELECT m.snapshot_id,
            m.ad_id,
            m.captured_at,
            m.metric_source,
            m.play_count,
            m.like_count,
            m.comment_count,
            m.share_count,
            m.save_count,
            m.follower_count,
            m.supporter_count,
            m.funded_amount,
            m.currency_code,
            m.raw_metrics,
            m.created_at
           FROM public.ad_metric_snapshots m
          WHERE (m.ad_id = a.id)
          ORDER BY m.captured_at DESC, m.snapshot_id DESC
         LIMIT 1) ams ON (true))
     LEFT JOIN public.ad_media_assets video ON (((video.ad_id = a.id) AND (video.asset_type = 'video'::text) AND video.is_primary)))
     LEFT JOIN public.ad_media_assets cover ON (((cover.ad_id = a.id) AND (cover.asset_type = 'cover'::text) AND cover.is_primary)))
  WHERE (COALESCE(a.category, ''::text) <> '账号经营数据监控'::text);


--
-- Name: VIEW ad_data_overview; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.ad_data_overview IS '广告库数据总览；排除账号经营监控素材；国家指目标市场，按country_code归并，country_name为标准化中文展示名，未确认时为未标注';


--
-- Name: ad_media_assets_asset_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ad_media_assets ALTER COLUMN asset_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ad_media_assets_asset_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ad_metric_snapshots_snapshot_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ad_metric_snapshots ALTER COLUMN snapshot_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ad_metric_snapshots_snapshot_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ad_product_classifications_classification_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ad_product_classifications ALTER COLUMN classification_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ad_product_classifications_classification_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ad_user_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_user_actions (
    action_id bigint NOT NULL,
    ad_id text NOT NULL,
    actor_id text DEFAULT 'legacy-user'::text NOT NULL,
    action_type text NOT NULL,
    action_value boolean DEFAULT true NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_user_actions_action_type_check CHECK ((action_type = ANY (ARRAY['favorite'::text, 'positive_rating'::text, 'negative_rating'::text, 'priority'::text, 'selected_for_production'::text])))
);


--
-- Name: ad_user_actions_action_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ad_user_actions ALTER COLUMN action_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ad_user_actions_action_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ad_video_type_classifications_classification_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ad_video_type_classifications ALTER COLUMN classification_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ad_video_type_classifications_classification_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ads_classification_tag_backup_20260803; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ads_classification_tag_backup_20260803 (
    id text,
    video_id text,
    classification_tag text,
    backed_up_at timestamp with time zone
);


--
-- Name: campaign_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_deliveries (
    delivery_id bigint NOT NULL,
    generated_video_id bigint NOT NULL,
    platform_code text NOT NULL,
    account_id text DEFAULT ''::text NOT NULL,
    campaign_id text DEFAULT ''::text NOT NULL,
    ad_group_id text DEFAULT ''::text NOT NULL,
    external_ad_id text DEFAULT ''::text NOT NULL,
    target_market_code text,
    delivered_at timestamp with time zone,
    delivery_status text DEFAULT 'planned'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaign_deliveries_delivery_status_check CHECK ((delivery_status = ANY (ARRAY['planned'::text, 'active'::text, 'paused'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: campaign_deliveries_delivery_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.campaign_deliveries ALTER COLUMN delivery_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.campaign_deliveries_delivery_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: category_performance_daily; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.category_performance_daily AS
 SELECT (m.captured_at)::date AS metric_date,
    public.ad_library_first_level_category(pc.category_name) AS category_name,
    count(DISTINCT m.ad_id) AS material_count,
    (avg(m.play_count))::numeric(20,2) AS avg_play_count,
    (avg(m.like_count))::numeric(20,2) AS avg_like_count,
    sum(((COALESCE(m.like_count, (0)::bigint) + COALESCE(m.comment_count, (0)::bigint)) + COALESCE(m.share_count, (0)::bigint))) AS interaction_count,
        CASE
            WHEN (sum(COALESCE(m.play_count, (0)::bigint)) > (0)::numeric) THEN round(((sum(((COALESCE(m.like_count, (0)::bigint) + COALESCE(m.comment_count, (0)::bigint)) + COALESCE(m.share_count, (0)::bigint))) / sum(m.play_count)) * (100)::numeric), 4)
            ELSE (0)::numeric
        END AS engagement_rate_pct,
    count(*) FILTER (WHERE (m.like_count > 1000)) AS high_like_material_count,
    max(m.captured_at) AS data_updated_at
   FROM ((public.ad_metric_snapshots m
     JOIN public.ad_product_classifications apc ON (((apc.ad_id = m.ad_id) AND apc.is_current AND apc.is_primary)))
     JOIN public.product_categories pc ON ((pc.category_id = apc.category_id)))
  GROUP BY ((m.captured_at)::date), (public.ad_library_first_level_category(pc.category_name));


--
-- Name: country_category_performance; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.country_category_performance AS
 SELECT country_code,
    country_name,
    category_name,
    count(*) AS material_count,
    (avg(play_count))::numeric(20,2) AS avg_play_count,
    (avg(like_count))::numeric(20,2) AS avg_like_count,
    count(*) FILTER (WHERE (like_count > 1000)) AS high_like_material_count,
        CASE
            WHEN (sum(COALESCE(play_count, (0)::bigint)) > (0)::numeric) THEN round(((sum(((COALESCE(like_count, (0)::bigint) + COALESCE(comment_count, (0)::bigint)) + COALESCE(share_count, (0)::bigint))) / sum(play_count)) * (100)::numeric), 4)
            ELSE (0)::numeric
        END AS engagement_rate_pct,
    max(metrics_captured_at) AS data_updated_at
   FROM public.ad_data_overview o
  GROUP BY country_code, country_name, category_name;


--
-- Name: crowdfunding_metric_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crowdfunding_metric_snapshots (
    snapshot_id bigint NOT NULL,
    project_id bigint NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    supporter_count bigint,
    follower_count bigint,
    funded_amount numeric(20,2),
    funding_goal numeric(20,2),
    currency_code text,
    funding_rate numeric(12,6),
    raw_metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crowdfunding_metric_snapshots_follower_count_check CHECK (((follower_count IS NULL) OR (follower_count >= 0))),
    CONSTRAINT crowdfunding_metric_snapshots_funded_amount_check CHECK (((funded_amount IS NULL) OR (funded_amount >= (0)::numeric))),
    CONSTRAINT crowdfunding_metric_snapshots_funding_goal_check CHECK (((funding_goal IS NULL) OR (funding_goal > (0)::numeric))),
    CONSTRAINT crowdfunding_metric_snapshots_supporter_count_check CHECK (((supporter_count IS NULL) OR (supporter_count >= 0)))
);


--
-- Name: crowdfunding_metric_snapshots_snapshot_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crowdfunding_metric_snapshots ALTER COLUMN snapshot_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.crowdfunding_metric_snapshots_snapshot_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crowdfunding_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crowdfunding_projects (
    project_id bigint NOT NULL,
    ad_id text NOT NULL,
    platform_code text NOT NULL,
    platform_project_id text DEFAULT ''::text NOT NULL,
    project_name text DEFAULT ''::text NOT NULL,
    creator_name text DEFAULT ''::text NOT NULL,
    project_url text DEFAULT ''::text NOT NULL,
    campaign_status text DEFAULT ''::text NOT NULL,
    raw_project jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crowdfunding_projects_platform_code_check CHECK ((platform_code = ANY (ARRAY['kickstarter'::text, 'indiegogo'::text])))
);


--
-- Name: crowdfunding_projects_project_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crowdfunding_projects ALTER COLUMN project_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.crowdfunding_projects_project_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: data_assistant_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_assistant_feedback (
    feedback_id bigint NOT NULL,
    query_id text NOT NULL,
    actor_id text DEFAULT 'anonymous'::text NOT NULL,
    is_helpful boolean NOT NULL,
    feedback_text text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: data_assistant_feedback_feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.data_assistant_feedback ALTER COLUMN feedback_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.data_assistant_feedback_feedback_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: data_assistant_queries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_assistant_queries (
    query_id text NOT NULL,
    conversation_id text DEFAULT ''::text NOT NULL,
    actor_id text DEFAULT 'anonymous'::text NOT NULL,
    question text NOT NULL,
    intent text DEFAULT ''::text NOT NULL,
    generated_sql text DEFAULT ''::text NOT NULL,
    query_status text NOT NULL,
    row_count integer DEFAULT 0 NOT NULL,
    execution_ms integer DEFAULT 0 NOT NULL,
    error_message text DEFAULT ''::text NOT NULL,
    result_preview jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT data_assistant_queries_query_status_check CHECK ((query_status = ANY (ARRAY['success'::text, 'failed'::text, 'clarification'::text, 'knowledge'::text])))
);


--
-- Name: TABLE data_assistant_queries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.data_assistant_queries IS '数据助手问答、生成SQL和执行结果审计日志';


--
-- Name: delivery_metric_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_metric_snapshots (
    snapshot_id bigint NOT NULL,
    delivery_id bigint NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    impressions bigint,
    clicks bigint,
    conversions bigint,
    spend numeric(20,2),
    revenue numeric(20,2),
    currency_code text,
    video_views bigint,
    three_second_views bigint,
    completed_views bigint,
    likes bigint,
    comments bigint,
    shares bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: delivery_metric_snapshots_snapshot_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.delivery_metric_snapshots ALTER COLUMN snapshot_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.delivery_metric_snapshots_snapshot_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: delivery_performance_overview; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.delivery_performance_overview AS
 SELECT d.delivery_id,
    d.generated_video_id,
    d.platform_code,
    d.target_market_code,
    d.delivery_status,
    d.delivered_at,
    m.captured_at,
    m.impressions,
    m.clicks,
    m.conversions,
    m.spend,
    m.revenue,
    m.currency_code,
        CASE
            WHEN (COALESCE(m.impressions, (0)::bigint) > 0) THEN round((((m.clicks)::numeric / (m.impressions)::numeric) * (100)::numeric), 4)
            ELSE NULL::numeric
        END AS ctr_pct,
        CASE
            WHEN (COALESCE(m.clicks, (0)::bigint) > 0) THEN round((((m.conversions)::numeric / (m.clicks)::numeric) * (100)::numeric), 4)
            ELSE NULL::numeric
        END AS conversion_rate_pct,
        CASE
            WHEN (COALESCE(m.spend, (0)::numeric) > (0)::numeric) THEN round((m.revenue / m.spend), 4)
            ELSE NULL::numeric
        END AS roas
   FROM (public.campaign_deliveries d
     LEFT JOIN LATERAL ( SELECT x.snapshot_id,
            x.delivery_id,
            x.captured_at,
            x.impressions,
            x.clicks,
            x.conversions,
            x.spend,
            x.revenue,
            x.currency_code,
            x.video_views,
            x.three_second_views,
            x.completed_views,
            x.likes,
            x.comments,
            x.shares,
            x.created_at
           FROM public.delivery_metric_snapshots x
          WHERE (x.delivery_id = d.delivery_id)
          ORDER BY x.captured_at DESC, x.snapshot_id DESC
         LIMIT 1) m ON (true));


--
-- Name: generated_videos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generated_videos (
    generated_video_id bigint NOT NULL,
    remake_task_id bigint NOT NULL,
    version_no integer DEFAULT 1 NOT NULL,
    video_url text DEFAULT ''::text NOT NULL,
    oss_key text DEFAULT ''::text NOT NULL,
    duration_seconds double precision,
    review_status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT generated_videos_review_status_check CHECK ((review_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT generated_videos_version_no_check CHECK ((version_no > 0))
);


--
-- Name: generated_videos_generated_video_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.generated_videos ALTER COLUMN generated_video_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.generated_videos_generated_video_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: kb_columns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_columns (
    table_name text NOT NULL,
    column_name text NOT NULL,
    column_name_zh text NOT NULL,
    business_definition text NOT NULL,
    data_type text NOT NULL,
    is_nullable boolean DEFAULT true NOT NULL,
    key_type text DEFAULT ''::text NOT NULL,
    is_dimension boolean DEFAULT false NOT NULL,
    is_metric boolean DEFAULT false NOT NULL,
    value_example text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE kb_columns; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_columns IS '企业数据知识库：字段定义、口径、类型和示例';


--
-- Name: kb_examples; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_examples (
    example_id bigint NOT NULL,
    question text NOT NULL,
    intent text NOT NULL,
    metric_codes text[] DEFAULT '{}'::text[] NOT NULL,
    sql_template text DEFAULT ''::text NOT NULL,
    answer_guidance text DEFAULT ''::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: kb_examples_example_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.kb_examples ALTER COLUMN example_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.kb_examples_example_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: kb_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_metrics (
    metric_code text NOT NULL,
    metric_name text NOT NULL,
    business_definition text NOT NULL,
    calculation_formula text NOT NULL,
    source_table text NOT NULL,
    time_granularity text DEFAULT '当前值'::text NOT NULL,
    caveat text DEFAULT ''::text NOT NULL,
    example_question text DEFAULT ''::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE kb_metrics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_metrics IS '企业数据知识库：统一业务指标口径';


--
-- Name: kb_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_relationships (
    relationship_id bigint NOT NULL,
    from_table text NOT NULL,
    from_column text NOT NULL,
    to_table text NOT NULL,
    to_column text NOT NULL,
    relationship_type text NOT NULL,
    description text NOT NULL
);


--
-- Name: kb_relationships_relationship_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.kb_relationships ALTER COLUMN relationship_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.kb_relationships_relationship_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: kb_tables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_tables (
    table_name text NOT NULL,
    table_name_zh text NOT NULL,
    description text NOT NULL,
    data_granularity text NOT NULL,
    update_frequency text DEFAULT '按业务更新'::text NOT NULL,
    data_owner text DEFAULT '数据产品'::text NOT NULL,
    query_enabled boolean DEFAULT false NOT NULL,
    display_order integer DEFAULT 100 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE kb_tables; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_tables IS '企业数据知识库：数据表目录及业务说明';


--
-- Name: material_usage_overview; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.material_usage_overview AS
SELECT
    NULL::bigint AS usage_id,
    NULL::text AS ad_id,
    NULL::text AS title,
    NULL::text AS platform_code,
    NULL::text AS category_name,
    NULL::text AS product_name,
    NULL::text AS video_type_code,
    NULL::text AS country_code,
    NULL::text AS actor_id,
    NULL::text AS usage_status,
    NULL::text AS business_category,
    NULL::text AS usage_reason,
    NULL::timestamp with time zone AS selected_at,
    NULL::bigint AS remake_task_count,
    NULL::bigint AS completed_task_count;


--
-- Name: material_usage_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_usage_records (
    usage_id bigint NOT NULL,
    ad_id text NOT NULL,
    actor_id text DEFAULT ''::text NOT NULL,
    usage_status text DEFAULT 'selected'::text NOT NULL,
    business_category text DEFAULT ''::text NOT NULL,
    usage_reason text DEFAULT ''::text NOT NULL,
    selected_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT material_usage_records_usage_status_check CHECK ((usage_status = ANY (ARRAY['viewed'::text, 'recommended'::text, 'selected'::text, 'started'::text, 'completed'::text, 'rejected'::text])))
);


--
-- Name: material_usage_records_usage_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.material_usage_records ALTER COLUMN usage_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.material_usage_records_usage_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: platforms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platforms (
    platform_code text NOT NULL,
    platform_name text NOT NULL,
    platform_type text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platforms_platform_type_check CHECK ((platform_type = ANY (ARRAY['social'::text, 'crowdfunding'::text])))
);


--
-- Name: product_categories_category_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.product_categories ALTER COLUMN category_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.product_categories_category_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: remake_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.remake_tasks (
    remake_task_id bigint NOT NULL,
    usage_id bigint NOT NULL,
    task_name text DEFAULT ''::text NOT NULL,
    owner_id text DEFAULT ''::text NOT NULL,
    task_status text DEFAULT 'created'::text NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT remake_tasks_task_status_check CHECK ((task_status = ANY (ARRAY['created'::text, 'producing'::text, 'reviewing'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: remake_tasks_remake_task_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.remake_tasks ALTER COLUMN remake_task_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.remake_tasks_remake_task_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tiktok_crawl_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tiktok_crawl_jobs (
    id text NOT NULL,
    status text NOT NULL,
    requested_at bigint NOT NULL,
    started_at bigint DEFAULT 0 NOT NULL,
    finished_at bigint DEFAULT 0 NOT NULL,
    error text DEFAULT ''::text NOT NULL,
    config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    result_json jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: video_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_types (
    video_type_code text NOT NULL,
    video_type_name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: account_metric_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_metric_snapshots ALTER COLUMN id SET DEFAULT nextval('public.account_metric_snapshots_id_seq'::regclass);


--
-- Name: account_metric_snapshots account_metric_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_metric_snapshots
    ADD CONSTRAINT account_metric_snapshots_pkey PRIMARY KEY (id);


--
-- Name: account_monitor_disabled account_monitor_disabled_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_monitor_disabled
    ADD CONSTRAINT account_monitor_disabled_pkey PRIMARY KEY (account_key);


--
-- Name: account_monitor_jobs account_monitor_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_monitor_jobs
    ADD CONSTRAINT account_monitor_jobs_pkey PRIMARY KEY (id);


--
-- Name: ad_ai_analyses ad_ai_analyses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_ai_analyses
    ADD CONSTRAINT ad_ai_analyses_pkey PRIMARY KEY (analysis_id);


--
-- Name: ad_country_analyses ad_country_analyses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_country_analyses
    ADD CONSTRAINT ad_country_analyses_pkey PRIMARY KEY (analysis_id);


--
-- Name: ad_media_assets ad_media_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_media_assets
    ADD CONSTRAINT ad_media_assets_pkey PRIMARY KEY (asset_id);


--
-- Name: ad_metric_snapshots ad_metric_snapshots_ad_id_captured_at_metric_source_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_metric_snapshots
    ADD CONSTRAINT ad_metric_snapshots_ad_id_captured_at_metric_source_key UNIQUE (ad_id, captured_at, metric_source);


--
-- Name: ad_metric_snapshots ad_metric_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_metric_snapshots
    ADD CONSTRAINT ad_metric_snapshots_pkey PRIMARY KEY (snapshot_id);


--
-- Name: ad_product_classifications ad_product_classifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_product_classifications
    ADD CONSTRAINT ad_product_classifications_pkey PRIMARY KEY (classification_id);


--
-- Name: ad_sources ad_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_sources
    ADD CONSTRAINT ad_sources_pkey PRIMARY KEY (ad_id);


--
-- Name: ad_user_actions ad_user_actions_ad_id_actor_id_action_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_user_actions
    ADD CONSTRAINT ad_user_actions_ad_id_actor_id_action_type_key UNIQUE (ad_id, actor_id, action_type);


--
-- Name: ad_user_actions ad_user_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_user_actions
    ADD CONSTRAINT ad_user_actions_pkey PRIMARY KEY (action_id);


--
-- Name: ad_video_type_classifications ad_video_type_classifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_video_type_classifications
    ADD CONSTRAINT ad_video_type_classifications_pkey PRIMARY KEY (classification_id);


--
-- Name: ads ads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads
    ADD CONSTRAINT ads_pkey PRIMARY KEY (id);


--
-- Name: campaign_deliveries campaign_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_deliveries
    ADD CONSTRAINT campaign_deliveries_pkey PRIMARY KEY (delivery_id);


--
-- Name: countries countries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.countries
    ADD CONSTRAINT countries_pkey PRIMARY KEY (country_code);


--
-- Name: crowdfunding_metric_snapshots crowdfunding_metric_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crowdfunding_metric_snapshots
    ADD CONSTRAINT crowdfunding_metric_snapshots_pkey PRIMARY KEY (snapshot_id);


--
-- Name: crowdfunding_metric_snapshots crowdfunding_metric_snapshots_project_id_captured_at_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crowdfunding_metric_snapshots
    ADD CONSTRAINT crowdfunding_metric_snapshots_project_id_captured_at_key UNIQUE (project_id, captured_at);


--
-- Name: crowdfunding_projects crowdfunding_projects_ad_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crowdfunding_projects
    ADD CONSTRAINT crowdfunding_projects_ad_id_key UNIQUE (ad_id);


--
-- Name: crowdfunding_projects crowdfunding_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crowdfunding_projects
    ADD CONSTRAINT crowdfunding_projects_pkey PRIMARY KEY (project_id);


--
-- Name: data_assistant_feedback data_assistant_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_assistant_feedback
    ADD CONSTRAINT data_assistant_feedback_pkey PRIMARY KEY (feedback_id);


--
-- Name: data_assistant_feedback data_assistant_feedback_query_id_actor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_assistant_feedback
    ADD CONSTRAINT data_assistant_feedback_query_id_actor_id_key UNIQUE (query_id, actor_id);


--
-- Name: data_assistant_queries data_assistant_queries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_assistant_queries
    ADD CONSTRAINT data_assistant_queries_pkey PRIMARY KEY (query_id);


--
-- Name: delivery_metric_snapshots delivery_metric_snapshots_delivery_id_captured_at_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_metric_snapshots
    ADD CONSTRAINT delivery_metric_snapshots_delivery_id_captured_at_key UNIQUE (delivery_id, captured_at);


--
-- Name: delivery_metric_snapshots delivery_metric_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_metric_snapshots
    ADD CONSTRAINT delivery_metric_snapshots_pkey PRIMARY KEY (snapshot_id);


--
-- Name: generated_videos generated_videos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_videos
    ADD CONSTRAINT generated_videos_pkey PRIMARY KEY (generated_video_id);


--
-- Name: generated_videos generated_videos_remake_task_id_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_videos
    ADD CONSTRAINT generated_videos_remake_task_id_version_no_key UNIQUE (remake_task_id, version_no);


--
-- Name: kb_columns kb_columns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_columns
    ADD CONSTRAINT kb_columns_pkey PRIMARY KEY (table_name, column_name);


--
-- Name: kb_examples kb_examples_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_examples
    ADD CONSTRAINT kb_examples_pkey PRIMARY KEY (example_id);


--
-- Name: kb_examples kb_examples_question_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_examples
    ADD CONSTRAINT kb_examples_question_key UNIQUE (question);


--
-- Name: kb_metrics kb_metrics_metric_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_metrics
    ADD CONSTRAINT kb_metrics_metric_name_key UNIQUE (metric_name);


--
-- Name: kb_metrics kb_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_metrics
    ADD CONSTRAINT kb_metrics_pkey PRIMARY KEY (metric_code);


--
-- Name: kb_relationships kb_relationships_from_table_from_column_to_table_to_column_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_relationships
    ADD CONSTRAINT kb_relationships_from_table_from_column_to_table_to_column_key UNIQUE (from_table, from_column, to_table, to_column);


--
-- Name: kb_relationships kb_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_relationships
    ADD CONSTRAINT kb_relationships_pkey PRIMARY KEY (relationship_id);


--
-- Name: kb_tables kb_tables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_tables
    ADD CONSTRAINT kb_tables_pkey PRIMARY KEY (table_name);


--
-- Name: material_usage_records material_usage_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_usage_records
    ADD CONSTRAINT material_usage_records_pkey PRIMARY KEY (usage_id);


--
-- Name: platforms platforms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platforms
    ADD CONSTRAINT platforms_pkey PRIMARY KEY (platform_code);


--
-- Name: platforms platforms_platform_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platforms
    ADD CONSTRAINT platforms_platform_name_key UNIQUE (platform_name);


--
-- Name: product_categories product_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_pkey PRIMARY KEY (category_id);


--
-- Name: remake_tasks remake_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remake_tasks
    ADD CONSTRAINT remake_tasks_pkey PRIMARY KEY (remake_task_id);


--
-- Name: tiktok_crawl_jobs tiktok_crawl_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tiktok_crawl_jobs
    ADD CONSTRAINT tiktok_crawl_jobs_pkey PRIMARY KEY (id);


--
-- Name: video_types video_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_types
    ADD CONSTRAINT video_types_pkey PRIMARY KEY (video_type_code);


--
-- Name: idx_account_metric_snapshots_account_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_metric_snapshots_account_time ON public.account_metric_snapshots USING btree (account_key, captured_at DESC);


--
-- Name: idx_account_metric_snapshots_ad_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_metric_snapshots_ad_time ON public.account_metric_snapshots USING btree (ad_id, captured_at DESC);


--
-- Name: idx_account_monitor_jobs_requested; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_monitor_jobs_requested ON public.account_monitor_jobs USING btree (requested_at DESC);


--
-- Name: idx_account_monitor_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_monitor_jobs_status ON public.account_monitor_jobs USING btree (status, requested_at DESC);


--
-- Name: idx_account_monitor_jobs_status_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_monitor_jobs_status_time ON public.account_monitor_jobs USING btree (status, requested_at DESC);


--
-- Name: idx_account_monitor_jobs_username_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_monitor_jobs_username_time ON public.account_monitor_jobs USING btree (username, requested_at DESC);


--
-- Name: idx_ad_ai_analysis_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_ai_analysis_status ON public.ad_ai_analyses USING btree (status, analyzed_at DESC);


--
-- Name: idx_ad_country_code_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_country_code_status ON public.ad_country_analyses USING btree (country_code, status) WHERE is_current;


--
-- Name: idx_ad_media_assets_oss_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_media_assets_oss_key ON public.ad_media_assets USING btree (oss_key) WHERE (oss_key <> ''::text);


--
-- Name: idx_ad_metric_snapshots_ad_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_metric_snapshots_ad_time ON public.ad_metric_snapshots USING btree (ad_id, captured_at DESC);


--
-- Name: idx_ad_metric_snapshots_hot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_metric_snapshots_hot ON public.ad_metric_snapshots USING btree (like_count DESC, captured_at DESC);


--
-- Name: idx_ad_product_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_product_category ON public.ad_product_classifications USING btree (category_id, ad_id) WHERE is_current;


--
-- Name: idx_ad_sources_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_sources_platform ON public.ad_sources USING btree (platform_code);


--
-- Name: idx_ad_sources_search_keyword; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_sources_search_keyword ON public.ad_sources USING btree (search_keyword);


--
-- Name: idx_ad_user_actions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_user_actions_type ON public.ad_user_actions USING btree (action_type, action_value, occurred_at DESC);


--
-- Name: idx_ad_video_type_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_video_type_code ON public.ad_video_type_classifications USING btree (video_type_code, ad_id) WHERE is_current;


--
-- Name: idx_ads_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_category ON public.ads USING btree (category);


--
-- Name: idx_ads_classification_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_classification_tag ON public.ads USING btree (classification_tag);


--
-- Name: idx_ads_country_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_country_code ON public.ads USING btree (country_code);


--
-- Name: idx_ads_country_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_country_status ON public.ads USING btree (country_status);


--
-- Name: idx_ads_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_created ON public.ads USING btree (created DESC);


--
-- Name: idx_ads_favorite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_favorite ON public.ads USING btree (favorite, created DESC);


--
-- Name: idx_ads_negative_favorite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_negative_favorite ON public.ads USING btree (negative_favorite, created DESC);


--
-- Name: idx_ads_positive_favorite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_positive_favorite ON public.ads USING btree (positive_favorite, created DESC);


--
-- Name: idx_ads_video_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_video_id ON public.ads USING btree (video_id);


--
-- Name: idx_campaign_deliveries_video; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_deliveries_video ON public.campaign_deliveries USING btree (generated_video_id, delivered_at DESC);


--
-- Name: idx_crowdfunding_metrics_project_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crowdfunding_metrics_project_time ON public.crowdfunding_metric_snapshots USING btree (project_id, captured_at DESC);


--
-- Name: idx_data_assistant_queries_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_data_assistant_queries_created ON public.data_assistant_queries USING btree (created_at DESC);


--
-- Name: idx_delivery_metrics_delivery_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_delivery_metrics_delivery_time ON public.delivery_metric_snapshots USING btree (delivery_id, captured_at DESC);


--
-- Name: idx_material_usage_ad_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_usage_ad_status ON public.material_usage_records USING btree (ad_id, usage_status, selected_at DESC);


--
-- Name: idx_tiktok_crawl_jobs_requested; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tiktok_crawl_jobs_requested ON public.tiktok_crawl_jobs USING btree (requested_at DESC);


--
-- Name: idx_tiktok_crawl_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tiktok_crawl_jobs_status ON public.tiktok_crawl_jobs USING btree (status, requested_at);


--
-- Name: uq_ad_ai_analysis_current_type; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_ad_ai_analysis_current_type ON public.ad_ai_analyses USING btree (ad_id, analysis_type) WHERE is_current;


--
-- Name: uq_ad_country_current; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_ad_country_current ON public.ad_country_analyses USING btree (ad_id) WHERE is_current;


--
-- Name: uq_ad_media_primary_type; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_ad_media_primary_type ON public.ad_media_assets USING btree (ad_id, asset_type) WHERE is_primary;


--
-- Name: uq_ad_product_current_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_ad_product_current_primary ON public.ad_product_classifications USING btree (ad_id) WHERE (is_current AND is_primary);


--
-- Name: uq_ad_sources_platform_content; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_ad_sources_platform_content ON public.ad_sources USING btree (platform_code, platform_content_id) WHERE (platform_content_id <> ''::text);


--
-- Name: uq_ad_video_type_current; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_ad_video_type_current ON public.ad_video_type_classifications USING btree (ad_id) WHERE is_current;


--
-- Name: uq_product_categories_parent_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_product_categories_parent_name ON public.product_categories USING btree (COALESCE(parent_category_id, (0)::bigint), lower(category_name));


--
-- Name: material_usage_overview _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.material_usage_overview AS
 SELECT u.usage_id,
    u.ad_id,
    o.title,
    o.platform_code,
    o.category_name,
    o.product_name,
    o.video_type_code,
    o.country_code,
    u.actor_id,
    u.usage_status,
    u.business_category,
    u.usage_reason,
    u.selected_at,
    count(t.remake_task_id) AS remake_task_count,
    count(t.remake_task_id) FILTER (WHERE (t.task_status = 'completed'::text)) AS completed_task_count
   FROM ((public.material_usage_records u
     JOIN public.ad_data_overview o ON ((o.ad_id = u.ad_id)))
     LEFT JOIN public.remake_tasks t ON ((t.usage_id = u.usage_id)))
  GROUP BY u.usage_id, o.title, o.platform_code, o.category_name, o.product_name, o.video_type_code, o.country_code;


--
-- Name: countries trg_preserve_country_dictionary_zh; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_preserve_country_dictionary_zh BEFORE UPDATE OF country_name_zh ON public.countries FOR EACH ROW EXECUTE FUNCTION public.preserve_country_dictionary_zh();


--
-- Name: ads trg_sync_ads_normalized_core; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_ads_normalized_core AFTER INSERT OR UPDATE ON public.ads FOR EACH ROW EXECUTE FUNCTION public.sync_ads_normalized_core();


--
-- Name: account_metric_snapshots account_metric_snapshots_ad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_metric_snapshots
    ADD CONSTRAINT account_metric_snapshots_ad_id_fkey FOREIGN KEY (ad_id) REFERENCES public.ads(id) ON DELETE CASCADE;


--
-- Name: ad_ai_analyses ad_ai_analyses_ad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_ai_analyses
    ADD CONSTRAINT ad_ai_analyses_ad_id_fkey FOREIGN KEY (ad_id) REFERENCES public.ads(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ad_country_analyses ad_country_analyses_ad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_country_analyses
    ADD CONSTRAINT ad_country_analyses_ad_id_fkey FOREIGN KEY (ad_id) REFERENCES public.ads(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ad_country_analyses ad_country_analyses_country_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_country_analyses
    ADD CONSTRAINT ad_country_analyses_country_code_fkey FOREIGN KEY (country_code) REFERENCES public.countries(country_code) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ad_media_assets ad_media_assets_ad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_media_assets
    ADD CONSTRAINT ad_media_assets_ad_id_fkey FOREIGN KEY (ad_id) REFERENCES public.ads(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ad_metric_snapshots ad_metric_snapshots_ad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_metric_snapshots
    ADD CONSTRAINT ad_metric_snapshots_ad_id_fkey FOREIGN KEY (ad_id) REFERENCES public.ads(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ad_product_classifications ad_product_classifications_ad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_product_classifications
    ADD CONSTRAINT ad_product_classifications_ad_id_fkey FOREIGN KEY (ad_id) REFERENCES public.ads(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ad_product_classifications ad_product_classifications_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_product_classifications
    ADD CONSTRAINT ad_product_classifications_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.product_categories(category_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ad_sources ad_sources_ad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_sources
    ADD CONSTRAINT ad_sources_ad_id_fkey FOREIGN KEY (ad_id) REFERENCES public.ads(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ad_sources ad_sources_platform_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_sources
    ADD CONSTRAINT ad_sources_platform_code_fkey FOREIGN KEY (platform_code) REFERENCES public.platforms(platform_code) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ad_user_actions ad_user_actions_ad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_user_actions
    ADD CONSTRAINT ad_user_actions_ad_id_fkey FOREIGN KEY (ad_id) REFERENCES public.ads(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ad_video_type_classifications ad_video_type_classifications_ad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_video_type_classifications
    ADD CONSTRAINT ad_video_type_classifications_ad_id_fkey FOREIGN KEY (ad_id) REFERENCES public.ads(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ad_video_type_classifications ad_video_type_classifications_video_type_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_video_type_classifications
    ADD CONSTRAINT ad_video_type_classifications_video_type_code_fkey FOREIGN KEY (video_type_code) REFERENCES public.video_types(video_type_code) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: campaign_deliveries campaign_deliveries_generated_video_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_deliveries
    ADD CONSTRAINT campaign_deliveries_generated_video_id_fkey FOREIGN KEY (generated_video_id) REFERENCES public.generated_videos(generated_video_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: campaign_deliveries campaign_deliveries_platform_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_deliveries
    ADD CONSTRAINT campaign_deliveries_platform_code_fkey FOREIGN KEY (platform_code) REFERENCES public.platforms(platform_code) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: crowdfunding_metric_snapshots crowdfunding_metric_snapshots_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crowdfunding_metric_snapshots
    ADD CONSTRAINT crowdfunding_metric_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.crowdfunding_projects(project_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: crowdfunding_projects crowdfunding_projects_ad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crowdfunding_projects
    ADD CONSTRAINT crowdfunding_projects_ad_id_fkey FOREIGN KEY (ad_id) REFERENCES public.ads(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: crowdfunding_projects crowdfunding_projects_platform_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crowdfunding_projects
    ADD CONSTRAINT crowdfunding_projects_platform_code_fkey FOREIGN KEY (platform_code) REFERENCES public.platforms(platform_code) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: data_assistant_feedback data_assistant_feedback_query_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_assistant_feedback
    ADD CONSTRAINT data_assistant_feedback_query_id_fkey FOREIGN KEY (query_id) REFERENCES public.data_assistant_queries(query_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: delivery_metric_snapshots delivery_metric_snapshots_delivery_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_metric_snapshots
    ADD CONSTRAINT delivery_metric_snapshots_delivery_id_fkey FOREIGN KEY (delivery_id) REFERENCES public.campaign_deliveries(delivery_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: generated_videos generated_videos_remake_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_videos
    ADD CONSTRAINT generated_videos_remake_task_id_fkey FOREIGN KEY (remake_task_id) REFERENCES public.remake_tasks(remake_task_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: kb_columns kb_columns_table_name_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_columns
    ADD CONSTRAINT kb_columns_table_name_fkey FOREIGN KEY (table_name) REFERENCES public.kb_tables(table_name) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: material_usage_records material_usage_records_ad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_usage_records
    ADD CONSTRAINT material_usage_records_ad_id_fkey FOREIGN KEY (ad_id) REFERENCES public.ads(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: product_categories product_categories_parent_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_parent_category_id_fkey FOREIGN KEY (parent_category_id) REFERENCES public.product_categories(category_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: remake_tasks remake_tasks_usage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remake_tasks
    ADD CONSTRAINT remake_tasks_usage_id_fkey FOREIGN KEY (usage_id) REFERENCES public.material_usage_records(usage_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict 8fhvrDpFLhsXuhSJso4mR5oO8KnyvXmgY6zxP2z1zfkW4a8OhqcNP0dTNfTyQMr

