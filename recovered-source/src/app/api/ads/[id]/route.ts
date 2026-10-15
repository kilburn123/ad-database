import { NextResponse } from 'next/server';
import { deleteAd, readAdDetail, updateAd, upsertAdPayload } from '@/lib/server-ads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = {
  params: {
    id: string;
  };
};

export async function GET(_request: Request, { params }: Params) {
  const ad = await readAdDetail(decodeURIComponent(params.id));
  if (!ad) return NextResponse.json({ error: '广告不存在' }, { status: 404 });
  return NextResponse.json({ ad });
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ad = await updateAd(decodeURIComponent(params.id), await request.json());
    if (!ad) return NextResponse.json({ error: '广告不存在' }, { status: 404 });
    return NextResponse.json({ ad });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '更新广告失败' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const id = decodeURIComponent(params.id);
    const ad = await upsertAdPayload({ ...(await request.json()), id });
    return NextResponse.json({ ad });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '保存广告失败' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const deleted = await deleteAd(decodeURIComponent(params.id));
  if (!deleted) return NextResponse.json({ error: '广告不存在' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
