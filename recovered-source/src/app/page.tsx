'use client';

import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Eye,
  Film,
  Heart,
  LayoutGrid,
  List,
  MessageCircle,
  PlayCircle,
  Search,
  ShieldCheck,
  Share2,
  Sparkles,
  Star,
  TrendingUp,
  Upload,
  Video,
  Wand2,
  X
} from 'lucide-react';
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';

type Risk = 'low' | 'medium' | 'high';
type Scope = 'core' | 'assist' | 'low';
type PageKey = 'library' | 'ai' | 'favorites' | 'detail';
type LibraryView = 'cards' | 'inspect';

type RawAdContext = Record<string, unknown>;

type Ad = {
  id: string;
  video_id?: string;
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
  sourceUrl?: string;
  copywriting?: string;
  market?: string;
  publishedAt?: string;
  playCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  searchKeyword?: string;
  downloadSource?: string;
  rawContext?: RawAdContext;
  videoUrl?: string;
  analysis?: RawAdContext;
  hookImageUrl?: string;
  fullImageUrl?: string;
};

type AdsResponse = {
  ads?: Ad[];
  count?: number;
  page?: number;
  pageSize?: number;
  stats?: {
    total?: number;
    favorite?: number;
  };
  categories?: string[];
  error?: string;
};

const APP_BASE_PATH = '/tiktok-ad-assistant';

const covers = [
  'linear-gradient(135deg,#4b5563,#f59e0b 45%,#111827)',
  'linear-gradient(135deg,#111827,#9ca3af 38%,#ef4444)',
  'linear-gradient(135deg,#1f2937,#d6d3d1 42%,#0f172a)',
  'radial-gradient(circle at 55% 42%,#dbeafe 0 10%,#2563eb 11% 19%,#0f172a 20% 55%,#111827)',
  'linear-gradient(135deg,#0284c7,#ef4444 55%,#0f172a)',
  'linear-gradient(135deg,#111827,#f9a8d4 45%,#fef3c7)',
  'linear-gradient(135deg,#334155,#facc15 42%,#111827)',
  'linear-gradient(135deg,#0f172a,#06b6d4 45%,#f8fafc)',
  'linear-gradient(135deg,#0f172a,#22c55e 45%,#e2e8f0)',
  'linear-gradient(135deg,#7f1d1d,#f97316 45%,#111827)'
];

const fmtPlay = (n: number) => (n >= 10000 ? `${Number((n / 10000).toFixed(n > 1000000 ? 1 : 0))}万` : String(n));
const fmtMetric = (n = 0) => (n >= 100000000 ? `${Number((n / 100000000).toFixed(1))}亿` : n >= 10000 ? `${Number((n / 10000).toFixed(n >= 1000000 ? 1 : 0))}万` : String(n || 0));
const sumBy = (list: Ad[], pick: (ad: Ad) => number | undefined) => list.reduce((total, ad) => total + (pick(ad) || 0), 0);

const rawText = (ad: Ad, key: string, fallback = '') => {
  const value = ad.rawContext?.[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
};

const fmtDate = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
};

const fmtImportLabel = (value?: string) => {
  if (!value) return '未知导入时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `${value} 导入`;
  return `${String(date.getFullYear()).slice(2)}年${date.getMonth() + 1}月${date.getDate()}日${date.getHours()}时导入`;
};

const schemaLabel = (scope: Scope) => {
  if (scope === 'core') return '核心 Schema';
  if (scope === 'assist') return '辅助 Schema';
  return '低优先级品';
};

const riskText = (risk: Risk) => {
  if (risk === 'low') return '低';
  if (risk === 'medium') return '中';
  return '高';
};

const riskClass = (risk: Risk) => {
  if (risk === 'low') return 'text-brand';
  if (risk === 'medium') return 'text-warn';
  return 'text-danger';
};

const scopeClass = (scope: Scope) => {
  if (scope === 'core') return 'border-emerald-200 bg-emerald-50 text-brand';
  if (scope === 'assist') return 'border-blue-200 bg-blue-50 text-blue-600';
  return 'border-orange-200 bg-orange-50 text-warn';
};

const apiUrl = (path: string) => `${APP_BASE_PATH}${path}`;

function applyFavoriteState(list: Ad[]) {
  return list;
}

function QualityMeter({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="quality-bar w-[84px]">
        <span style={{ width: `${score}%` }} />
      </div>
      <span className="font-medium">{score}/100</span>
    </div>
  );
}

function StatCard({
  icon,
  value,
  label,
  tint = 'bg-brandSoft text-brand'
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  tint?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-6 shadow-panel">
      <div className="flex items-center gap-5">
        <div className={`grid h-14 w-14 place-items-center rounded-lg soft-ring ${tint}`}>{icon}</div>
        <div>
          <div className="text-3xl font-semibold">{value}</div>
          <div className="mt-1 text-sm text-muted">{label}</div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="p-10 text-center text-muted">
      <div className="text-sm font-medium">{title}</div>
    </div>
  );
}

