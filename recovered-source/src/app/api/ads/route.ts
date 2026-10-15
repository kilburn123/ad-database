import { NextResponse } from 'next/server';
import { readAdsPage, upsertAdPayload } from '@/lib/server-ads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const result = await readAdsPage({
    page: Number(searchParams.get('page') || 1),
    pageSize: Number(searchParams.get('pageSize') || 20),
    query: searchParams.get('query') || '',
    category: searchParams.get('category') || '',
    sort: (searchParams.get('sort') || 'quality') as 'quality' | 'play' | 'engagement' | 'recent',
    favoriteOnly: searchParams.get('favoriteOnly') === '1'
  });

  return NextResponse.json(result);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ad = await upsertAdPayload(body);
    return NextResponse.json({ ad }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '创建广告失败' }, { status: 500 });
  }
}
