import JSZip from 'jszip';
import { NextResponse } from 'next/server';
import { readAdsPage, saveUploadItems, type RawAdContext, type UploadItem } from '@/lib/server-ads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isJunkEntry = (name = '') => {
  const parts = name.split('/').filter(Boolean);
  return parts.some((part) => part === '__MACOSX' || part === '.DS_Store' || part.startsWith('._') || part.startsWith('.~'));
};

const folderOf = (name: string) => {
  const parts = name.split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '__root__';
};

async function fileToBuffer(file: File) {
  return Buffer.from(await file.arrayBuffer());
}

async function parseJsonEntry(entry: JSZip.JSZipObject) {
  try {
    const parsed = JSON.parse((await entry.async('text')).replace(/^\uFEFF/, '')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as RawAdContext) : null;
  } catch {
    return null;
  }
}

const looksLikeAdContext = (json: RawAdContext) => {
  const keys = [
    'video_id',
    '视频ID',
    'id',
    '文案',
    'copywriting',
    'caption',
    'description',
    '播放量',
    'play_count',
    'playCount',
    '点赞数',
    'like_count',
    'digg_count',
    '评论数',
    'comment_count',
    '分享数',
    'share_count',
    '来源链接',
    'source_url',
    'webVideoUrl',
    'shareUrl'
  ];
  return keys.some((key) => json[key] !== undefined && json[key] !== null && json[key] !== '');
};

const looksLikeAnalysisContext = (json: RawAdContext) => {
  return Boolean(json.hook || json.opening_hook_deep_analysis || json.video_structure_deep_analysis || json.asset_refs);
};

async function parseZip(file: File) {
  const zip = await JSZip.loadAsync(await fileToBuffer(file));
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && !isJunkEntry(entry.name || ''));
  const groups = new Map<string, JSZip.JSZipObject[]>();
  const analysisByVideoId = new Map<string, RawAdContext>();

  for (const entry of entries.filter((item) => /_hook_structure_analysis\.json$/i.test(item.name))) {
    try {
      const parsed = JSON.parse(await entry.async('text')) as RawAdContext;
      const ads = Array.isArray(parsed.ads) ? parsed.ads : [];
      for (const ad of ads) {
        if (!ad || typeof ad !== 'object') continue;
        const videoId = (ad as RawAdContext).video_id;
        if (typeof videoId === 'string' || typeof videoId === 'number') {
          analysisByVideoId.set(String(videoId), ad as RawAdContext);
        }
      }
    } catch {
      // Analysis files are optional; bad analysis JSON should not block basic upload.
    }
  }

  const findAssetEntry = (ref?: unknown) => {
    if (typeof ref !== 'string' || !ref) return undefined;
    const cleanRef = ref.replace(/\\/g, '/').replace(/^\/+/, '');
    return entries.find((entry) => {
      const name = entry.name.replace(/\\/g, '/');
      return name.endsWith(cleanRef) || name.endsWith(`/${cleanRef}`);
    });
  };

  for (const entry of entries) {
    if (!/\.(json|mp4)$/i.test(entry.name)) continue;
    const key = folderOf(entry.name);
    groups.set(key, [...(groups.get(key) || []), entry]);
  }

  const records: UploadItem[] = [];
  for (const [folder, files] of groups) {
    const jsonEntries = files.filter((entry) => /\.json$/i.test(entry.name));
    const preferredJsonEntry = jsonEntries.find((entry) => /(^|\/)ad_context\.json$/i.test(entry.name));
    const videoEntry = files.find((entry) => /(^|\/)video\.mp4$/i.test(entry.name)) || files.find((entry) => /\.mp4$/i.test(entry.name));
    if (!jsonEntries.length || !videoEntry) continue;

    let json: RawAdContext;
    if (preferredJsonEntry) {
      const parsed = await parseJsonEntry(preferredJsonEntry);
      if (!parsed) throw new Error(`${preferredJsonEntry.name} 不是有效 JSON，可能选中了隐藏资源文件或文件损坏`);
      json = parsed;
    } else {
      const candidates: RawAdContext[] = [];
      const fallbackCandidates: RawAdContext[] = [];
      for (const entry of jsonEntries) {
        const parsed = await parseJsonEntry(entry);
        if (!parsed || !looksLikeAdContext(parsed)) continue;
        if (looksLikeAnalysisContext(parsed)) fallbackCandidates.push(parsed);
        else candidates.push(parsed);
      }
      const picked = candidates[0] || fallbackCandidates[0];
      if (!picked) {
        throw new Error(`${folder} 中没有找到可识别的广告数据 JSON`);
      }
      json = picked;
    }

    const videoId = typeof json.video_id === 'string' || typeof json.video_id === 'number' ? String(json.video_id) : '';
    let analysis = videoId ? analysisByVideoId.get(videoId) : undefined;
    if (!analysis) {
      for (const entry of jsonEntries) {
        const parsed = await parseJsonEntry(entry);
        if (parsed && looksLikeAnalysisContext(parsed)) {
          analysis = parsed;
          break;
        }
      }
    }
    const assetRefs = analysis && typeof analysis.asset_refs === 'object' ? (analysis.asset_refs as RawAdContext) : {};
    const hookEntry = findAssetEntry(assetRefs.hook_contact_sheet);
    const fullEntry = findAssetEntry(assetRefs.full_contact_sheet);

    records.push({
      id: videoId || `${file.name}-${folder}`,
      filename: folder === '__root__' ? file.name : `${file.name}/${folder}`,
      json,
      videoBuffer: Buffer.from(await videoEntry.async('arraybuffer')),
      uploadedAt: new Date().toISOString(),
      analysis,
      hookImageBuffer: hookEntry ? Buffer.from(await hookEntry.async('arraybuffer')) : undefined,
      fullImageBuffer: fullEntry ? Buffer.from(await fullEntry.async('arraybuffer')) : undefined
    });
  }

  if (!records.length) throw new Error(`${file.name} 中没有找到任何 ad_context.json + video.mp4 文件夹`);
  return records;
}

