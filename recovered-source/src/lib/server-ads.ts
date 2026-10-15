import crypto from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import { Pool } from 'pg';

export type Risk = 'low' | 'medium' | 'high';
export type Scope = 'core' | 'assist' | 'low';
export type RawAdContext = Record<string, unknown>;

export type SharedAd = {
  id: string;
  video_id: string;
  title: string;
  category: string;
  play: number;
  engagement: number;
  share: number;
  quality: number;
  schema: number;
  risk: Risk;
  scope: Scope;
  duration: string;
  seconds: string;
  favorite: boolean;
  favTime: string | null;
  created: number;
  cover: number;
  brand: string;
  tags: string[];
  uploaded: boolean;
  uploadedAt: string;
  sourceUrl: string;
  copywriting: string;
  market: string;
  publishedAt: string;
  playCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  searchKeyword: string;
  downloadSource: string;
  rawContext: RawAdContext;
  videoUrl: string;
  filename: string;
  analysis: RawAdContext;
  hookImageUrl: string;
  fullImageUrl: string;
};

export type AdSummary = Omit<SharedAd, 'rawContext' | 'filename' | 'analysis'> & {
  rawContext?: RawAdContext;
  filename?: string;
  analysis?: RawAdContext;
};

export type AdsPageParams = {
  page?: number;
  pageSize?: number;
  query?: string;
  category?: string;
  sort?: 'quality' | 'play' | 'engagement' | 'recent';
  favoriteOnly?: boolean;
};

export type AdsPageResult = {
  ads: AdSummary[];
  count: number;
  page: number;
  pageSize: number;
  stats: {
    total: number;
    favorite: number;
  };
  categories: string[];
};

export type UploadItem = {
  id?: string;
  filename: string;
  json: RawAdContext;
  videoBuffer: Buffer;
  uploadedAt: string;
  analysis?: RawAdContext;
  hookImageBuffer?: Buffer;
  fullImageBuffer?: Buffer;
};

export type AdMutationInput = Partial<SharedAd> & {
  id?: string;
  video_id?: string;
  favorite?: boolean;
};

export const APP_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '/tiktok-ad-assistant';

const DATA_DIR = process.env.TIKTOK_AD_DATA_DIR || path.join(process.cwd(), 'server-data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const LOCAL_VIDEO_FILENAME = 'video.mp4';

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

const numberFrom = (value: unknown, fallback = 0) => {
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').replace(/[^\d.-]/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const textFrom = (value: unknown, fallback = '') => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
};

const boolFrom = (value: unknown, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return ['1', 'true', 'yes'].includes(value.toLowerCase());
  return fallback;
};

const fmtDuration = (seconds = 0) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const percent = (part: number, total: number) => (total ? Number(((part / total) * 100).toFixed(2)) : 0);

const extractTitle = (text = '') => {
  const cleaned = String(text).replace(/#[\w\u4e00-\u9fa5-]+/g, '').replace(/\s+/g, ' ').trim();
  const first = cleaned.split(/[。.!?]/)[0] || cleaned || '上传广告素材';
  return first.length > 34 ? `${first.slice(0, 34)}...` : first;
};

const sanitizeId = (id: string) => {
  const clean = id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return clean || `ad_${Date.now()}`;
};

const asJsonObject = (value: unknown): RawAdContext => (value && typeof value === 'object' && !Array.isArray(value) ? (value as RawAdContext) : {});
const asStringArray = (value: unknown) => (Array.isArray(value) ? value.map((item) => textFrom(item)).filter(Boolean) : []);

const valueAt = (json: RawAdContext, keyPath: string) => {
  return keyPath.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[key];
  }, json);
};

