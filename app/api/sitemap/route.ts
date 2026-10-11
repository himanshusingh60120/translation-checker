import { NextResponse } from 'next/server';
import { assertAllowed, fetchWithRetry } from '@/lib/server/fetcher';
import { decodeEntities } from '@/lib/text';
import { idOf } from '@/lib/urls';
import { KNOWN_SITE_LANGS } from '@/lib/languages';
import type { SitemapEntry, SitemapInfo, SitemapResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function locsOf(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(decodeEntities(m[1].trim()));
  return out;
}

function urlsOf(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  const re = /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const loc = /<loc>\s*([\s\S]*?)\s*<\/loc>/i.exec(m[1]);
    if (!loc) continue;
    const lm = /<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i.exec(m[1]);
    out.push({ loc: decodeEntities(loc[1].trim()), lastmod: lm ? lm[1].trim() : undefined });
  }
  return out;
}

/** /fr/sitemap-reports.xml -> "fr"; /sitemap-reports.xml -> "en" */
function langOfSitemap(u: string): string {
  try {
    const segs = new URL(u).pathname.split('/').filter(Boolean);
    return segs.length >= 2 ? segs[segs.length - 2].toLowerCase() : 'en';
  } catch {
    return 'en';
  }
}

function pathOf(u: string): string {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
}

async function readSitemaps(indexUrl: string, ids: Set<string>, pattern: RegExp): Promise<SitemapResult & { otherSitemaps: string[] }> {
  const notes: string[] = [];
  const idx = await fetchWithRetry(indexUrl);
  let children: string[] = [];
  if (idx.status === 200 && /<sitemapindex/i.test(idx.body)) children = locsOf(idx.body);
  let reportMaps = children.filter((u) => pattern.test(pathOf(u)));
  if (!reportMaps.length) {
    const origin = new URL(indexUrl).origin;
    reportMaps = [`${origin}/sitemap-reports.xml`, ...KNOWN_SITE_LANGS.map((l) => `${origin}/${l}/sitemap-reports.xml`)];
    notes.push(
      idx.status === 200
        ? 'No report sitemaps found in the index – using the default locations'
        : `Sitemap index returned ${idx.status === null ? idx.error : 'HTTP ' + idx.status} – using the default locations`,
    );
  }

  const results = await Promise.all(
    reportMaps.map(async (u) => {
      try {
        assertAllowed(u);
      } catch (e: any) {
        return { u, lang: langOfSitemap(u), r: null as any, err: e.message as string };
      }
      return { u, lang: langOfSitemap(u), r: await fetchWithRetry(u), err: '' };
    }),
  );

  const sitemaps: SitemapInfo[] = [];
  const entries: Record<string, Record<string, SitemapEntry[]>> = {};
  for (const x of results) {
    if (!x.r) {
      sitemaps.push({ lang: x.lang, url: x.u, status: null, count: 0, error: x.err });
      continue;
    }
    const urls = x.r.status === 200 ? urlsOf(x.r.body) : [];
    sitemaps.push({
      lang: x.lang,
      url: x.u,
      status: x.r.status,
      count: urls.length,
      error: x.r.error || (x.r.status !== 200 ? `HTTP ${x.r.status}` : undefined),
    });
    if (!ids.size) continue;
    for (const e of urls) {
      const id = idOf(e.loc);
      if (!id || !ids.has(id)) continue;
      const byLang = (entries[id] = entries[id] || {});
      (byLang[x.lang] = byLang[x.lang] || []).push(e);
    }
  }
  const languages = Array.from(new Set(sitemaps.filter((s) => s.status === 200).map((s) => s.lang)));
  return {
    index: indexUrl,
    indexStatus: idx.status,
    fetchedAt: new Date().toISOString(),
    sitemaps,
    languages,
    entries,
    notes,
    otherSitemaps: children.filter((u) => !reportMaps.includes(u)),
  };
}

async function handle(indexUrl: string, idsIn: unknown[], patternIn?: string) {
  try {
    assertAllowed(indexUrl);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  let pattern: RegExp;
  try {
    pattern = new RegExp(patternIn || 'sitemap-reports\\.xml$', 'i');
  } catch {
    return NextResponse.json({ error: 'Invalid pattern' }, { status: 400 });
  }
  const ids = new Set<string>(idsIn.map((x) => String(x).trim()).filter(Boolean));
  return NextResponse.json(await readSitemaps(indexUrl, ids, pattern));
}

/** POST { indexUrl, ids: ["3042", ...], pattern? } -> sitemap entries for those report IDs in every language */
export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* defaults */
  }
  return handle(String(body.indexUrl || 'https://www.kingsresearch.com/sitemap.xml'), Array.isArray(body.ids) ? body.ids : [], body.pattern);
}

/** GET /api/sitemap?ids=3042,3015 – debugging */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  return handle(sp.get('index') || 'https://www.kingsresearch.com/sitemap.xml', (sp.get('ids') || '').split(','), sp.get('pattern') || undefined);
}
