import { NextResponse } from 'next/server';
import { assertAllowed, fetchWithRetry } from '@/lib/server/fetcher';
import { extractPage } from '@/lib/server/extract';
import type { InspectResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KEEP_HEADERS = ['content-type', 'x-robots-tag', 'last-modified', 'cache-control', 'server', 'x-vercel-cache', 'cf-cache-status', 'age'];

async function inspect(url: string): Promise<InspectResult> {
  const r = await fetchWithRetry(url);
  const headers: Record<string, string> = {};
  for (const k of KEEP_HEADERS) if (r.headers[k]) headers[k] = r.headers[k];
  const out: InspectResult = { requestedUrl: url, finalUrl: r.finalUrl, status: r.status, chain: r.chain, error: r.error, headers, ms: r.ms };
  const ctype = r.headers['content-type'] || 'text/html';
  if (r.body && r.status !== null && r.status < 400 && /html|xml/i.test(ctype)) {
    try {
      out.page = extractPage(r.body, r.finalUrl);
    } catch (e: any) {
      out.error = `HTML parse error: ${(e && e.message) || e}`;
    }
  }
  return out;
}

/** POST { url } -> InspectResult (status, redirect chain, extracted DOM fields) */
export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const url = String((body && body.url) || '');
  try {
    assertAllowed(url);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  return NextResponse.json(await inspect(url));
}

/** GET /api/inspect?url=… – handy for debugging a single page in the browser */
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get('url') || '';
  try {
    assertAllowed(url);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  return NextResponse.json(await inspect(url));
}