const firstValue = (json: RawAdContext, keys: string[]) => {
  for (const key of keys) {
    const value = valueAt(json, key);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const firstText = (json: RawAdContext, keys: string[], fallback = '') => textFrom(firstValue(json, keys), fallback);
const firstNumber = (json: RawAdContext, keys: string[], fallback = 0) => numberFrom(firstValue(json, keys), fallback);

const durationSecondsFrom = (json: RawAdContext) => {
  const direct = firstValue(json, ['duration_seconds', 'durationSeconds', 'duration_sec', '视频时长']);
  if (direct !== undefined) return numberFrom(direct);
  const ms = firstValue(json, ['duration_ms', 'durationMs']);
  if (ms !== undefined) return numberFrom(ms) / 1000;
  const metaDuration = firstValue(json, ['videoMeta.duration']);
  const n = numberFrom(metaDuration);
  return n > 1000 ? n / 1000 : n;
};

const extractUploadFields = (json: RawAdContext, fallbackId = '') => ({
  videoId: firstText(json, ['video_id', '视频ID', 'id'], fallbackId),
  copywriting: firstText(json, ['文案', 'copywriting', 'caption', 'description', 'desc', 'text']),
  sourceUrl: firstText(json, ['来源链接', 'source_url', 'play_address', 'webVideoUrl', 'shareUrl', 'url']),
  market: firstText(json, ['市场', 'market', 'country', 'region']),
  publishedAt: firstText(json, ['发布时间', 'published_at', 'publish_time', 'create_time', 'createTimeISO', 'createDate']),
  durationSeconds: durationSecondsFrom(json),
  playCount: firstNumber(json, ['播放量', 'play_count', 'playCount', 'statistics.playCount', 'stats.views']),
  likeCount: firstNumber(json, ['点赞数', 'like_count', 'digg_count', 'diggCount', 'statistics.diggCount', 'stats.likes']),
  commentCount: firstNumber(json, ['评论数', 'comment_count', 'commentCount', 'statistics.commentCount', 'stats.comments']),
  shareCount: firstNumber(json, ['分享数', 'share_count', 'shareCount', 'statistics.shareCount', 'stats.shares']),
  searchKeyword: firstText(json, ['搜索关键词', 'search_keyword', 'search_query', 'keyword', 'query']),
  downloadSource: firstText(json, ['下载来源', 'download_source', 'download_method', 'download_status'])
});

const getOssConfig = () => {
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID || '';
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET || '';
  const bucket = process.env.OSS_BUCKET || '';
  const endpoint = (process.env.OSS_ENDPOINT || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const publicBaseUrl = (process.env.OSS_PUBLIC_BASE_URL || (bucket && endpoint ? `https://${bucket}.${endpoint}` : '')).replace(/\/$/, '');
  const prefix = (process.env.OSS_PREFIX || 'tiktok-ad-assistant/videos').replace(/^\/+|\/+$/g, '');
  if (!accessKeyId || !accessKeySecret || !bucket || !endpoint || !publicBaseUrl) return null;
  return { accessKeyId, accessKeySecret, bucket, endpoint, publicBaseUrl, prefix };
};

const encodeOssKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');
const ossPublicUrlForKey = (key: string) => {
  const config = getOssConfig();
  return config ? `${config.publicBaseUrl}/${encodeOssKey(key)}` : '';
};
const ossKeyForId = (id: string) => {
  const config = getOssConfig();
  return config ? `${config.prefix}/${sanitizeId(id)}/${LOCAL_VIDEO_FILENAME}` : '';
};
const isAppVideoUrl = (url = '') => url.startsWith(APP_BASE_PATH) || url.startsWith('/api/');
const externalVideoUrl = (url = '') => (url && !isAppVideoUrl(url) ? url : '');

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error('缺少 DATABASE_URL，无法连接 PostgreSQL');
  pool = new Pool({ connectionString, max: 10 });
  return pool;
}

async function query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  await ensureSchema();
  return getPool().query<T>(sql, params);
}

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await mkdir(UPLOAD_DIR, { recursive: true });
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS ads (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL,
        copywriting TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        market TEXT NOT NULL DEFAULT '',
        published_at TEXT NOT NULL DEFAULT '',
        duration_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
        duration_label TEXT NOT NULL DEFAULT '',
        play_count BIGINT NOT NULL DEFAULT 0,
        like_count BIGINT NOT NULL DEFAULT 0,
        comment_count BIGINT NOT NULL DEFAULT 0,
        share_count BIGINT NOT NULL DEFAULT 0,
        search_keyword TEXT NOT NULL DEFAULT '',
        download_source TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        quality INTEGER NOT NULL DEFAULT 75,
        schema_score INTEGER NOT NULL DEFAULT 75,
        risk TEXT NOT NULL DEFAULT 'low',
        scope TEXT NOT NULL DEFAULT 'assist',
        favorite BOOLEAN NOT NULL DEFAULT TRUE,
        fav_time TEXT,
        created BIGINT NOT NULL,
        cover INTEGER NOT NULL DEFAULT 0,
        brand TEXT NOT NULL DEFAULT '',
        tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        uploaded_at TEXT NOT NULL,
        raw_context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        filename TEXT NOT NULL DEFAULT '',
        video_path TEXT NOT NULL DEFAULT '',
        video_url TEXT NOT NULL DEFAULT '',
        storage_provider TEXT NOT NULL DEFAULT 'local',
        oss_key TEXT NOT NULL DEFAULT '',
        analysis_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        hook_image_url TEXT NOT NULL DEFAULT '',
        full_image_url TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_ads_created ON ads(created DESC);
      CREATE INDEX IF NOT EXISTS idx_ads_video_id ON ads(video_id);
      CREATE INDEX IF NOT EXISTS idx_ads_favorite ON ads(favorite, created DESC);
      CREATE INDEX IF NOT EXISTS idx_ads_category ON ads(category);
    `);
  })();
  return schemaReady;
}

async function uploadBufferToOss(id: string, buffer: Buffer, contentType = 'video/mp4') {
  const config = getOssConfig();
  if (!config) return null;
  const objectKey = ossKeyForId(id);
  const date = new Date().toUTCString();
  const canonicalResource = `/${config.bucket}/${objectKey}`;
  const canonicalOssHeaders = 'x-oss-object-acl:public-read\n';
  const stringToSign = ['PUT', '', contentType, date, `${canonicalOssHeaders}${canonicalResource}`].join('\n');
  const signature = crypto.createHmac('sha1', config.accessKeySecret).update(stringToSign).digest('base64');
  const uploadUrl = `https://${config.bucket}.${config.endpoint}/${encodeOssKey(objectKey)}`;
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `OSS ${config.accessKeyId}:${signature}`,
      Date: date,
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
      'x-oss-object-acl': 'public-read'
    },
    body: new Uint8Array(buffer)
  });
  if (!response.ok) throw new Error(`OSS 上传失败：${response.status} ${await response.text().catch(() => '')}`);
  return { provider: 'oss', key: objectKey, url: ossPublicUrlForKey(objectKey), path: '' };
}