async function parseDirectFiles(files: File[]) {
  const jsonFile = files.find((file) => /\.json$/i.test(file.name));
  const videoFile = files.find((file) => /\.mp4$/i.test(file.name));
  if (!jsonFile || !videoFile) return [];

  let json: RawAdContext;
  try {
    json = JSON.parse(await jsonFile.text()) as RawAdContext;
  } catch {
    throw new Error(`${jsonFile.name} 不是有效 JSON`);
  }

  return [
    {
      id: typeof json.video_id === 'string' || typeof json.video_id === 'number' ? String(json.video_id) : `${Date.now()}`,
      filename: jsonFile.name,
      json,
      videoBuffer: await fileToBuffer(videoFile),
      uploadedAt: new Date().toISOString()
    }
  ] satisfies UploadItem[];
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData
      .getAll('files')
      .filter((value): value is File => value instanceof File)
      .filter((file) => {
        const name = file.name || '';
        return name !== '.DS_Store' && !name.startsWith('._') && !name.startsWith('.~');
      });

    if (!files.length) {
      return NextResponse.json({ error: '请选择 .zip，或同时选择 ad_context.json 和 video.mp4' }, { status: 400 });
    }

    const records: UploadItem[] = [];
    for (const file of files.filter((item) => /\.zip$/i.test(item.name))) {
      records.push(...(await parseZip(file)));
    }

    if (!records.length) records.push(...(await parseDirectFiles(files)));
    if (!records.length) {
      return NextResponse.json({ error: '请选择 .zip，或同时选择 ad_context.json 和 video.mp4' }, { status: 400 });
    }

    const result = await saveUploadItems(records);
    const page = await readAdsPage({ page: 1, pageSize: 20, sort: 'recent' });
    return NextResponse.json({ imported: result.saved.length, ...page });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '上传失败' }, { status: 500 });
  }
}
