// Server-only DOM extraction with cheerio.
import * as cheerio from 'cheerio';
import type { ImageItem, PageData } from '../types';
import { cleanWs, decodeEntities, stripTags } from '../text';
import { idOf } from '../urls';
import { BLOCK_TAGS, SKIP_TAGS } from '../html-blocks';

function blocksOf(root: any): string[] {
  const blocks: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    const t = cleanWs(buf.join(''));
    buf = [];
    if (t) blocks.push(t);
  };
  const walk = (node: any) => {
    const children = (node && node.children) || [];
    for (const child of children) {
      if (child.type === 'text') {
        buf.push(child.data || '');
        continue;
      }
      if (child.type !== 'tag') continue; // script, style, comment, cdata, directive
      const name = String(child.name || '').toLowerCase();
      if (SKIP_TAGS.has(name)) continue;
      if (name === 'br') {
        flush();
        continue;
      }
      if (BLOCK_TAGS.has(name)) {
        flush();
        walk(child);
        flush();
      } else walk(child);
    }
  };
  walk(root);
  flush();
  return blocks;
}

function abs(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/** /_next/image?url=<encoded>&w=… -> the original image URL */
function unwrapNextImage(src: string): string {
  try {
    const u = new URL(src);
    if (u.pathname.startsWith('/_next/image')) {
      const inner = u.searchParams.get('url');
      if (inner) return new URL(inner, u.origin).toString();
    }
  } catch {
    /* ignore */
  }
  return src;
}

function scriptText(el: any): string {
  return ((el && el.children) || []).map((c: any) => c.data || '').join('');
}

function unescapeJsonish(s: string): string {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\[nrt]/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function collectStrings(node: any, push: (s: string) => void, depth = 0) {
  if (depth > 40 || node === null || node === undefined) return;
  if (typeof node === 'string') {
    if (node.length >= 15) push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const x of node) collectStrings(x, push, depth + 1);
    return;
  }
  if (typeof node === 'object') for (const k of Object.keys(node)) collectStrings(node[k], push, depth + 1);
}

export function extractPage(html: string, baseUrl: string): PageData {
  const $ = cheerio.load(html);

  const titles: string[] = [];
  $('title').each((_i, el) => {
    if ($(el).parents('svg').length) return;
    const t = cleanWs($(el).text());
    if (t) titles.push(t);
  });

  const meta: Record<string, string[]> = {};
  $('meta').each((_i, el) => {
    const a: any = (el as any).attribs || {};
    const key = String(a.name || a.property || a.itemprop || a['http-equiv'] || '')
      .trim()
      .toLowerCase();
    if (!key || a.content === undefined) return;
    (meta[key] = meta[key] || []).push(cleanWs(a.content));
  });

  const htmlLang = cleanWs($('html').attr('lang') || $('html').attr('xml:lang') || '');

  const canonical: string[] = [];
  const canonicalRaw: string[] = [];
  const hreflang: PageData['hreflang'] = [];
  $('link').each((_i, el) => {
    const a: any = (el as any).attribs || {};
    const rel = String(a.rel || '')
      .toLowerCase()
      .split(/\s+/);
    const href = String(a.href || '').trim();
    if (rel.includes('canonical')) {
      canonicalRaw.push(href);
      canonical.push(abs(href, baseUrl));
    }
    if (rel.includes('alternate') && a.hreflang)
      hreflang.push({ lang: String(a.hreflang).trim().toLowerCase().replace(/_/g, '-'), href: abs(href, baseUrl), raw: href });
  });

  const heads = (sel: string) =>
    $(sel)
      .toArray()
      .map((el) => cleanWs($(el).text()))
      .filter(Boolean);

  const bodyEl = $('body').get(0) || $.root().get(0);
  const bodyBlocks = blocksOf(bodyEl);

  const links: { text: string; href: string }[] = [];
  $('a[href]').each((_i, el) => {
    const href = String($(el).attr('href') || '').trim();
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) return;
    links.push({ text: cleanWs($(el).text()), href: abs(href, baseUrl) });
  });

  const images: ImageItem[] = [];
  $('img').each((_i, el) => {
    const src = String($(el).attr('src') || $(el).attr('data-src') || '').trim();
    if (!src || src.startsWith('data:')) return;
    images.push({ src: unwrapNextImage(abs(src, baseUrl)), alt: cleanWs($(el).attr('alt') || '') });
  });

  // report IDs carried by the page itself
  const reportIds: Record<string, string[]> = {};
  const addId = (k: string, v: string) => {
    if (!v) return;
    const arr = (reportIds[k] = reportIds[k] || []);
    if (!arr.includes(v)) arr.push(v);
  };
  addId('final URL', idOf(baseUrl));
  canonical.forEach((u) => addId('canonical', idOf(u)));
  (meta['og:url'] || []).forEach((u) => addId('og:url', idOf(u)));
  const pats = [
    /license-variant\?id=(\d+)/i,
    /\/snapshot\/[^?#]*-(\d+)(?:[/?#]|$)/i,
    /\/toc\/[^?#]*-(\d+)(?:[/?#]|$)/i,
    /\/request-sample\/[^?#]*-(\d+)(?:[/?#]|$)/i,
  ];
  for (const l of links) for (const p of pats) {
    const m = l.href.match(p);
    if (m) addId('page links', m[1]);
  }

  // FAQPage JSON-LD
  const faqLd: { q: string; a: string }[] = [];
  const visit = (node: any, depth = 0) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;
    const t = node['@type'];
    const types = Array.isArray(t) ? t : [t];
    if (types.includes('FAQPage')) {
      const me = node.mainEntity;
      const list = Array.isArray(me) ? me : me ? [me] : [];
      for (const q of list) {
        const a = q && q.acceptedAnswer;
        const at = Array.isArray(a) ? a[0] && a[0].text : a && a.text;
        faqLd.push({ q: stripTags(String((q && q.name) || '')), a: stripTags(String(at || '')) });
      }
    }
    if (node['@graph']) visit(node['@graph'], depth + 1);
  };
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      visit(JSON.parse(scriptText(el)));
    } catch {
      /* invalid JSON-LD */
    }
  });

  // text embedded in Next.js page data (collapsed accordions such as FAQ answers)
  const MAX = 1500000;
  const parts: string[] = [];
  let size = 0;
  const push = (s: string) => {
    if (size > MAX || !s) return;
    const t = stripTags(unescapeJsonish(s));
    if (t.length < 2) return;
    parts.push(t);
    size += t.length;
  };
  $('script').each((_i, el) => {
    const a: any = (el as any).attribs || {};
    if (String(a.type || '').toLowerCase() === 'application/ld+json') return;
    const code = scriptText(el);
    if (!code) return;
    if (a.id === '__NEXT_DATA__') {
      try {
        collectStrings(JSON.parse(code), push);
      } catch {
        /* ignore */
      }
      return;
    }
    const re = /self\.__next_f\.push\(\[\s*\d+\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      try {
        push(JSON.parse(`"${m[1]}"`));
      } catch {
        push(m[1]);
      }
    }
  });
  const dataText = decodeEntities(parts.join('\n')).slice(0, MAX);

  return {
    titles,
    meta,
    htmlLang,
    canonical,
    canonicalRaw,
    hreflang,
    h1: heads('h1'),
    h2: heads('h2'),
    h3: heads('h3'),
    bodyBlocks,
    links: links.slice(0, 2000),
    images: images.slice(0, 400),
    reportIds,
    faqLd,
    dataText,
  };
}