async function uploadAssetBufferToOss(id: string, filename: string, buffer: Buffer, contentType: string) {
  const config = getOssConfig();
  if (!config) return null;
  const objectKey = `${config.prefix}/${sanitizeId(id)}/${filename}`;
  const date = new Date().toUTCString();
  const canonicalResource = `/${config.bucket}/${objectKey}`;
  const canonicalOssHeaders = 'x-oss-object-acl:public-read\n';
  const stringToSign = ['PUT', '', contentType, date, `${canonicalOssHeaders}${canonicalResource}`].join('\n');
  const signature = crypto.createHmac('sha1', config.accessKeySecret).update(stringToSign).digest('base64');
  const uploadUrl = `https://${config.bucket}.${config.endpoint}/${encodeOssKey(objectKey)}`;
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `OSS ${config.accessKeyId}:${signature}`,
      Date: date,
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
      'x-oss-object-acl': 'public-read'
    },
    body: new Uint8Array(buffer)
  });
  if (!response.ok) throw new Error(`OSS 资源上传失败：${response.status} ${await response.text().catch(() => '')}`);
  return ossPublicUrlForKey(objectKey);
}

async function persistVideo(id: string, buffer: Buffer) {
  const uploaded = await uploadBufferToOss(id, buffer).catch((error) => {
    if (process.env.OSS_REQUIRE_UPLOAD === '1') throw error;
    console.error(`OSS upload failed for ${id}`, error);
    return null;
  });
  if (uploaded) return uploaded;
  const folder = path.join(UPLOAD_DIR, sanitizeId(id));
  const videoPath = path.join(folder, LOCAL_VIDEO_FILENAME);
  await mkdir(folder, { recursive: true });
  await writeFile(videoPath, buffer);
  return { provider: 'local', key: '', url: '', path: videoPath };
}

