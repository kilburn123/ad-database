import { Readable } from 'stream';
import { NextResponse } from 'next/server';
import { createVideoStream, getRemoteVideoUrl, statVideo } from '@/lib/server-ads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = {
  params: {
    id: string;
  };
};

export async function GET(request: Request, { params }: Params) {
  try {
    const id = decodeURIComponent(params.id);
    const remoteUrl = await getRemoteVideoUrl(id);
    if (remoteUrl) return NextResponse.redirect(remoteUrl, 302);

    const fileStat = await statVideo(id);
    const range = request.headers.get('range');

    if (range) {
      const match = range.match(/bytes=(\d+)-(\d*)/);
      if (!match) return new NextResponse(null, { status: 416 });

      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : fileStat.size - 1;
      if (start >= fileStat.size || end >= fileStat.size) return new NextResponse(null, { status: 416 });

      const stream = await createVideoStream(id, start, end);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${fileStat.size}`,
          'Content-Length': String(end - start + 1),
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      });
    }

    const stream = await createVideoStream(id);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(fileStat.size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  } catch {
    return NextResponse.json({ error: '视频不存在' }, { status: 404 });
  }
}