export default function Home() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [page, setPage] = useState<PageKey>('library');
  const [previousPage, setPreviousPage] = useState<PageKey>('library');
  const [pageNo, setPageNo] = useState(1);
  const [pageSize] = useState(6);
  const [favFilter, setFavFilter] = useState<'all' | 'core' | 'assist' | 'recent'>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'quality' | 'play' | 'engagement' | 'recent'>('quality');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [libraryView, setLibraryView] = useState<LibraryView>('cards');
  const [openImportGroups, setOpenImportGroups] = useState<Record<string, boolean>>({});
  const [favScopeFilter, setFavScopeFilter] = useState<'all' | 'core' | 'assist'>('all');
  const [detailAdId, setDetailAdId] = useState<string | null>(null);
  const [serverCount, setServerCount] = useState(0);
  const [favoriteTotal, setFavoriteTotal] = useState(0);
  const [serverCategories, setServerCategories] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<{ text: string; tone: 'muted' | 'success' | 'error' } | null>(null);
  const [productName, setProductName] = useState('便携式电动牙刷');
  const [audience, setAudience] = useState('18-35 岁，注重口腔护理的上班族、学生、旅行人群');
  const [sellingPoints, setSellingPoints] = useState('声波震动深度清洁、续航 30 天、IPX7 防水、轻巧便携，美白护龈，多种清洁模式');
  const [platform, setPlatform] = useState('TikTok');
  const [generateStatus, setGenerateStatus] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;
    if (page === 'detail') return () => {
      mounted = false;
    };

    const params = new URLSearchParams();
    const isLibraryCards = page === 'library' && libraryView === 'cards';
    params.set('page', String(isLibraryCards ? pageNo : 1));
    params.set('pageSize', String(isLibraryCards ? pageSize : page === 'ai' ? 20 : 100));
    params.set('sort', sort);
    if (search.trim()) params.set('query', search.trim());
    if (categoryFilter !== 'all') params.set('category', categoryFilter);
    if (page === 'favorites') params.set('favoriteOnly', '1');

    setUploadStatus({ text: '正在读取服务器广告...', tone: 'muted' });
    fetch(apiUrl(`/api/ads?${params.toString()}`), { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as AdsResponse;
        if (!response.ok) throw new Error(data.error || '服务器广告读取失败');
        return data;
      })
      .then((data) => {
        if (!mounted) return;
        const sharedAds = applyFavoriteState(data.ads || []);
        setAds(sharedAds);
        setServerCount(data.count ?? sharedAds.length);
        setFavoriteTotal(data.stats?.favorite ?? sharedAds.filter((ad) => ad.favorite).length);
        setServerCategories(data.categories || []);
        setUploadStatus(data.stats?.total ? { text: `已加载服务器广告 ${data.stats.total} 条`, tone: 'success' } : null);
      })
      .catch((error) => {
        if (!mounted) return;
        setUploadStatus({ text: error instanceof Error ? error.message : '服务器广告读取失败', tone: 'error' });
      });

    return () => {
      mounted = false;
    };
  }, [categoryFilter, libraryView, page, pageNo, pageSize, refreshKey, search, sort]);

  useEffect(() => {
    if (!detailAdId) return;
    let mounted = true;
    fetch(apiUrl(`/api/ads/${encodeURIComponent(detailAdId)}`), { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { ad?: Ad; error?: string };
        if (!response.ok) throw new Error(data.error || '广告详情读取失败');
        return data.ad;
      })
      .then((ad) => {
        if (!mounted || !ad) return;
        const detailedAd = applyFavoriteState([ad])[0];
        setAds((prev) => {
          const found = prev.some((item) => item.id === detailedAd.id);
          if (!found) return [detailedAd, ...prev];
          return prev.map((item) => (item.id === detailedAd.id ? { ...item, ...detailedAd } : item));
        });
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, [detailAdId]);

  useEffect(() => {
    setPageNo(1);
  }, [search, sort, categoryFilter]);

  const favoriteAds = useMemo(() => ads.filter((ad) => ad.favorite), [ads]);
  const categories = useMemo(() => (serverCategories.length ? serverCategories : Array.from(new Set(ads.map((ad) => ad.category).filter(Boolean)))).slice(0, 8), [ads, serverCategories]);

  const filteredAds = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ads
      .filter((ad) => {
        const text = [ad.title, ad.category, ad.id, ad.video_id, ad.brand, ad.copywriting, ad.searchKeyword, ...ad.tags].join(' ').toLowerCase();
        return (
          (!q || text.includes(q)) &&
          (categoryFilter === 'all' || ad.category === categoryFilter)
        );
      })
      .sort((a, b) => {
        if (sort === 'play') return b.play - a.play;
        if (sort === 'engagement') return b.engagement - a.engagement;
        if (sort === 'recent') return b.created - a.created;
        return b.quality - a.quality;
      });
  }, [ads, categoryFilter, search, sort]);

  const pages = Math.max(1, Math.ceil((page === 'library' && libraryView === 'cards' ? serverCount : filteredAds.length) / pageSize));
  const currentAds = filteredAds;
  const detailAd = ads.find((ad) => ad.id === detailAdId) || null;
  const pageNumbers = useMemo(() => {
    if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
    const current = Math.min(pageNo, pages);
    const start = Math.max(1, Math.min(current - 3, pages - 6));
    return Array.from({ length: 7 }, (_, index) => start + index);
  }, [pageNo, pages]);
  const libraryStats = useMemo(() => {
    const totalPlay = sumBy(filteredAds, (ad) => ad.playCount ?? ad.play);
    const totalLikes = sumBy(filteredAds, (ad) => ad.likeCount);
    const totalComments = sumBy(filteredAds, (ad) => ad.commentCount);
    const totalShares = sumBy(filteredAds, (ad) => ad.shareCount);
    const avgEngagement = filteredAds.length ? Number((filteredAds.reduce((total, ad) => total + ad.engagement, 0) / filteredAds.length).toFixed(2)) : 0;
    return { totalPlay, totalLikes, totalComments, totalShares, avgEngagement };
  }, [filteredAds]);
  const importGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; ads: Ad[]; created: number }>();
    filteredAds.forEach((ad) => {
      const date = new Date(ad.uploadedAt || ad.publishedAt || ad.created);
      const created = Number.isNaN(date.getTime()) ? ad.created : date.getTime();
      const key = Number.isNaN(date.getTime())
        ? 'unknown'
        : `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}`;
      const label = fmtImportLabel(ad.uploadedAt || ad.publishedAt);
      const group = groups.get(key) || { key, label, ads: [], created };
      group.ads.push(ad);
      group.created = Math.max(group.created, created);
      groups.set(key, group);
    });
    return Array.from(groups.values()).sort((a, b) => b.created - a.created);
  }, [filteredAds]);

  useEffect(() => {
    if (pageNo > pages) setPageNo(pages);
  }, [pageNo, pages]);

  const visibleFavs = useMemo(() => {
    let list = favoriteAds;
    if (favFilter === 'core') list = list.filter((ad) => ad.scope === 'core');
    if (favFilter === 'assist') list = list.filter((ad) => ad.scope === 'assist');
    if (favFilter === 'recent') list = list.filter((ad) => Date.now() - new Date(ad.uploadedAt).getTime() <= 7 * 24 * 60 * 60 * 1000);
    if (favScopeFilter !== 'all') list = list.filter((ad) => ad.scope === favScopeFilter);
    return list;
  }, [favFilter, favScopeFilter, favoriteAds]);

  const hooks = useMemo(() => {
    const p = productName.trim() || '便携式电动牙刷';
    return [
      [`你知道吗？90% 的人都在用错误的${p.includes('牙刷') ? '牙刷' : '产品'}！`, '3 秒抓住注意力，引发好奇'],
      [`旅行出差必备！这支${p.replace('便携式', '')}比手机还轻！`, '痛点 + 便携卖点，快速共鸣'],
      ['30 天不用充电？我也不信，直到试了它！', '反常识开场，激发观看欲望']
    ];
  }, [productName]);

  const referenceAds = useMemo(() => {
    const product = productName.toLowerCase();
    const refs = ads.filter((ad) => ad.category.includes('口腔') || ad.title.toLowerCase().includes(product) || ad.tags.some((tag) => product.includes(tag)));
    return (refs.length ? refs : ads).slice(0, 3);
  }, [ads, productName]);

  const setActivePage = (nextPage: PageKey) => {
    if (nextPage !== 'detail') setPreviousPage(nextPage);
    setPage(nextPage);
  };

  const openVideo = (id: string) => {
    setPreviousPage(page === 'detail' ? previousPage : page);
    setDetailAdId(id);
    setPage('detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleFavorite = (id: string) => {
    const current = ads.find((ad) => ad.id === id);
    if (!current) return;
    const nextFavorite = !current.favorite;
    setAds((prev) =>
      prev.map((ad) => {
        if (ad.id !== id) return ad;
        return { ...ad, favorite: nextFavorite, favTime: nextFavorite ? '刚刚收藏' : null };
      })
    );
    setFavoriteTotal((value) => Math.max(0, value + (nextFavorite ? 1 : -1)));
    fetch(apiUrl(`/api/ads/${encodeURIComponent(id)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: nextFavorite, favTime: nextFavorite ? '刚刚收藏' : null })
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { ad?: Ad };
        if (!response.ok || !data.ad) throw new Error('收藏状态保存失败');
        setAds((prev) => prev.map((ad) => (ad.id === id ? { ...ad, ...data.ad } : ad)));
      })
      .catch(() => {
        setAds((prev) => prev.map((ad) => (ad.id === id ? { ...ad, favorite: current.favorite, favTime: current.favTime } : ad)));
        setFavoriteTotal((value) => Math.max(0, value + (nextFavorite ? -1 : 1)));
      });
  };

  async function uploadSelectedFiles(files: FileList | null) {
    const isHiddenUploadFile = (file: File) => {
      const name = file.name || '';
      return name === '.DS_Store' || name.startsWith('._') || name.startsWith('.~');
    };
    const list = Array.from(files || []).filter((file) => !isHiddenUploadFile(file));
    if (!list.length) return;

    setUploadStatus({ text: '正在上传到服务器...', tone: 'muted' });
    const formData = new FormData();
    list.forEach((file) => formData.append('files', file, file.name));

    const response = await fetch(apiUrl('/api/ads/upload'), {
      method: 'POST',
      body: formData
    });
    const data = (await response.json().catch(() => ({}))) as AdsResponse & { imported?: number };
    if (!response.ok) {
      throw new Error(data.error || '上传失败');
    }

    if (data.ads) setAds(applyFavoriteState(data.ads));
    if (data.count !== undefined) setServerCount(data.count);
    if (data.stats?.favorite !== undefined) setFavoriteTotal(data.stats.favorite);
    if (data.categories) setServerCategories(data.categories);
    setPageNo(1);
    setPage('library');
    setRefreshKey((value) => value + 1);
    setUploadStatus({ text: `已上传并保存到服务器 ${data.imported || 0} 条广告`, tone: 'success' });
  }

  const onUploadChange = async (event: ChangeEvent<HTMLInputElement>) => {
    try {
      await uploadSelectedFiles(event.target.files);
    } catch (error) {
      setUploadStatus({ text: error instanceof Error ? error.message : '上传失败', tone: 'error' });
    } finally {
      event.target.value = '';
    }
  };

  const onGenerate = () => {
    setGenerateStatus('生成中...');
    setIsGenerating(true);
    setTimeout(() => {
      setGenerateStatus(`已根据 ${platform} 更新建议`);
      setIsGenerating(false);
    }, 500);
  };

  const uploadStatusClass = uploadStatus?.tone === 'success' ? 'text-brand' : uploadStatus?.tone === 'error' ? 'text-danger' : 'text-slate-500';

  return (
    <div className="app-layout grid min-h-screen grid-cols-[218px_1fr]">
      <aside className="app-aside sticky top-0 flex h-screen flex-col border-r border-line bg-white">
        <div className="flex h-[76px] items-center px-7">
          <h1 className="text-[21px] font-semibold tracking-normal">Tiktok广告创意助手</h1>
        </div>
        <nav className="nav-list flex flex-col gap-2 px-5 pt-4">
          <NavButton active={page === 'library' || page === 'detail'} icon={<Video className="h-5 w-5 text-brand" />} label="广告库" onClick={() => setActivePage('library')} />
          <NavButton active={page === 'ai'} icon={<Wand2 className="h-5 w-5 text-violet" />} label="AI 视频建议" onClick={() => setActivePage('ai')} />
          <NavButton active={page === 'favorites'} icon={<Star className="h-5 w-5 text-danger" />} label="收藏夹" onClick={() => setActivePage('favorites')} />
        </nav>
        <div className="mt-auto px-5 pb-7">
          {uploadStatus ? <div className={`mb-4 text-center text-sm font-semibold leading-6 ${uploadStatusClass}`}>{uploadStatus.text}</div> : null}
          <button
            className="flex h-12 w-full items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-600 transition hover:border-blue-300 hover:bg-blue-100"
            title="上传包含多个文件夹的 ZIP，每个文件夹包含 ad_context.json 和 video.mp4"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-5 w-5" />
            上传广告包
          </button>
          <input ref={fileInputRef} className="hidden" type="file" accept=".zip,.json,.mp4,application/zip,application/json,video/mp4" multiple onChange={onUploadChange} />
        </div>
      </aside>

      <main className="min-w-0">
        {page !== 'library' ? (
          <header className="topbar sticky top-0 z-20 border-b border-line bg-white/92 px-6 py-4 backdrop-blur">
            <div className="flex flex-wrap items-center gap-4">
              <label className="relative min-w-[280px] max-w-[520px] flex-1">
                <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                <input
                  className="h-10 w-full rounded-md border border-line bg-white pl-12 pr-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand focus:ring-4 focus:ring-emerald-100"
                  placeholder="搜索广告标题、商品、标签或 ID"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPageNo(1);
                  }}
                />
              </label>
              <select className="h-10 rounded-md border border-line bg-white px-4 text-sm font-semibold outline-none focus:border-brand" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                <option value="quality">质量分降序</option>
                <option value="play">播放量降序</option>
                <option value="engagement">互动率降序</option>
                <option value="recent">最近采集优先</option>
              </select>
            </div>
          </header>
        ) : null}

        {page === 'library' ? (
          <section className="w-full space-y-5 p-5 lg:p-6">
            <div className="library-hero overflow-hidden rounded-lg border border-line bg-white shadow-panel">
              <div className="grid gap-5 p-5 lg:grid-cols-[1.3fr_.7fr] lg:p-6">
                <div>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-brand">服务器广告库</span>
                    <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">OSS 视频存储</span>
                  </div>
                  <h2 className="text-2xl font-semibold">广告库</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">集中查看已上传的 TikTok 爬取素材，播放、点赞、评论等数据来自广告 JSON，视频保存在服务器并同步给团队访问。</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <LibraryStatItem icon={<Video className="h-4 w-4" />} label="当前素材" value={`${serverCount}`} />
                  <LibraryStatItem icon={<Star className="h-4 w-4" />} label="收藏数" value={`${favoriteTotal}`} />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-line bg-white p-4 shadow-panel">
              <div className="mb-4">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold">素材列表</h3>
                    <div className="mt-1 text-sm text-muted">平均互动率 {libraryStats.avgEngagement}% · 分享 {fmtMetric(libraryStats.totalShares)} 次</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className={`grid h-10 w-10 place-items-center rounded-md border transition ${libraryView === 'cards' ? 'border-blue-200 bg-blue-50 text-blue-600' : 'border-line text-slate-500 hover:border-blue-200 hover:text-blue-600'}`}
                      title="卡片列表"
                      onClick={() => setLibraryView('cards')}
                    >
                      <List className="h-5 w-5" />
                    </button>
                    <button
                      className={`grid h-10 w-10 place-items-center rounded-md border transition ${libraryView === 'inspect' ? 'border-blue-200 bg-blue-50 text-blue-600' : 'border-line text-slate-500 hover:border-blue-200 hover:text-blue-600'}`}
                      title="检查视图"
                      onClick={() => setLibraryView('inspect')}
                    >
                      <LayoutGrid className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center gap-3">
                  <select
                      className="h-10 min-w-[150px] rounded-md border border-line bg-white px-4 text-sm font-semibold text-slate-700 outline-none transition hover:border-blue-200 focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
                    value={categoryFilter}
                    onChange={(event) => setCategoryFilter(event.target.value)}
                  >
                    <option value="all">全部品类</option>
                    {categories.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                    <select className="h-10 min-w-[150px] rounded-md border border-line bg-white px-4 text-sm font-semibold outline-none focus:border-brand" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                      <option value="quality">质量分降序</option>
                      <option value="play">播放量降序</option>
                      <option value="engagement">互动率降序</option>
                      <option value="recent">最近采集优先</option>
                    </select>
                  </div>
                  <label className="relative min-w-[260px] max-w-[520px] flex-1 lg:flex-none">
                    <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                    <input
                      className="h-10 w-full rounded-md border border-line bg-white pl-12 pr-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand focus:ring-4 focus:ring-emerald-100"
                      placeholder="搜索广告标题、商品、标签或 ID"
                      value={search}
                      onChange={(event) => {
                        setSearch(event.target.value);
                        setPageNo(1);
                      }}
                    />
                  </label>
                </div>
              </div>

              {libraryView === 'cards' ? (
                <div className="library-list space-y-3">
                  {currentAds.length ? currentAds.map((ad) => <LibraryCard key={ad.id} ad={ad} onOpen={openVideo} onToggleFavorite={toggleFavorite} />) : <EmptyState title="请先上传广告包，上传后会保存在服务器中" />}
                </div>
              ) : (
                <InspectLibraryView
                  groups={importGroups}
                  openGroups={openImportGroups}
                  onToggleGroup={(key) => setOpenImportGroups((value) => ({ ...value, [key]: !(value[key] ?? key === importGroups[0]?.key) }))}
                  onOpen={openVideo}
                  onToggleFavorite={toggleFavorite}
                />
              )}

              {libraryView === 'cards' ? <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm">
                <span className="text-muted">第 {Math.min(pageNo, pages)} / {pages} 页</span>
                <div className="flex items-center gap-2">
                  <button className="grid h-9 w-9 place-items-center rounded-md border border-line text-slate-500 hover:border-blue-200 hover:text-blue-600" title="上一页" onClick={() => setPageNo((value) => Math.max(1, value - 1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <div className="flex gap-2">
                    {pageNumbers.map((pageNumber) => (
                      <button key={pageNumber} className={`h-9 w-9 rounded-md ${Math.min(pageNo, pages) === pageNumber ? 'bg-blue-50 font-semibold text-blue-600' : 'hover:bg-slate-100'}`} onClick={() => setPageNo(pageNumber)}>
                        {pageNumber}
                      </button>
                    ))}
                  </div>
                  <button className="grid h-9 w-9 place-items-center rounded-md border border-line text-slate-500 hover:border-blue-200 hover:text-blue-600" title="下一页" onClick={() => setPageNo((value) => Math.min(pages, value + 1))}>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div> : null}
            </div>
          </section>
        ) : null}

        {page === 'ai' ? (
          <section className="p-5 lg:p-6">
            <div className="rounded-lg border border-line bg-white p-5 shadow-panel">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">输入商品信息，获取 AI 视频建议</h2>
                <span className="text-sm font-medium text-brand">{generateStatus}</span>
              </div>
              <div className="grid gap-4 lg:grid-cols-[1fr_1fr_160px]">
                <div className="space-y-4">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-semibold">商品名称</span>
                    <input className="h-10 w-full rounded-md border border-line px-4 text-sm outline-none focus:border-brand" value={productName} onChange={(event) => setProductName(event.target.value)} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-semibold">目标人群</span>
                    <input className="h-10 w-full rounded-md border border-line px-4 text-sm outline-none focus:border-brand" value={audience} onChange={(event) => setAudience(event.target.value)} />
                  </label>
                </div>
                <div className="space-y-4">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-semibold">核心卖点</span>
                    <textarea className="h-16 w-full resize-none rounded-md border border-line px-4 py-2 text-sm leading-6 outline-none focus:border-brand" value={sellingPoints} onChange={(event) => setSellingPoints(event.target.value)} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-semibold">投放平台</span>
                    <select className="h-10 w-full rounded-md border border-line px-4 text-sm outline-none focus:border-brand" value={platform} onChange={(event) => setPlatform(event.target.value)}>
                      <option>TikTok</option>
                      <option>Instagram Reels</option>
                      <option>YouTube Shorts</option>
                    </select>
                  </label>
                </div>
                <div className="flex items-end">
                  <button className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-brand px-5 text-sm font-semibold text-white shadow-lg shadow-emerald-200 transition hover:bg-emerald-600 disabled:opacity-70" onClick={onGenerate} disabled={isGenerating}>
                    <Wand2 className="h-5 w-5" />
                    生成建议
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_.92fr_1.2fr]">
              <div className="rounded-lg border border-line bg-white p-5 shadow-panel">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                  <Sparkles className="h-5 w-5 text-violet" /> 开头 Hook
                </h3>
                <div className="space-y-3">
                  {hooks.map((hook, index) => (
                    <div key={hook[0]} className="rounded-md border border-line p-4">
                      <div className="flex gap-4">
                        <span className="text-lg font-semibold">{index + 1}</span>
                        <div>
                          <div className="font-semibold">{hook[0]}</div>
                          <div className="mt-1 text-sm text-muted">{hook[1]}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-line bg-white p-5 shadow-panel">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                  <Film className="h-5 w-5 text-violet" /> 视频结构
                </h3>
                <Timeline sellingPoints={sellingPoints} />
              </div>
              <div className="rounded-lg border border-line bg-white p-5 shadow-panel">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                  <Video className="h-5 w-5 text-violet" /> 镜头提示词
                </h3>
                <ShotPrompts />
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-line bg-white p-4 shadow-panel">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold">参考广告推荐</h3>
                <div className="flex gap-2">
                  <button className="grid h-8 w-8 place-items-center rounded-md border border-line hover:border-brand" title="上一组">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button className="grid h-8 w-8 place-items-center rounded-md border border-line hover:border-brand" title="下一组">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                {referenceAds.length ? referenceAds.map((ad) => <ReferenceCard key={ad.id} ad={ad} onOpen={openVideo} />) : <div className="col-span-full"><EmptyState title="上传广告后会出现可参考的素材" /></div>}
              </div>
            </div>
          </section>
        ) : null}

        {page === 'favorites' ? (
          <section className="p-5 lg:p-6">
            <div className="grid gap-4 lg:grid-cols-3">
              <StatCard icon={<Star className="h-8 w-8" />} value={page === 'favorites' ? serverCount : favoriteTotal} label="收藏总数" tint="bg-blue-50 text-blue-600" />
              <StatCard icon={<ShieldCheck className="h-8 w-8" />} value={favoriteAds.filter((ad) => ad.scope === 'core').length} label="核心 Schema" tint="bg-blue-50 text-blue-600" />
              <StatCard icon={<Clock3 className="h-8 w-8" />} value={favoriteAds.filter((ad) => Date.now() - new Date(ad.uploadedAt).getTime() <= 7 * 24 * 60 * 60 * 1000).length} label="最近新增（7 天）" tint="bg-blue-50 text-blue-600" />
            </div>
            <div className="mt-4 rounded-lg border border-line bg-white p-4 shadow-panel">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="mb-3 text-lg font-semibold">收藏夹</h2>
                  <div className="flex flex-wrap gap-3">
                    {[
                      ['all', '全部'],
                      ['core', '核心 Schema'],
                      ['assist', '辅助 Schema'],
                      ['recent', '最近收藏']
                    ].map(([value, label]) => (
                      <button key={value} className={`rounded-md border px-5 py-2 text-sm font-semibold ${favFilter === value ? 'border-blue-200 bg-blue-50 text-blue-600' : 'border-line bg-slate-50 text-slate-600'}`} onClick={() => setFavFilter(value as typeof favFilter)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <select className="h-10 rounded-md border border-line bg-white px-4 text-sm font-semibold outline-none focus:border-brand" value={favScopeFilter} onChange={(event) => setFavScopeFilter(event.target.value as typeof favScopeFilter)}>
                  <option value="all">全部使用范围</option>
                  <option value="core">核心 Schema</option>
                  <option value="assist">辅助 Schema</option>
                </select>
              </div>
              <div className="overflow-x-auto mini-scroll">
                <div className="min-w-[930px]">
                  <div className="fav-grid grid bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
                    <div>广告</div>
                    <div>品类</div>
                    <div>质量分</div>
                    <div>Schema</div>
                    <div>风险</div>
                    <div>收藏时间</div>
                    <div className="text-right">操作</div>
                  </div>
                  {visibleFavs.length ? visibleFavs.map((ad) => <FavoriteRow key={ad.id} ad={ad} onOpen={openVideo} onToggleFavorite={toggleFavorite} />) : <EmptyState title="当前筛选下没有收藏广告" />}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {page === 'detail' && detailAd ? <DetailPage ad={detailAd} onBack={() => setPage(previousPage || 'library')} onClose={() => setPage('library')} /> : null}
      </main>
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={`relative flex h-10 items-center gap-4 rounded-md px-3 text-left text-[15px] font-semibold transition ${active ? 'bg-brandSoft text-blue-600' : 'text-slate-700 hover:bg-slate-50'}`} onClick={onClick}>
      {icon}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

function AdIdentity({ ad, onOpen }: { ad: Ad; onOpen: (id: string) => void }) {
  return (
    <button className="group flex min-w-0 items-center gap-3 text-left" onClick={() => onOpen(ad.id)} title="查看广告详情">
      <div className="relative h-[52px] w-[52px] overflow-hidden rounded-md bg-slate-200 bg-cover bg-center shadow-sm" style={{ background: covers[ad.cover] }}>
        {ad.videoUrl ? <video className="h-full w-full object-cover" src={ad.videoUrl} muted playsInline preload="metadata" /> : null}
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">{ad.duration}</span>
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold transition group-hover:text-blue-600">
          {ad.title}
          <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600">已上传</span>
        </div>
        <div className="mt-1 truncate text-xs text-slate-500 transition group-hover:text-blue-500">
          {ad.id} · {ad.seconds}s
        </div>
      </div>
    </button>
  );
}

function LibraryMetric({ icon, label, value, tone = 'text-slate-950' }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
        {icon}
        {label}
      </div>
      <div className={`text-lg font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function LibraryStatItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-slate-50 px-4 py-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-500">
        <span className="grid h-6 w-6 place-items-center rounded bg-white text-blue-600 shadow-sm">{icon}</span>
        {label}
      </div>
      <div className="text-center text-3xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function InspectLibraryView({
  groups,
  openGroups,
  onToggleGroup,
  onOpen,
  onToggleFavorite
}: {
  groups: { key: string; label: string; ads: Ad[] }[];
  openGroups: Record<string, boolean>;
  onToggleGroup: (key: string) => void;
  onOpen: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}) {
  if (!groups.length) return <EmptyState title="请先上传广告包，上传后会保存在服务器中" />;

  return (
    <div className="space-y-3">
      {groups.map((group, index) => {
        const isOpen = openGroups[group.key] ?? index === 0;
        return (
          <section key={group.key} className="overflow-hidden rounded-lg border border-line bg-white">
            <button className="flex w-full items-center justify-between gap-4 bg-slate-50 px-4 py-3 text-left transition hover:bg-blue-50" onClick={() => onToggleGroup(group.key)}>
              <span className="font-semibold text-slate-950">{group.label}</span>
              <span className="flex items-center gap-3 text-sm font-semibold text-slate-950">
                {group.ads.length}条
                <ChevronRight className={`h-5 w-5 transition ${isOpen ? 'rotate-90 text-blue-600' : 'text-slate-500'}`} />
              </span>
            </button>
            {isOpen ? (
              <div className="max-h-[520px] overflow-y-auto p-4 mini-scroll">
                <div className="inspect-grid">
                  {group.ads.map((ad) => (
                    <InspectAdCard key={ad.id} ad={ad} onOpen={onOpen} onToggleFavorite={onToggleFavorite} />
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function InspectAdCard({ ad, onOpen, onToggleFavorite }: { ad: Ad; onOpen: (id: string) => void; onToggleFavorite: (id: string) => void }) {
  const author = rawText(ad, 'username', ad.brand || 'Uploaded');
  const caption = ad.copywriting || rawText(ad, 'description', ad.title);

  return (
    <article className="rounded-lg border border-line bg-white p-3 transition hover:border-blue-200 hover:shadow-panel">
      <button className="inspect-card-media relative w-full overflow-hidden rounded-md bg-slate-200 bg-cover bg-center text-left" style={{ background: covers[ad.cover] }} onClick={() => onOpen(ad.id)} title="查看广告详情">
        {ad.videoUrl ? <video className="h-full w-full object-cover" src={ad.videoUrl} muted playsInline preload="metadata" /> : null}
        <span className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-1 text-xs font-semibold text-white">{ad.duration}</span>
      </button>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{ad.category}</span>
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-brand">@{author}</span>
      </div>
      <button className="mt-2 block w-full text-left text-sm font-semibold text-slate-950 hover:text-blue-600" onClick={() => onOpen(ad.id)}>
        <span className="line-clamp-1">{ad.title}</span>
      </button>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{caption || '暂无广告文案'}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-md bg-slate-50 p-2 text-xs">
        <div>
          <div className="text-slate-500">播放</div>
          <div className="mt-1 font-semibold text-blue-600">{fmtMetric(ad.playCount ?? ad.play)}</div>
        </div>
        <div>
          <div className="text-slate-500">点赞</div>
          <div className="mt-1 font-semibold text-danger">{fmtMetric(ad.likeCount)}</div>
        </div>
        <div>
          <div className="text-slate-500">评论</div>
          <div className="mt-1 font-semibold text-slate-950">{fmtMetric(ad.commentCount)}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-brand">互动率 {ad.engagement}%</span>
        <div className="flex items-center gap-2">
          <button className="grid h-8 w-8 place-items-center rounded-md border border-line text-slate-500 transition hover:border-amber-200 hover:bg-amber-50 hover:text-amber-500" title={ad.favorite ? '取消收藏' : '收藏'} onClick={() => onToggleFavorite(ad.id)}>
            <Star className={`h-4 w-4 ${ad.favorite ? 'fill-amber-400 text-amber-400' : ''}`} />
          </button>
          <button className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-700" onClick={() => onOpen(ad.id)}>
            <PlayCircle className="h-3.5 w-3.5" />
            查看
          </button>
        </div>
      </div>
    </article>
  );
}

function LibraryCard({ ad, onOpen, onToggleFavorite }: { ad: Ad; onOpen: (id: string) => void; onToggleFavorite: (id: string) => void }) {
  const author = rawText(ad, 'username', ad.brand || 'Uploaded');
  const caption = ad.copywriting || rawText(ad, 'description', ad.title);
  const sourceUrl = ad.sourceUrl || rawText(ad, 'play_address');
  const publishedAt = ad.publishedAt || rawText(ad, 'create_time');

  return (
    <article className="library-card grid gap-4 rounded-lg border border-line bg-white p-4 transition hover:border-blue-200 hover:shadow-panel lg:grid-cols-[108px_1fr_220px]">
      <button className="relative h-[146px] w-[108px] overflow-hidden rounded-md bg-slate-200 bg-cover bg-center text-left shadow-sm" style={{ background: covers[ad.cover] }} onClick={() => onOpen(ad.id)} title="播放视频">
        {ad.videoUrl ? <video className="h-full w-full object-cover" src={ad.videoUrl} muted playsInline preload="metadata" /> : null}
        <span className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-1 text-xs font-semibold text-white">{ad.duration}</span>
      </button>

      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{ad.category}</span>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-brand">@{author}</span>
          <span className="flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">
            <CalendarDays className="h-3.5 w-3.5" />
            {fmtDate(publishedAt)}
          </span>
        </div>
        <button className="block max-w-full text-left text-base font-semibold text-slate-950 transition hover:text-blue-600" onClick={() => onOpen(ad.id)} title="查看广告详情">
          <span className="line-clamp-1">{ad.title}</span>
        </button>
        <p className="mt-2 line-clamp-2 max-w-4xl text-sm leading-6 text-muted">{caption || '暂无广告文案'}</p>

        <div className="mt-4 grid gap-4 rounded-md bg-slate-50 p-3 sm:grid-cols-4">
          <LibraryMetric icon={<Eye className="h-3.5 w-3.5" />} label="播放量" value={fmtMetric(ad.playCount ?? ad.play)} tone="text-blue-600" />
          <LibraryMetric icon={<Heart className="h-3.5 w-3.5" />} label="点赞数" value={fmtMetric(ad.likeCount)} tone="text-danger" />
          <LibraryMetric icon={<MessageCircle className="h-3.5 w-3.5" />} label="评论数" value={fmtMetric(ad.commentCount)} />
          <LibraryMetric icon={<TrendingUp className="h-3.5 w-3.5" />} label="互动率" value={`${ad.engagement}%`} tone="text-brand" />
        </div>

        {ad.tags.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {ad.tags.filter((tag) => tag !== '上传').slice(0, 5).map((tag) => (
              <span key={tag} className="rounded bg-white px-2 py-1 text-xs font-medium text-slate-500 ring-1 ring-line">{tag}</span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-3 lg:flex-col lg:items-end lg:justify-center lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
        <div className="text-left lg:text-right">
          <div className="text-xs font-semibold text-muted">分享数</div>
          <div className="mt-1 flex items-center gap-1.5 text-lg font-semibold text-slate-950 lg:justify-end">
            <Share2 className="h-4 w-4 text-slate-400" />
            {fmtMetric(ad.shareCount)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="grid h-10 w-10 place-items-center rounded-md border border-line text-slate-500 transition hover:border-amber-200 hover:bg-amber-50 hover:text-amber-500" title={ad.favorite ? '取消收藏' : '收藏'} onClick={() => onToggleFavorite(ad.id)}>
            <Star className={`h-5 w-5 ${ad.favorite ? 'fill-amber-400 text-amber-400' : ''}`} />
          </button>
          {sourceUrl ? (
            <a className="grid h-10 w-10 place-items-center rounded-md border border-line text-slate-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600" href={sourceUrl} target="_blank" rel="noreferrer" title="打开 TikTok 来源">
              <ExternalLink className="h-5 w-5" />
            </a>
          ) : null}
          <button className="flex h-10 min-w-[88px] items-center justify-center gap-2 whitespace-nowrap rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700" title="查看详情" onClick={() => onOpen(ad.id)}>
            <PlayCircle className="h-4 w-4" />
            查看
          </button>
        </div>
      </div>
    </article>
  );
}

function LibraryRow({ ad, onOpen, onToggleFavorite }: { ad: Ad; onOpen: (id: string) => void; onToggleFavorite: (id: string) => void }) {
  return (
    <div className="table-grid row-mobile grid items-center border-b border-line px-4 py-3 text-sm last:border-b-0 hover:bg-slate-50">
      <div>
        <AdIdentity ad={ad} onOpen={onOpen} />
      </div>
      <div className="mobile-label" data-label="品类">{ad.category}</div>
      <div className="mobile-label" data-label="播放">{fmtPlay(ad.play)}</div>
      <div className="mobile-label" data-label="互动率">{ad.engagement}%</div>
      <div className="mobile-label" data-label="分享率">{ad.share}%</div>
      <div className="hide-md font-semibold">{ad.quality}</div>
      <div className="hide-md font-semibold">{ad.schema}</div>
      <div className={`hide-md ${riskClass(ad.risk)}`}>{ad.risk}</div>
      <div className="hide-md">
        <button className={`rounded-full border px-3 py-1 text-xs font-semibold ${scopeClass(ad.scope)}`} onClick={() => onOpen(ad.id)}>{schemaLabel(ad.scope)}</button>
      </div>
      <div className="flex justify-end gap-3">
        <button className="text-slate-500 transition hover:text-amber-500" title="收藏" onClick={() => onToggleFavorite(ad.id)}>
          <Star className={`h-5 w-5 ${ad.favorite ? 'fill-amber-400 text-amber-400' : ''}`} />
        </button>
        <button className="text-slate-500 transition hover:text-brand" title="播放" onClick={() => onOpen(ad.id)}>
          <PlayCircle className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

function FavoriteRow({ ad, onOpen, onToggleFavorite }: { ad: Ad; onOpen: (id: string) => void; onToggleFavorite: (id: string) => void }) {
  return (
    <div className="fav-grid row-mobile grid items-center border-b border-line px-4 py-3 text-sm last:border-b-0 hover:bg-slate-50">
      <div>
        <AdIdentity ad={ad} onOpen={onOpen} />
      </div>
      <div className="mobile-label" data-label="品类">{ad.category}</div>
      <div className="mobile-label" data-label="质量分"><QualityMeter score={ad.quality} /></div>
      <div className="mobile-label" data-label="Schema">
        <button className={`rounded-full border px-3 py-1 text-xs font-semibold ${scopeClass(ad.scope)}`} onClick={() => onOpen(ad.id)}>{schemaLabel(ad.scope)}</button>
      </div>
      <div className={`mobile-label ${riskClass(ad.risk)}`} data-label="风险">{ad.risk}</div>
      <div className="mobile-label" data-label="收藏时间">{ad.favTime || '-'}</div>
      <div className="flex justify-end gap-3">
        <button className="text-amber-400" title="取消收藏" onClick={() => onToggleFavorite(ad.id)}>
          <Star className="h-5 w-5 fill-amber-400" />
        </button>
        <button className="text-slate-500 hover:text-blue-600" title="播放" onClick={() => onOpen(ad.id)}>
          <PlayCircle className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

function Timeline({ sellingPoints }: { sellingPoints: string }) {
  const firstPoint = sellingPoints.split(/[，,、]/).find(Boolean) || '产品卖点';
  const steps = [
    ['0-3s', '开头 Hook', '痛点/反常识开场，吸引注意力'],
    ['3-7s', '产品展示', '外观展示 + 便携场景（包包/旅行）'],
    ['7-15s', '功能卖点', `${firstPoint}、防水、续航、模式切换`],
    ['15-25s', '使用效果/对比', '使用前后对比，结果更清晰可见'],
    ['25-30s', '行动号召（CTA）', '限时优惠 + 立即下单']
  ];

  return (
    <div>
      {steps.map((step, index) => (
        <div key={step[0]} className="grid grid-cols-[18px_70px_1fr] gap-3">
          <div className="relative flex justify-center">
            <span className="mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-brand bg-white" />
            {index < steps.length - 1 ? <span className="absolute bottom-0 top-5 w-px bg-emerald-200" /> : null}
          </div>
          <div className="text-sm text-slate-600">{step[0]}</div>
          <div className="pb-4">
            <div className="text-sm font-semibold">{step[1]}</div>
            <div className="mt-1 text-sm text-muted">{step[2]}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ShotPrompts() {
  const shots = [
    ['产品全景展示', '极简背景，产品整体外观旋转展示，光影干净', covers[7]],
    ['便携场景', '放入化妆包/背包，旅行、健身房等场景', covers[9]],
    ['功能特写', '细节特写 + 关键效果展示，微距镜头', covers[8]],
    ['对比效果', '使用前后对比，结果更直观', covers[5]],
    ['生活方式收尾', '自然微笑，清新口气，搭配 CTA 文案', covers[0]]
  ];

  return (
    <div className="space-y-2">
      {shots.map((shot) => (
        <div key={shot[0]} className="flex items-center gap-3 rounded-md border border-line p-2">
          <div className="h-12 w-16 rounded bg-cover bg-center" style={{ background: shot[2] }} />
          <div>
            <div className="text-sm font-semibold">{shot[0]}</div>
            <div className="text-xs text-muted">{shot[1]}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReferenceCard({ ad, onOpen }: { ad: Ad; onOpen: (id: string) => void }) {
  return (
    <div className="grid grid-cols-[92px_1fr_36px] gap-3 rounded-md border border-line p-3">
      <div className="relative h-[120px] rounded-md bg-cover bg-center" style={{ background: covers[ad.cover] }}>
        {ad.videoUrl ? <video className="h-full w-full rounded-md object-cover" src={ad.videoUrl} muted playsInline preload="metadata" /> : null}
        <span className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-1 text-xs text-white">{ad.duration}</span>
      </div>
      <div className="min-w-0">
        <div className="truncate font-semibold">{ad.title}</div>
        <div className="mt-2 text-sm text-muted">{ad.brand}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-brand">Quality {ad.quality}</span>
          <span className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-600">Schema {ad.schema >= 80 ? '高分' : '中分'}</span>
        </div>
        <button className="mt-4 h-9 w-full rounded-md border border-line text-sm font-semibold hover:border-brand hover:text-brand" onClick={() => onOpen(ad.id)}>
          查看详情
        </button>
      </div>
      <button className="self-end text-slate-600 hover:text-brand" title="播放" onClick={() => onOpen(ad.id)}>
        <PlayCircle className="h-8 w-8" />
      </button>
    </div>
  );
}

const objectFrom = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as RawAdContext) : {});
const arrayFrom = (value: unknown) => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object').map((item) => item as RawAdContext) : []);
const textField = (source: RawAdContext, key: string, fallback = '') => {
  const value = source[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
};
const listField = (source: RawAdContext, key: string) => {
  const value = source[key];
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
};

function DetailPage({ ad, onBack, onClose }: { ad: Ad; onBack: () => void; onClose: () => void }) {
  const analysis = objectFrom(ad.analysis);
  const hook = objectFrom(analysis.hook);
  const opening = objectFrom(analysis.opening_hook_deep_analysis);
  const openingTimeline = arrayFrom(opening.timeline);
  const structure = arrayFrom(analysis.video_structure_deep_analysis);
  const productType = textField(analysis, 'product_type', ad.category);
  const frameLabels = [textField(hook, 'primary_hook', 'Hook'), textField(hook, 'product_entry_type', '产品进入'), textField(hook, 'reveal_timing', '卖点揭示')];
  const times = ['00:01', '00:00', '00:10', '00:14', '00:10'];
  const hookDetails = [
    ['product_type', productType],
    ['primary_hook', textField(hook, 'primary_hook')],
    ['secondary_hooks', listField(hook, 'secondary_hooks').join('、')],
    ['product_entry_type', textField(hook, 'product_entry_type')],
    ['reveal_timing', textField(hook, 'reveal_timing')],
    ['attention_mechanism', textField(hook, 'attention_mechanism')],
    ['viewer_question', textField(hook, 'viewer_question')],
    ['hook_strength', textField(hook, 'hook_strength')],
    ['confidence', textField(hook, 'confidence')]
  ].filter((item): item is [string, string] => Boolean(item[1]));
  const openingFields = [
    ['summary', textField(opening, 'summary')],
    ['hook_completion_point', textField(opening, 'hook_completion_point')],
    ['strengths', textField(opening, 'strengths')],
    ['weaknesses', textField(opening, 'weaknesses')]
  ].filter((item): item is [string, string] => Boolean(item[1]));
  const uploadedFields = [
    ['video_id', ad.video_id || ad.id],
    ['文案', ad.copywriting],
    ['来源链接', ad.sourceUrl],
    ['市场', ad.market || ad.brand],
    ['发布时间', ad.publishedAt || '-'],
    ['视频时长', `${ad.seconds || 0}秒`],
    ['播放量', String(ad.playCount ?? ad.play ?? 0)],
    ['点赞数', String(ad.likeCount ?? 0)],
    ['评论数', String(ad.commentCount ?? 0)],
    ['分享数', String(ad.shareCount ?? 0)],
    ['搜索关键词', ad.searchKeyword || '-'],
    ['下载来源', ad.downloadSource || '-']
  ];

  return (
    <section className="p-5 lg:p-6">
      <div className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <button className="mt-1 grid h-9 w-9 place-items-center rounded-md hover:bg-slate-100" title="返回" onClick={onBack}>
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-semibold">{ad.title}</h2>
              <p className="mt-1 text-sm text-muted">
                {ad.id} · {ad.category}
                {ad.uploaded ? ' · 已上传保存' : ''}
                {ad.sourceUrl ? (
                  <>
                    {' · '}
                    <a className="text-blue-600 underline underline-offset-2" href={ad.sourceUrl} target="_blank" rel="noreferrer">
                      来源链接
                    </a>
                  </>
                ) : null}
              </p>
            </div>
          </div>
          <button className="grid h-9 w-9 place-items-center rounded-md border border-line text-slate-600 hover:border-blue-300 hover:text-blue-600" title="关闭" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="detail-frame grid overflow-hidden rounded-md lg:grid-cols-5">
          {ad.videoUrl ? (
            <div className="col-span-full grid bg-black lg:grid-cols-[320px_1fr]">
              <video className="h-[360px] w-full bg-black object-contain" src={ad.videoUrl} controls playsInline preload="metadata" />
              <div className="flex flex-col justify-center p-8 text-white">
                <div className="mb-3 text-sm text-white/60">上传视频预览</div>
                <div className="text-2xl font-semibold">{ad.title}</div>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-white/75">{ad.copywriting || '该素材来自上传包，已保存 ad_context.json 与 video.mp4。'}</p>
              </div>
            </div>
          ) : (
            frameLabels.map((label, index) => (
              <div key={label + index} className="frame-card flex items-start justify-center p-5 text-center text-lg font-bold text-white" data-time={times[index]} style={{ background: covers[(ad.cover + index) % covers.length] }}>
                <span className="rounded bg-black/25 px-2 py-1 drop-shadow">{label}</span>
              </div>
            ))
          )}
        </div>

        <div className="mt-5 rounded-md border border-line bg-slate-50 p-4">
          <h3 className="mb-3 text-lg font-semibold">上传数据</h3>
          <div className="grid gap-3 lg:grid-cols-3">
            {uploadedFields.map(([label, value]) => (
              <div key={label} className={label === '文案' || label === '来源链接' ? 'lg:col-span-3' : ''}>
                <div className="text-xs font-semibold text-muted">{label}</div>
                {label === '来源链接' && value && value !== '-' ? (
                  <a className="mt-1 block break-all text-sm font-medium text-blue-600 underline underline-offset-2" href={value} target="_blank" rel="noreferrer">
                    {value}
                  </a>
                ) : (
                  <div className="mt-1 break-words text-sm font-medium text-slate-800">{value || '-'}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-7">
          <h3 className="mb-4 text-lg font-semibold">1. 前 3 秒钩子分析</h3>
          <div className="grid gap-5 lg:grid-cols-[1.05fr_1.1fr]">
            <div>
              {ad.hookImageUrl ? (
                <img className="w-full rounded-md border border-line bg-slate-100 object-cover" src={ad.hookImageUrl} alt="前 3 秒 hook 抽帧分析图" />
              ) : (
                <div className="grid gap-2 sm:grid-cols-3">
                  {[0, 1, 2].map((item) => (
                    <div key={item} className="relative min-h-[180px] rounded-md bg-cover bg-center" style={{ background: covers[(ad.cover + item + 2) % covers.length] }}>
                      <div className="absolute inset-x-3 top-5 text-center text-lg font-bold text-white drop-shadow">{frameLabels[item] || 'Hook'}</div>
                      <span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-xs font-semibold text-white">{times[item]}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-4">
              <div className="grid overflow-hidden rounded-md border border-line sm:grid-cols-2">
                {hookDetails.map((item, index) => (
                  <div key={item[0]} className={`p-4 ${index < hookDetails.length - 2 ? 'border-b border-line' : ''} ${index % 2 === 0 ? 'sm:border-r' : ''}`}>
                    <div className="font-semibold">{item[0]}</div>
                    <p className="mt-1 text-sm leading-6 text-muted">{item[1]}</p>
                  </div>
                ))}
              </div>
              {openingFields.length ? (
                <div className="grid overflow-hidden rounded-md border border-line sm:grid-cols-2">
                  {openingFields.map((item, index) => (
                    <div key={item[0]} className={`p-4 ${index < openingFields.length - 2 ? 'border-b border-line' : ''} ${index % 2 === 0 ? 'sm:border-r' : ''}`}>
                      <div className="font-semibold">{item[0]}</div>
                      <p className="mt-1 text-sm leading-6 text-muted">{item[1]}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-7 border-t border-line pt-5">
          <h3 className="mb-4 text-lg font-semibold">2. 视频结构分析</h3>
          <div className="overflow-hidden rounded-lg border border-line bg-white">
            <div className="grid lg:grid-cols-[minmax(360px,.95fr)_minmax(420px,1.05fr)]">
              <div className="bg-slate-50 p-4 lg:border-r lg:border-line">
                <div className="text-sm font-semibold text-slate-600">完整视频抽帧</div>
                <div className="mt-3 overflow-hidden rounded-md border border-line bg-white">
                  {ad.fullImageUrl ? (
                    <img className="w-full bg-slate-100 object-contain" src={ad.fullImageUrl} alt="完整视频抽帧分析图" />
                  ) : (
                    <div className="p-8 text-center text-sm text-muted">暂无完整抽帧图</div>
                  )}
                </div>
              </div>

              <div className="p-4">
                {openingTimeline.length ? (
                  <div className="mb-5">
                    <div className="mb-3 text-sm font-semibold text-slate-600">开头 Hook 时间线</div>
                    <div className="grid gap-3 xl:grid-cols-2">
                      {openingTimeline.map((item, index) => (
                        <div key={`${textField(item, 'time')}-${index}`} className="rounded-md border border-line bg-slate-50 p-4">
                          <div className="mb-2 inline-flex rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-600">{textField(item, 'time', `片段 ${index + 1}`)}</div>
                          {textField(item, 'visual') ? <p className="text-sm leading-6 text-slate-800">{textField(item, 'visual')}</p> : null}
                          {textField(item, 'function') ? <p className="mt-1 text-sm leading-6 text-muted">{textField(item, 'function')}</p> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {structure.length ? (
                  <div>
                    <div className="mb-3 text-sm font-semibold text-slate-600">完整视频结构</div>
                    <div className="relative space-y-4 pl-6 before:absolute before:bottom-2 before:left-2 before:top-2 before:w-px before:bg-blue-100">
                      {structure.map((item, index) => (
                        <div key={`${textField(item, 'time')}-${index}`} className="relative rounded-md border border-line bg-white p-4 shadow-sm">
                          <span className="absolute -left-[23px] top-5 h-3 w-3 rounded-full border-2 border-blue-500 bg-white" />
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                            <div className="font-semibold">{textField(item, 'segment', `结构段 ${index + 1}`)}</div>
                            <span className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-600">{textField(item, 'time', '-')}</span>
                          </div>
                          <p className="text-sm leading-6 text-slate-700">{textField(item, 'visual_action', '-')}</p>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            {textField(item, 'viewer_motivation') ? (
                              <div className="rounded bg-slate-50 p-3">
                                <div className="text-xs font-semibold text-muted">观众动机</div>
                                <div className="mt-1 text-sm text-slate-700">{textField(item, 'viewer_motivation')}</div>
                              </div>
                            ) : null}
                            {textField(item, 'sales_function') ? (
                              <div className="rounded bg-slate-50 p-3">
                                <div className="text-xs font-semibold text-muted">销售功能</div>
                                <div className="mt-1 text-sm text-slate-700">{textField(item, 'sales_function')}</div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
                            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