function normalizeUploadItem(item: UploadItem, index: number, previous?: SharedAd) {
  const json = item.json || {};
  const extracted = extractUploadFields(json, item.id || `${Date.now()}_${index}`);
  const rawVideoId = extracted.videoId;
  const id = sanitizeId(rawVideoId);
  const copywriting = extracted.copywriting;
  const sourceUrl = extracted.sourceUrl;
  const market = extracted.market;
  const publishedAt = extracted.publishedAt;
  const durationSeconds = extracted.durationSeconds || firstNumber(item.analysis || {}, ['duration_seconds']);
  const playCount = extracted.playCount;
  const likeCount = extracted.likeCount;
  const commentCount = extracted.commentCount;
  const shareCount = extracted.shareCount;
  const searchKeyword = extracted.searchKeyword;
  const downloadSource = extracted.downloadSource || '上传';
  const explicitQuality = firstValue(json, ['viral_ad_candidate_score', 'base_viral_ad_candidate_score', 'response_signal_score', '质量分']);
  const explicitSchema = firstValue(json, ['format_clarity_score', 'commercial_likelihood_score', 'schema_score', 'Schema']);
  const engagementRate = firstNumber(json, ['engagement_rate_pct'], percent(likeCount + commentCount + shareCount, playCount));
  const playSignal = Math.min(10, Math.log10(Math.max(1, playCount)) * 2);
  const derivedQuality = Math.round(Math.max(60, Math.min(96, 68 + Math.min(18, engagementRate * 3) + playSignal)));
  const quality = Math.round(explicitQuality === undefined ? derivedQuality : numberFrom(explicitQuality, derivedQuality));
  const derivedSchema = Math.round(Math.max(64, Math.min(94, derivedQuality - 4 + (shareCount > likeCount * 0.2 ? 4 : 0))));
  const schema = Math.round(explicitSchema === undefined ? derivedSchema : numberFrom(explicitSchema, derivedSchema));
  const uploadedAt = item.uploadedAt || new Date().toISOString();
  const category = firstText(json, ['品类', 'content_format', 'category'], market || '上传素材');
  const title = extractTitle(copywriting || item.filename);
  const brand = market || firstText(json, ['username', 'author', 'nickname', 'brand', 'authorMeta.nickName', 'authorMeta.name'], 'Uploaded');
  const sourceTags = Array.isArray(json.tags) ? json.tags.map((tag) => textFrom(tag)).filter(Boolean).slice(0, 8) : [];
  return {
    id,
    videoId: rawVideoId || id,
    copywriting,
    sourceUrl,
    market,
    publishedAt,
    durationSeconds,
    durationLabel: fmtDuration(durationSeconds),
    playCount,
    likeCount,
    commentCount,
    shareCount,
    searchKeyword,
    downloadSource,
    title,
    category,
    quality: Math.max(0, Math.min(100, quality)),
    schema: Math.max(0, Math.min(100, schema)),
    risk: quality >= 70 ? 'low' : 'medium',
    scope: schema >= 85 ? 'core' : schema >= 70 ? 'assist' : 'low',
    favorite: previous?.favorite ?? true,
    favTime: previous?.favTime ?? '服务器上传',
    created: previous?.created ?? 10000 + new Date(uploadedAt).getTime(),
    cover: previous?.cover ?? index % 10,
    brand,
    tags: ['上传', category, market, searchKeyword, ...sourceTags].filter(Boolean),
    uploadedAt,
    rawContext: json,
    filename: item.filename
  };
}

const upsertColumns = [
  'id',
  'video_id',
  'copywriting',
  'source_url',
  'market',
  'published_at',
  'duration_seconds',
  'duration_label',
  'play_count',
  'like_count',
  'comment_count',
  'share_count',
  'search_keyword',
  'download_source',
  'title',
  'category',
  'quality',
  'schema_score',
  'risk',
  'scope',
  'favorite',
  'fav_time',
  'created',
  'cover',
  'brand',
  'tags_json',
  'uploaded_at',
  'raw_context_json',
  'filename',
  'video_path',
  'video_url',
  'storage_provider',
  'oss_key',
  'analysis_json',
  'hook_image_url',
  'full_image_url'
];

async function upsertRow(values: unknown[]) {
  const placeholders = upsertColumns.map((_, index) => `$${index + 1}`).join(', ');
  const updates = upsertColumns.filter((column) => column !== 'id').map((column) => `${column} = EXCLUDED.${column}`).join(', ');
  await query(
    `INSERT INTO ads (${upsertColumns.join(', ')})
     VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${updates}`,
    values
  );
}

export async function saveUploadItems(items: UploadItem[]) {
  await ensureSchema();
  const totalBefore = numberFrom((await query('SELECT COUNT(*) AS count FROM ads')).rows[0]?.count);
  const saved: AdSummary[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const itemId = sanitizeId(extractUploadFields(item.json || {}, item.id || `${Date.now()}_${index}`).videoId);
    const previous = await readAdDetail(itemId);
    const normalized = normalizeUploadItem(item, totalBefore + index, previous || undefined);
    const storedVideo = await persistVideo(normalized.id, item.videoBuffer);
    const hookImageUrl = item.hookImageBuffer ? (await uploadAssetBufferToOss(normalized.id, 'hook.jpg', item.hookImageBuffer, 'image/jpeg').catch(() => null)) || previous?.hookImageUrl || '' : previous?.hookImageUrl || '';
    const fullImageUrl = item.fullImageBuffer ? (await uploadAssetBufferToOss(normalized.id, 'full.jpg', item.fullImageBuffer, 'image/jpeg').catch(() => null)) || previous?.fullImageUrl || '' : previous?.fullImageUrl || '';
    const analysis = item.analysis || previous?.analysis || {};
    const folder = path.join(UPLOAD_DIR, normalized.id);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'ad_context.json'), JSON.stringify(item.json, null, 2), 'utf8');
    if (item.analysis) await writeFile(path.join(folder, 'analysis.json'), JSON.stringify(item.analysis, null, 2), 'utf8');
    await upsertRow([
      normalized.id,
      normalized.videoId,
      normalized.copywriting,
      normalized.sourceUrl,
      normalized.market,
      normalized.publishedAt,
      normalized.durationSeconds,
      normalized.durationLabel,
      normalized.playCount,
      normalized.likeCount,
      normalized.commentCount,
      normalized.shareCount,
      normalized.searchKeyword,
      normalized.downloadSource,
      normalized.title,
      normalized.category,
      normalized.quality,
      normalized.schema,
      normalized.risk,
      normalized.scope,
      normalized.favorite,
      normalized.favTime,
      normalized.created,
      normalized.cover,
      normalized.brand,
      JSON.stringify(normalized.tags),
      normalized.uploadedAt,
      JSON.stringify(normalized.rawContext),
      normalized.filename,
      storedVideo.path,
      storedVideo.url,
      storedVideo.provider,
      storedVideo.key,
      JSON.stringify(analysis),
      hookImageUrl,
      fullImageUrl
    ]);
    const row = (await query('SELECT * FROM ads WHERE id = $1', [normalized.id])).rows[0];
    if (row) saved.push(rowToAdSummary(row));
  }
  return { saved };
}

export async function upsertAdPayload(input: AdMutationInput) {
  const id = sanitizeId(textFrom(input.id || input.video_id, `${Date.now()}`));
  const previous = await readAdDetail(id);
  const playCount = numberFrom(input.playCount ?? input.play ?? previous?.playCount);
  const likeCount = numberFrom(input.likeCount ?? previous?.likeCount);
  const commentCount = numberFrom(input.commentCount ?? previous?.commentCount);
  const shareCount = numberFrom(input.shareCount ?? previous?.shareCount);
  const seconds = numberFrom(input.seconds ?? previous?.seconds);
  const duration = textFrom(input.duration, previous?.duration || fmtDuration(seconds));
  await upsertRow([
    id,
    textFrom(input.video_id, previous?.video_id || id),
    textFrom(input.copywriting, previous?.copywriting),
    textFrom(input.sourceUrl, previous?.sourceUrl),
    textFrom(input.market, previous?.market),
    textFrom(input.publishedAt, previous?.publishedAt),
    seconds,
    duration,
    playCount,
    likeCount,
    commentCount,
    shareCount,
    textFrom(input.searchKeyword, previous?.searchKeyword),
    textFrom(input.downloadSource, previous?.downloadSource || '接口写入'),
    textFrom(input.title, previous?.title || extractTitle(input.copywriting || '')),
    textFrom(input.category, previous?.category || '接口写入'),
    numberFrom(input.quality, previous?.quality || 75),
    numberFrom(input.schema, previous?.schema || 75),
    textFrom(input.risk, previous?.risk || 'low'),
    textFrom(input.scope, previous?.scope || 'assist'),
    boolFrom(input.favorite, previous?.favorite ?? true),
    textFrom(input.favTime, previous?.favTime || '接口写入'),
    numberFrom(input.created, previous?.created || Date.now()),
    numberFrom(input.cover, previous?.cover || 0),
    textFrom(input.brand, previous?.brand || input.market || 'Uploaded'),
    JSON.stringify(input.tags || previous?.tags || []),
    textFrom(input.uploadedAt, previous?.uploadedAt || new Date().toISOString()),
    JSON.stringify(input.rawContext || previous?.rawContext || {}),
    textFrom(input.filename, previous?.filename),
    '',
    externalVideoUrl(textFrom(input.videoUrl, previous?.videoUrl)),
    externalVideoUrl(textFrom(input.videoUrl, previous?.videoUrl)) ? 'oss' : 'local',
    '',
    JSON.stringify(input.analysis || previous?.analysis || {}),
    textFrom(input.hookImageUrl, previous?.hookImageUrl),
    textFrom(input.fullImageUrl, previous?.fullImageUrl)
  ]);
  return readAdDetail(id);
}

export async function readSharedAds() {
  const result = await readAdsPage({ page: 1, pageSize: 100 });
  return result.ads;
}

export async function readAdsPage(params: AdsPageParams = {}): Promise<AdsPageResult> {
  const pageSize = Math.max(1, Math.min(100, Math.floor(params.pageSize || 20)));
  const page = Math.max(1, Math.floor(params.page || 1));
  const offset = (page - 1) * pageSize;
  const clauses: string[] = [];
  const values: unknown[] = [];
  const queryText = (params.query || '').trim();
  const category = (params.category || '').trim();
  if (queryText) {
    values.push(`%${queryText}%`);
    clauses.push(`(title ILIKE $${values.length} OR video_id ILIKE $${values.length} OR category ILIKE $${values.length} OR brand ILIKE $${values.length} OR search_keyword ILIKE $${values.length} OR copywriting ILIKE $${values.length})`);
  }
  if (category && category !== 'all') {
    values.push(category);
    clauses.push(`category = $${values.length}`);
  }
  if (params.favoriteOnly) clauses.push('favorite = TRUE');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const orderBy =
    params.sort === 'play'
      ? 'play_count DESC, created DESC'
      : params.sort === 'engagement'
        ? 'CASE WHEN play_count > 0 THEN (like_count + comment_count + share_count)::double precision / play_count ELSE 0 END DESC, created DESC'
        : params.sort === 'recent'
          ? 'created DESC'
          : 'quality DESC, created DESC';
  const count = numberFrom((await query(`SELECT COUNT(*) AS count FROM ads ${where}`, values)).rows[0]?.count);
  const total = numberFrom((await query('SELECT COUNT(*) AS count FROM ads')).rows[0]?.count);
  const favorite = numberFrom((await query('SELECT COUNT(*) AS count FROM ads WHERE favorite = TRUE')).rows[0]?.count);
  const categories = (await query<{ category: string }>("SELECT DISTINCT category FROM ads WHERE COALESCE(category, '') <> '' ORDER BY category ASC LIMIT 200")).rows.map((row) => row.category).filter(Boolean);
  const rows = (
    await query(
      `SELECT id, video_id, title, category, duration_seconds, duration_label,
        play_count, like_count, comment_count, share_count, quality, schema_score,
        risk, scope, favorite, fav_time, created, cover, brand, tags_json,
        uploaded_at, source_url, copywriting, market, published_at, search_keyword,
        download_source, video_url, storage_provider, oss_key, hook_image_url, full_image_url
       FROM ads ${where}
       ORDER BY ${orderBy}
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, offset]
    )
  ).rows;
  return { ads: rows.map(rowToAdSummary), count, page, pageSize, stats: { total, favorite }, categories };
}

export async function readAdDetail(id: string) {
  const row = (await query('SELECT * FROM ads WHERE id = $1', [sanitizeId(id)])).rows[0];
  return row ? rowToSharedAd(row) : null;
}

export async function updateAd(id: string, input: AdMutationInput) {
  const previous = await readAdDetail(id);
  if (!previous) return null;
  return upsertAdPayload({ ...previous, ...input, id: previous.id, video_id: previous.video_id });
}

export async function deleteAd(id: string) {
  const result = await query('DELETE FROM ads WHERE id = $1 RETURNING id', [sanitizeId(id)]);
  return Boolean(result.rowCount);
}

export function videoPathForId(id: string) {
  return path.join(UPLOAD_DIR, sanitizeId(id), LOCAL_VIDEO_FILENAME);
}

export async function getRemoteVideoUrl(id: string) {
  const row = (await query('SELECT video_url, oss_key FROM ads WHERE id = $1', [sanitizeId(id)])).rows[0];
  const videoUrl = externalVideoUrl(textFrom(row?.video_url));
  if (videoUrl) return videoUrl;
  const ossKey = textFrom(row?.oss_key);
  return ossKey ? ossPublicUrlForKey(ossKey) : '';
}

export async function statVideo(id: string) {
  const row = (await query('SELECT video_path FROM ads WHERE id = $1', [sanitizeId(id)])).rows[0];
  return stat(textFrom(row?.video_path, videoPathForId(id)));
}

export async function createVideoStream(id: string, start?: number, end?: number) {
  const row = (await query('SELECT video_path FROM ads WHERE id = $1', [sanitizeId(id)])).rows[0];
  const filePath = textFrom(row?.video_path, videoPathForId(id));
  return createReadStream(filePath, start === undefined ? undefined : { start, end });
}

function rowToSharedAd(row: Record<string, unknown>): SharedAd {
  const id = textFrom(row.id);
  const playCount = numberFrom(row.play_count);
  const likeCount = numberFrom(row.like_count);
  const commentCount = numberFrom(row.comment_count);
  const shareCount = numberFrom(row.share_count);
  const durationSeconds = numberFrom(row.duration_seconds);
  const tags = asStringArray(row.tags_json);
  const rawContext = asJsonObject(row.raw_context_json);
  const analysis = asJsonObject(row.analysis_json);
  const remoteVideoUrl = externalVideoUrl(textFrom(row.video_url)) || (textFrom(row.oss_key) ? ossPublicUrlForKey(textFrom(row.oss_key)) : '');
  return {
    id,
    video_id: textFrom(row.video_id, id),
    title: textFrom(row.title, '上传广告素材'),
    category: textFrom(row.category, '上传素材'),
    play: playCount,
    engagement: percent(likeCount + commentCount + shareCount, playCount),
    share: percent(shareCount, playCount),
    quality: numberFrom(row.quality, 75),
    schema: numberFrom(row.schema_score, 75),
    risk: textFrom(row.risk, 'low') as Risk,
    scope: textFrom(row.scope, 'assist') as Scope,
    duration: textFrom(row.duration_label, fmtDuration(durationSeconds)),
    seconds: String(Number(durationSeconds.toFixed(1))).replace(/\.0$/, ''),
    favorite: boolFrom(row.favorite, true),
    favTime: textFrom(row.fav_time) || null,
    created: numberFrom(row.created, Date.now()),
    cover: numberFrom(row.cover),
    brand: textFrom(row.brand, 'Uploaded'),
    tags,
    uploaded: true,
    uploadedAt: textFrom(row.uploaded_at),
    sourceUrl: textFrom(row.source_url),
    copywriting: textFrom(row.copywriting),
    market: textFrom(row.market),
    publishedAt: textFrom(row.published_at),
    playCount,
    likeCount,
    commentCount,
    shareCount,
    searchKeyword: textFrom(row.search_keyword),
    downloadSource: textFrom(row.download_source),
    rawContext,
    videoUrl: remoteVideoUrl || `${APP_BASE_PATH}/api/ads/${encodeURIComponent(id)}/video`,
    filename: textFrom(row.filename),
    analysis,
    hookImageUrl: textFrom(row.hook_image_url),
    fullImageUrl: textFrom(row.full_image_url)
  };
}

function rowToAdSummary(row: Record<string, unknown>): AdSummary {
  const shared = rowToSharedAd({ ...row, raw_context_json: {}, analysis_json: {} });
  const { rawContext: _rawContext, analysis: _analysis, filename: _filename, ...summary } = shared;
  return summary;
}
