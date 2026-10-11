import type { AuditRow, FieldCheck, InspectResult, PageData, Settings, SitemapResult, SourceRecord, Status } from './types';
import { worst } from './types';
import { hrefCode, type RowPlan } from './plan';
import { bestMatch, compareText, guessLatin, isCJK, isLatinLang, norm, numberKey, scriptShare, similarity, wordDiff } from './text';
import { hostOf, idOf, langOfUrl, normUrl, safeUrl, slugOf, stripLang, urlsEqual, urlsLoose } from './urls';
import { langName } from './languages';

/*
 * Translation file = source of truth. Live HTML = implementation being verified.
 * Each check returns FieldCheck(s): Source File Value | Live HTML Value | PASS / FAIL / WARNING / NOT FOUND.
 */

const SOFT404 = /\b404\b|not\s+found|nicht\s+gefunden|introuvable|no\s+encontrad|não\s+encontrad|bulunamad|не\s+найден|見つかりません|找不到|찾을\s*수\s*없/i;
const PERIOD_RE = /^[\s,，、:;：；.\-–—]*\(?\d{4}\s*[-–—]\s*\d{2,4}\)?\s*$/;
const PERIOD_TAIL = /[\s,，、:;：；.\-–—]*\(?\d{4}\s*[-–—]\s*\d{2,4}\)?\s*$/;

const short = (v: unknown, n = 1500): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return s.length > n ? s.slice(0, n) + '…' : s;
};
const join = (...parts: (string | undefined | null | false)[]) => parts.filter(Boolean).join('; ');

interface Ctx {
  plan: RowPlan;
  rec: SourceRecord;
  lang: string;
  r?: InspectResult;
  page?: PageData;
  en?: PageData;
  expectedUrl: string;
  englishUrl: string;
  hreflang: Record<string, string>;
  settings: Settings;
  langs: Set<string>;
  siblings: SourceRecord[];
}

function F(check: string, field: string, source = '', live = '', status: Status = 'N/A', extra: Partial<FieldCheck> = {}): FieldCheck {
  return { check, field, source: short(source), live: short(live), status, ...extra };
}

function ok(c: Ctx): boolean {
  return !!(c.r && c.page && c.r.status !== null && c.r.status >= 200 && c.r.status < 300);
}

function why(c: Ctx): string {
  const r = c.r;
  if (!r) return 'Live page was not fetched (no expected URL)';
  if (r.status === null) return `Live page could not be retrieved (${r.error || 'error'})`;
  if (r.status >= 300) return `Live page not available (HTTP ${r.status})`;
  if (!r.page) return `Live page HTML could not be parsed${r.error ? ` (${r.error})` : ''}`;
  return r.error || '';
}

export function chainText(r: InspectResult): string {
  const parts = r.chain.map((h) => `${h.status} ${h.url}`);
  if (r.status !== null) parts.push(`${r.status} ${r.finalUrl}`);
  else if (r.error) parts.push(r.error);
  return parts.join(' → ');
}

function urlDiff(expected: string, actual: string, c: Ctx): string {
  if (!actual) return 'no URL';
  if (c.englishUrl && urlsLoose(actual, c.englishUrl) && !urlsLoose(expected, c.englishUrl)) return 'points to the English page';
  const out: string[] = [];
  const e = safeUrl(expected);
  const a = safeUrl(actual);
  if (e && a && hostOf(expected) !== hostOf(actual)) out.push(`host ${a.host}`);
  const el = langOfUrl(expected, c.langs);
  const al = langOfUrl(actual, c.langs);
  if (el !== al) out.push(`language '${al || 'none'}' (expected '${el || 'none'}')`);
  const ei = idOf(expected);
  const ai = idOf(actual);
  if (ei !== ai) out.push(`report ID '${ai || 'none'}' (expected '${ei || 'none'}')`);
  const es = slugOf(expected);
  const asl = slugOf(actual);
  if (es !== asl) out.push(`slug '${asl || 'none'}' (expected '${es}')`);
  const ed = stripLang(expected, c.langs).replace(/[^/]*$/, '');
  const ad = stripLang(actual, c.langs).replace(/[^/]*$/, '');
  if (ed !== ad) out.push(`path '${ad}' (expected '${ed}')`);
  return out.join('; ') || 'differs from the expected URL';
}

// ---------------------------------------------------------------- HTTP / URL / ID
function checkHttp(c: Ctx): FieldCheck {
  const f = F('HTTP', 'HTTP status', '200 at expected URL');
  const r = c.r;
  if (!r) {
    f.status = 'NOT FOUND';
    f.note = why(c);
    return f;
  }
  f.live = chainText(r);
  if (r.status === null) {
    f.status = 'FAIL';
    f.note = `Request failed: ${r.error}`;
    return f;
  }
  const s = r.status;
  if (s === 404 || s === 410) {
    f.status = 'NOT FOUND';
    f.note = `Page missing (HTTP ${s})`;
  } else if (s >= 500) {
    f.status = 'FAIL';
    f.note = `Server error (HTTP ${s})`;
  } else if (s >= 400) {
    f.status = 'FAIL';
    f.note = s === 403 || s === 429 ? `HTTP ${s} – request blocked (bot protection / rate limit)` : `Client error (HTTP ${s})`;
  } else if (s >= 300) {
    f.status = 'FAIL';
    f.note = `Unresolved redirect (HTTP ${s})`;
  } else if (r.chain.length) {
    f.status = 'WARNING';
    f.note = `Reached after ${r.chain.length} redirect(s)`;
  } else f.status = 'PASS';
  const p = c.page;
  if ((f.status === 'PASS' || f.status === 'WARNING') && p) {
    if (SOFT404.test(`${p.titles[0] || ''} ${p.h1[0] || ''}`)) {
      f.status = 'FAIL';
      f.note = join(f.note, 'Soft 404: HTTP 200 but the page says "not found"');
    } else if (!p.titles.length && !p.h1.length && !p.bodyBlocks.length) {
      f.status = 'FAIL';
      f.note = join(f.note, 'Empty HTML document');
    }
    const refresh = (p.meta['refresh'] || [])[0];
    if (refresh) {
      f.status = worst([f.status, 'WARNING']);
      f.note = join(f.note, `Meta refresh: ${refresh}`);
    }
  }
  return f;
}

function checkUrl(c: Ctx): FieldCheck {
  const f = F('URL Check', 'expected URL → final URL', c.expectedUrl);
  const r = c.r;
  const notes: string[] = [];
  const derived = /^(derived|constructed)/.test(c.plan.urlSource);
  if (derived) notes.push(`Expected URL ${c.plan.urlSource}`);
  if (!r || r.status === null) {
    f.status = 'NOT FOUND';
    f.note = join(...notes, why(c));
    return f;
  }
  f.live = r.finalUrl;
  if (r.status >= 400) {
    f.status = r.status === 404 || r.status === 410 ? 'NOT FOUND' : 'FAIL';
    notes.push(`Expected URL returns HTTP ${r.status}`);
  } else if (urlsEqual(r.finalUrl, c.expectedUrl)) f.status = 'PASS';
  else if (urlsLoose(r.finalUrl, c.expectedUrl)) {
    f.status = 'WARNING';
    notes.push('Differs only in case / trailing slash / scheme / www');
  } else {
    f.status = 'FAIL';
    notes.push(`Redirected – final URL ${urlDiff(c.expectedUrl, r.finalUrl, c)}`);
  }
  if (derived) f.status = worst([f.status, 'WARNING']);
  f.note = notes.join('; ');
  return f;
}

function checkReportId(c: Ctx): FieldCheck {
  const exp = c.rec.reportId;
  const f = F('Report ID', 'report ID', exp);
  if (!ok(c)) {
    f.status = 'NOT FOUND';
    f.note = why(c);
    return f;
  }
  const ids = c.page!.reportIds || {};
  f.live = Object.entries(ids)
    .map(([k, v]) => `${k}: ${v.join(', ')}`)
    .join('; ') || '(none found)';
  const bad: string[] = [];
  for (const k of ['final URL', 'canonical', 'og:url']) {
    const wrong = (ids[k] || []).filter((x) => x !== exp);
    if (wrong.length) bad.push(`${k} (${wrong.join(', ')})`);
  }
  const links = ids['page links'] || [];
  if (links.length && !links.includes(exp)) bad.push(`buy/snapshot/TOC links (${links.join(', ')})`);
  if (bad.length) {
    f.status = 'FAIL';
    f.note = 'Wrong report ID in ' + bad.join('; ');
  } else if ((ids['final URL'] || []).includes(exp)) {
    f.status = 'PASS';
    const others = links.filter((x) => x !== exp);
    if (others.length) {
      f.status = 'WARNING';
      f.note = `Buy/snapshot/TOC links also reference report(s) ${others.join(', ')}`;
    }
  } else if (Object.values(ids).some((v) => v.includes(exp))) {
    f.status = 'WARNING';
    f.note = 'Report ID not in the final URL but present in the page markup';
  } else {
    f.status = 'NOT FOUND';
    f.note = 'Report ID not found in URL or markup';
  }
  return f;
}

// ---------------------------------------------------------------- text fields
type TextKey = 'metaTitle' | 'metaDescription' | 'reportSubtitle' | 'reportTitle';

function crossRef(c: Ctx, key: TextKey, live: string): string {
  const n = norm(live, c.lang);
  if (!n) return '';
  const notes: string[] = [];
  if (c.en) {
    const enVal =
      key === 'metaTitle' ? c.en.titles[0] : key === 'metaDescription' ? (c.en.meta['description'] || [])[0] : key === 'reportSubtitle' ? c.en.h1[0] : c.en.h2[0];
    if (enVal && norm(enVal, c.lang) === n) notes.push('live value is the English text (untranslated)');
  }
  for (const s of c.siblings) {
    if (s.lang === c.lang) continue;
    const v = s[key];
    if (v && norm(v, c.lang) === n) notes.push(`live value is the ${langName(s.lang)} translation`);
  }
  return notes.join('; ');
}

function checkText(c: Ctx, check: string, field: string, src: string | null, liveValues: string[], label: string, key: TextKey, firstOnly = true): FieldCheck {
  const f = F(check, field, src === null ? '(Leave as is)' : src);
  const vals = (liveValues || []).filter(Boolean);
  if (src === null) {
    f.status = 'N/A';
    f.note = 'Marked "Leave as is" in the translation file';
    f.live = short(vals[0] || '');
    return f;
  }
  if (!ok(c)) {
    f.status = 'NOT FOUND';
    f.note = why(c);
    return f;
  }
  if (!src) {
    f.status = 'NOT FOUND';
    f.note = 'Missing in the translation file – cannot verify';
    f.live = short(vals[0] || '');
    return f;
  }
  if (!vals.length) {
    f.status = 'NOT FOUND';
    f.note = `${label} not found in the live HTML`;
    return f;
  }
  let live = vals[0];
  if (!firstOnly) {
    const ns = norm(src, c.lang);
    let best = -1;
    for (const v of vals) {
      const s = similarity(ns, norm(v, c.lang));
      if (s > best) {
        best = s;
        live = v;
      }
    }
  }
  const cmp = compareText(src, live, c.lang);
  const notes: string[] = [cmp.note];
  const distinct = new Set(vals.map((v) => norm(v, c.lang)));
  if (distinct.size > 1) {
    notes.push(`${vals.length} different ${label} values on the page`);
    if (cmp.status === 'PASS') cmp.status = 'WARNING';
  }
  if (cmp.status === 'FAIL') notes.push(crossRef(c, key, live));
  f.live = short(live);
  f.status = cmp.status;
  f.score = cmp.score;
  f.diff = cmp.diff;
  f.note = join(...notes);
  return f;
}

/** Report Title = the long H2 under the H1. The CMS appends the forecast period ("…, 2025-2032"). */
function checkReportTitle(c: Ctx): FieldCheck {
  const src = c.rec.reportTitle;
  const f = F('Report Title (H2)', 'report title (H2 under the H1)', src === null ? '(Leave as is)' : src);
  if (src === null) {
    f.status = 'N/A';
    f.note = 'Marked "Leave as is"';
    return f;
  }
  if (!ok(c)) {
    f.status = 'NOT FOUND';
    f.note = why(c);
    return f;
  }
  if (!src) {
    f.status = 'NOT FOUND';
    f.note = 'Missing in the translation file';
    return f;
  }
  const p = c.page!;
  const cands = [...p.h2, ...p.h1, ...p.h3];
  if (!cands.length) {
    f.status = 'NOT FOUND';
    f.note = 'No H2 on the live page';
    return f;
  }
  const ns = norm(src, c.lang, false).replace(/[\s,，、:;：；.\-–—]+$/, '');
  let bestV = '';
  let bestS = -1;
  for (const v of cands) {
    const nv = norm(v, c.lang, false);
    if (nv === ns || nv.toLowerCase() === ns.toLowerCase()) {
      f.live = v;
      f.score = 100;
      f.status = nv === ns ? 'PASS' : 'WARNING';
      if (f.status === 'WARNING') f.note = 'Differs only in letter case';
      return f;
    }
    if (nv.toLowerCase().startsWith(ns.toLowerCase())) {
      const rest = nv.slice(ns.length);
      if (PERIOD_RE.test(rest)) {
        f.live = v;
        f.score = 100;
        f.status = nv.startsWith(ns) ? 'PASS' : 'WARNING';
        f.note = `CMS appends the forecast period "${rest.replace(/^[\s,，、]+/, '')}"`;
        return f;
      }
    }
    const s = similarity(ns.toLowerCase(), nv.toLowerCase());
    if (s > bestS) {
      bestS = s;
      bestV = v;
    }
  }
  f.live = short(bestV);
  f.score = Math.round(bestS * 10) / 10;
  f.status = 'FAIL';
  f.diff = wordDiff(ns, norm(bestV, c.lang, false).replace(PERIOD_TAIL, ''), isCJK(c.lang));
  f.note = join('Report title on the live page differs from the translation file (closest heading shown)', crossRef(c, 'reportTitle', bestV));
  return f;
}

// ---------------------------------------------------------------- canonical / hreflang
function checkCanonical(c: Ctx): FieldCheck {
  const exp = c.expectedUrl;
  const f = F('Canonical', 'canonical', exp);
  if (!ok(c)) {
    f.status = 'NOT FOUND';
    f.note = why(c);
    return f;
  }
  const p = c.page!;
  if (!p.canonical.length) {
    f.status = 'NOT FOUND';
    f.note = 'No <link rel="canonical"> in the live HTML';
    return f;
  }
  const live = p.canonical[0];
  f.live = p.canonical.join(' | ');
  const st: Status[] = [];
  const notes: string[] = [];
  if (new Set(p.canonical.map((u) => normUrl(u))).size > 1) {
    st.push('FAIL');
    notes.push(`${p.canonical.length} conflicting canonical tags`);
  }
  const raw = p.canonicalRaw[0] || '';
  if (raw && !/^https?:\/\//i.test(raw)) {
    st.push('WARNING');
    notes.push('Canonical is relative – use an absolute URL');
  }
  if (urlsEqual(live, exp)) st.push('PASS');
  else if (urlsLoose(live, exp)) {
    st.push('WARNING');
    notes.push('Differs only in case / trailing slash / scheme / www');
  } else {
    st.push('FAIL');
    notes.push(
      c.englishUrl && urlsLoose(live, c.englishUrl) ? 'Canonical points to the English page – the translation is treated as a duplicate' : `Canonical ${urlDiff(exp, live, c)}`,
    );
  }
  f.status = worst(st);
  f.note = notes.join('; ');
  return f;
}

function checkHreflang(c: Ctx): { summary: FieldCheck; details: FieldCheck[] } {
  const exp = c.hreflang;
  const f = F('Hreflang', 'hreflang set', Object.keys(exp).join(', '));
  const d: FieldCheck[] = [];
  if (!ok(c)) {
    f.status = 'NOT FOUND';
    f.note = why(c);
    return { summary: f, details: d };
  }
  const entries = c.page!.hreflang;
  if (!entries.length) {
    f.status = 'NOT FOUND';
    f.note = 'No hreflang alternate links in the live HTML';
    return { summary: f, details: d };
  }
  const liveMap = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const e of entries) {
    if (liveMap.has(e.lang) && !urlsEqual(liveMap.get(e.lang) || '', e.href)) conflicts.add(e.lang);
    if (!liveMap.has(e.lang)) liveMap.set(e.lang, e.href);
  }
  const selfCode = hrefCode(c.lang, c.settings);
  const missing: string[] = [];
  const wrong: string[] = [];
  for (const [code, url] of Object.entries(exp)) {
    let got = liveMap.get(code);
    let matched = code;
    if (got === undefined && code !== 'x-default') {
      for (const [k, v] of Array.from(liveMap.entries())) {
        if (k !== 'x-default' && k.split('-')[0] === code.split('-')[0]) {
          got = v;
          matched = k;
          break;
        }
      }
    }
    const row = F('Hreflang', `hreflang="${code}"`, url, got || '');
    if (got === undefined) {
      row.status = code === selfCode ? 'FAIL' : 'WARNING';
      row.note = code === selfCode ? 'Self-referencing hreflang missing' : 'Alternate missing';
      missing.push(code);
    } else if (urlsEqual(got, url)) row.status = 'PASS';
    else if (urlsLoose(got, url)) {
      row.status = 'WARNING';
      row.note = 'Differs only in case / trailing slash / scheme / www';
    } else {
      row.status = 'FAIL';
      row.note = urlDiff(url, got, c);
      wrong.push(code);
    }
    if (got !== undefined && matched !== code) row.note = join(row.note, `matched as "${matched}"`);
    d.push(row);
  }
  const st: Status[] = d.map((x) => x.status);
  const notes: string[] = [];
  if (missing.length) notes.push(`Missing: ${missing.join(', ')}`);
  if (wrong.length) notes.push(`Wrong URL: ${wrong.join(', ')}`);
  if (conflicts.size) {
    st.push('FAIL');
    notes.push(`Conflicting duplicates: ${Array.from(conflicts).join(', ')}`);
  }
  const keys = Array.from(liveMap.keys());
  const invalid = keys.filter((k) => !/^(x-default|[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?)$/.test(k));
  if (invalid.length) {
    st.push('WARNING');
    notes.push(`Invalid codes: ${invalid.join(', ')}`);
  }
  const expKeys = Object.keys(exp);
  const extra = keys.filter((k) => !expKeys.includes(k) && !expKeys.some((e) => e !== 'x-default' && e.split('-')[0] === k.split('-')[0]));
  if (extra.length) {
    st.push('WARNING');
    notes.push(`Alternates for languages where the report is not in the sitemap: ${extra.join(', ')}`);
  }
  f.live = `${liveMap.size} alternates: ${keys.join(', ')}`;
  f.status = worst(st);
  f.note = notes.join('; ');
  return { summary: f, details: d };
}

// ---------------------------------------------------------------- content
function crossLanguage(c: Ctx, liveAll: string, ownCoverage: number): string {
  let bestLang = '';
  let bestCov = 0;
  for (const s of c.siblings) {
    if (s.lang === c.lang || !s.bodyBlocks.length) continue;
    const blocks = s.bodyBlocks.filter((b) => b.length >= 20);
    if (!blocks.length) continue;
    const cov = blocks.filter((b) => liveAll.includes(norm(b, c.lang))).length / blocks.length;
    if (cov > bestCov) {
      bestCov = cov;
      bestLang = s.lang;
    }
  }
  if (bestLang && bestCov >= 0.6 && bestCov > ownCoverage)
    return `Live content matches the ${langName(bestLang)} translation (${Math.round(bestCov * 100)}% of its blocks found)`;
  return '';
}

function checkContent(c: Ctx): { summary: FieldCheck; details: FieldCheck[]; cross: string } {
  const f = F('Content', 'description body');
  const details: FieldCheck[] = [];
  const rec = c.rec;
  if (!ok(c)) {
    f.status = 'NOT FOUND';
    f.note = why(c);
    return { summary: f, details, cross: '' };
  }
  if (!rec.bodyBlocks.length) {
    f.status = 'NOT FOUND';
    f.note = 'No body content in the translation file – cannot verify';
    return { summary: f, details, cross: '' };
  }
  const minLen = isCJK(c.lang) ? 8 : 20;
  const filtered = rec.bodyBlocks.filter((b) => norm(b, c.lang).length >= minLen);
  const blocks = filtered.length ? filtered : rec.bodyBlocks;
  const total = blocks.length;
  const p = c.page!;
  const liveAll = norm(p.bodyBlocks.join('\n'), c.lang);
  const liveOrig = new Map<string, string>();
  for (const b of p.bodyBlocks) {
    const n = norm(b, c.lang);
    if (n && !liveOrig.has(n)) liveOrig.set(n, b);
  }
  const liveNorms = Array.from(liveOrig.keys());
  let exact = 0;
  let minor = 0;
  let numeric = 0;
  let missing = 0;
  blocks.forEach((b, i) => {
    const nb = norm(b, c.lang);
    if (liveAll.includes(nb)) {
      exact++;
      return;
    }
    const m = bestMatch(nb, liveNorms);
    let status: Status;
    let note: string;
    if (m.score >= 90) {
      if (numberKey(nb) !== numberKey(m.text)) {
        numeric++;
        status = 'FAIL';
        note = 'Numbers differ between the translation file and the live page';
      } else {
        minor++;
        status = 'WARNING';
        note = 'Minor wording / punctuation difference';
      }
    } else {
      missing++;
      status = 'FAIL';
      note = 'Block from the translation file not found on the live page' + (m.text ? ` (closest match ${Math.round(m.score)}%)` : '');
    }
    if (details.length < 80) {
      const show = m.score >= 50;
      details.push(
        F('Content', `body block #${i + 1}`, b, show ? liveOrig.get(m.text) || m.text : '', status, {
          score: Math.round(m.score * 10) / 10,
          diff: show ? wordDiff(nb, m.text, isCJK(c.lang)) : '',
          note,
        }),
      );
    }
  });

  // headings present as text but not marked up as H2/H3
  const liveHeads = new Set([...p.h2, ...p.h3].map((h) => norm(h, c.lang)));
  let headWarn = 0;
  for (const hd of rec.bodyHeadings) {
    const nh = norm(hd, c.lang);
    if (!nh || liveHeads.has(nh) || !liveAll.includes(nh)) continue;
    headWarn++;
    details.push(F('Content', 'heading (H2/H3)', hd, hd, 'WARNING', { note: 'Text is on the page but not as an H2/H3 heading' }));
  }

  // images (charts) referenced by the body
  const liveImgs = new Set(p.images.map((i) => normUrl(i.src)));
  const liveAlts = new Set(p.images.map((i) => norm(i.alt)));
  let imgWarn = 0;
  for (const im of rec.bodyImages) {
    if (!im.src || liveImgs.has(normUrl(im.src))) continue;
    imgWarn++;
    const altHit = !!im.alt && liveAlts.has(norm(im.alt));
    details.push(
      F('Content', 'image', im.src, '', 'WARNING', {
        note: altHit ? 'An image with the same alt text is on the page, but with a different URL' : 'Image from the translation file not found on the page',
      }),
    );
  }

  f.source = `${total} text blocks${rec.bodyImages.length ? `, ${rec.bodyImages.length} images` : ''} (from ${rec.bodySource})`;
  f.live = `${exact}/${total} exact, ${minor} minor, ${numeric} numeric changes, ${missing} missing`;
  f.score = total ? Math.round((1000 * (exact + minor)) / total) / 10 : 0;
  f.status = missing || numeric ? 'FAIL' : minor ? 'WARNING' : 'PASS';
  if (imgWarn || headWarn) f.status = worst([f.status, 'WARNING']);
  const cross = total && missing / total >= 0.5 ? crossLanguage(c, liveAll, exact / total) : '';
  const notes: string[] = [];
  if (rec.bodySource === 'reading-copy') notes.push('Compared against the reading copy (no HTML body in the files)');
  if (f.status !== 'PASS') notes.push(f.live);
  if (imgWarn) notes.push(`${imgWarn} image(s) not found`);
  if (cross) notes.push(cross);
  f.note = notes.join('; ');
  return { summary: f, details, cross };
}

// ---------------------------------------------------------------- FAQ
function checkFaq(c: Ctx): { summary: FieldCheck; details: FieldCheck[] } {
  const f = F('FAQ', 'FAQ questions & answers');
  const details: FieldCheck[] = [];
  const faqs = c.rec.faqs;
  if (!faqs.length) {
    f.status = 'N/A';
    f.note = 'No FAQ rows in the translation file';
    return { summary: f, details };
  }
  if (!ok(c)) {
    f.status = 'NOT FOUND';
    f.note = why(c);
    return { summary: f, details };
  }
  const p = c.page!;
  const L = c.lang;
  const vis = norm(p.bodyBlocks.join('\n'), L);
  const ld = p.faqLd.map((x) => ({ q: norm(x.q, L), a: norm(x.a, L) }));
  const data = norm(p.dataText, L);
  const where = (t: string): string => {
    const n = norm(t, L);
    if (!n) return '';
    if (vis.includes(n)) return 'visible';
    if (ld.some((x) => x.q === n || x.a.includes(n))) return 'FAQ JSON-LD';
    if (data.includes(n)) return 'page data';
    return '';
  };
  const blockNorms = p.bodyBlocks.map((b) => norm(b, L));
  let qNew = 0;
  let qOld = 0;
  let qMissing = 0;
  let aFound = 0;
  let aMissing = 0;
  const aRows: FieldCheck[] = [];
  for (const q of faqs) {
    const w = where(q.question);
    if (w) {
      qNew++;
      details.push(F('FAQ', `row ${q.rowId} question`, q.question, q.question, 'PASS', { score: 100, note: w === 'visible' ? '' : `found in ${w}` }));
    } else {
      const differsFromOld = !!q.current && norm(q.current, L) !== norm(q.question, L);
      const old = differsFromOld ? where(q.current || '') : '';
      if (old) {
        qOld++;
        details.push(
          F('FAQ', `row ${q.rowId} question`, q.question, q.current || '', 'FAIL', {
            diff: wordDiff(norm(q.question, L), norm(q.current || '', L), isCJK(L)),
            note: 'Live page still shows the OLD question ("Currently reads") – this FAQ row was not updated',
          }),
        );
      } else {
        qMissing++;
        const m = bestMatch(norm(q.question, L), blockNorms);
        details.push(
          F('FAQ', `row ${q.rowId} question`, q.question, m.score >= 50 ? p.bodyBlocks[m.index] || m.text : '', 'FAIL', {
            score: Math.round(m.score * 10) / 10,
            diff: m.score >= 50 ? wordDiff(norm(q.question, L), m.text, isCJK(L)) : '',
            note: 'Question not found on the live page',
          }),
        );
      }
    }
    if (q.answerUnchanged || !q.answer) continue;
    const wa = where(q.answer);
    if (wa) {
      aFound++;
      aRows.push(F('FAQ', `row ${q.rowId} answer`, q.answer, q.answer, 'PASS', { score: 100, note: wa === 'visible' ? '' : `found in ${wa}` }));
    } else {
      aMissing++;
      aRows.push(F('FAQ', `row ${q.rowId} answer`, q.answer, '', 'FAIL', { note: 'Answer not found on the live page' }));
    }
  }
  const ldHasAnswers = ld.some((x) => x.a.length > 0);
  if (aFound === 0 && aMissing > 0 && !ldHasAnswers) {
    for (const a of aRows) {
      a.status = 'WARNING';
      a.note = 'No FAQ answers are present anywhere in the page HTML (they may load on click) – verify manually';
    }
  }
  details.push(...aRows);

  // FAQ structured data (if the site emits FAQPage JSON-LD)
  if (ld.length) {
    let ldMissing = 0;
    for (const q of faqs) {
      if (!ld.some((x) => x.q === norm(q.question, L))) {
        ldMissing++;
        details.push(F('FAQ', `row ${q.rowId} JSON-LD`, q.question, '', 'FAIL', { note: 'Question missing from FAQPage JSON-LD' }));
      }
    }
    if (!ldMissing) details.push(F('FAQ', 'FAQPage JSON-LD', `${faqs.length} questions`, `${ld.length} questions`, 'PASS'));
  }

  f.source = `${faqs.length} FAQ rows`;
  f.live = `questions: ${qNew} new text live, ${qOld} still old, ${qMissing} missing; answers: ${aFound}/${aFound + aMissing} found`;
  f.status = worst(details.map((x) => x.status));
  if (f.status !== 'PASS') f.note = f.live;
  return { summary: f, details };
}

// ---------------------------------------------------------------- links
function checkLinks(c: Ctx): { summary: FieldCheck; details: FieldCheck[] } {
  const f = F('Links', 'body links (anchor → URL)');
  const details: FieldCheck[] = [];
  const links = c.rec.links.length ? c.rec.links : c.rec.bodyLinks;
  if (!links.length) {
    f.status = 'N/A';
    f.note = 'No links in the translation file';
    return { summary: f, details };
  }
  if (!ok(c)) {
    f.status = 'NOT FOUND';
    f.note = why(c);
    return { summary: f, details };
  }
  const live = c.page!.links;
  let pass = 0;
  for (const l of links) {
    const na = norm(l.anchor, c.lang);
    const byHref = live.filter((x) => urlsLoose(x.href, l.href));
    if (byHref.some((x) => norm(x.text, c.lang) === na)) {
      pass++;
      details.push(F('Links', `link "${l.anchor}"`, l.href, l.href, 'PASS'));
      continue;
    }
    if (byHref.length) {
      details.push(F('Links', `link "${l.anchor}"`, `${l.anchor} → ${l.href}`, `${byHref[0].text} → ${byHref[0].href}`, 'WARNING', { note: 'Same URL, different anchor text' }));
      continue;
    }
    const byText = na ? live.filter((x) => norm(x.text, c.lang) === na) : [];
    if (byText.length) {
      details.push(F('Links', `link "${l.anchor}"`, l.href, byText[0].href, 'FAIL', { note: `Anchor links elsewhere: ${urlDiff(l.href, byText[0].href, c)}` }));
      continue;
    }
    details.push(F('Links', `link "${l.anchor}"`, l.href, '', 'FAIL', { note: 'Link not found on the live page' }));
  }
  f.source = `${links.length} links`;
  f.live = `${pass}/${links.length} present with the same URL and anchor`;
  f.status = worst(details.map((x) => x.status));
  if (f.status !== 'PASS') f.note = f.live;
  return { summary: f, details };
}

/** Advisory: internal links in a translated body should point to the same language version. */
function checkLinkLanguage(c: Ctx): { summary: FieldCheck; details: FieldCheck[] } {
  const f = F('Link Language', 'internal links use the page language');
  const details: FieldCheck[] = [];
  const site = hostOf(c.settings.origin);
  const links = (c.rec.links.length ? c.rec.links : c.rec.bodyLinks).filter((l) => hostOf(l.href) === site);
  if (!links.length) {
    f.status = 'N/A';
    f.note = 'No internal links in the body';
    return { summary: f, details };
  }
  let good = 0;
  for (const l of links) {
    const ul = langOfUrl(l.href, c.langs);
    if (ul === c.lang) {
      good++;
      continue;
    }
    details.push(
      F('Link Language', `link "${l.anchor}"`, `/${c.lang}/…`, l.href, 'WARNING', {
        note: ul ? `Internal link points to the /${ul}/ version` : 'Internal link points to the English page',
      }),
    );
  }
  f.source = `${links.length} internal links`;
  f.live = `${good}/${links.length} point to /${c.lang}/ pages`;
  f.status = good === links.length ? 'PASS' : 'WARNING';
  if (f.status !== 'PASS') f.note = `${links.length - good} internal link(s) do not point to the ${langName(c.lang)} version`;
  return { summary: f, details };
}

// ---------------------------------------------------------------- language
function checkLanguage(c: Ctx, cross: string): { summary: FieldCheck; details: FieldCheck[] } {
  const f = F('Language', 'page language', c.lang);
  const d: FieldCheck[] = [];
  if (!ok(c)) {
    f.status = 'NOT FOUND';
    f.note = why(c);
    return { summary: f, details: d };
  }
  const p = c.page!;
  const lang = c.lang;
  const add = (field: string, live: string, status: Status, note = '') => d.push(F('Language', field, lang, live, status, { note }));

  const hl = (p.htmlLang || '').toLowerCase().replace(/_/g, '-');
  if (!hl) add('<html lang>', '', 'WARNING', '<html lang> attribute missing');
  else add('<html lang>', p.htmlLang, hl.split('-')[0] === lang ? 'PASS' : 'FAIL', hl.split('-')[0] === lang ? '' : `<html lang="${p.htmlLang}"> does not match ${lang}`);

  const loc = (p.meta['og:locale'] || [])[0];
  if (loc) {
    const okL = loc.toLowerCase().replace(/_/g, '-').split('-')[0] === lang;
    add('og:locale', loc, okL ? 'PASS' : 'WARNING', okL ? '' : 'og:locale does not match the page language');
  }

  const longBlocks = p.bodyBlocks.filter((b) => b.length >= (isCJK(lang) ? 15 : 40));
  const text = longBlocks.join('\n');
  if (!isLatinLang(lang)) {
    const { share, letters } = scriptShare(text, lang);
    if (letters < 50) add('content script', `${letters} letters`, 'WARNING', 'Too little text to verify');
    else if (share < 0.5) add('content script', `${Math.round(share * 100)}% in expected script`, 'FAIL', `Most of the page text is not in ${langName(lang)} script`);
    else if (lang === 'ja' && !/[\u3040-\u30ff]/.test(text)) add('content script', `${Math.round(share * 100)}% in expected script`, 'WARNING', 'No kana – text may be Chinese');
    else add('content script', `${Math.round(share * 100)}% in expected script`, 'PASS');
  } else {
    const g = guessLatin(text);
    if (!g.lang) add('detected language', 'undetermined', 'WARNING', 'Not enough text to detect the language');
    else if (g.lang === lang) add('detected language', langName(g.lang), 'PASS');
    else
      add(
        'detected language',
        langName(g.lang),
        g.lang === 'en' ? 'FAIL' : 'WARNING',
        g.lang === 'en' ? 'Page text appears to be English (untranslated)' : `Page text appears to be ${langName(g.lang)}`,
      );
  }
  if (lang !== 'en') {
    const paras = p.bodyBlocks.filter((b) => b.length >= 80).slice(0, 200);
    const english = paras.filter((b) => (isLatinLang(lang) || scriptShare(b, lang).share < 0.2) && guessLatin(b, 8).lang === 'en');
    if (paras.length >= 3) {
      const ratio = english.length / paras.length;
      add(
        'English paragraphs on page',
        `${english.length}/${paras.length}`,
        ratio >= 0.2 ? 'WARNING' : 'PASS',
        ratio >= 0.2 ? `Part of the page is still English, e.g. "${english[0].slice(0, 90)}…"` : '',
      );
    }
  }
  const r = c.r!;
  if (lang !== 'en' && c.englishUrl && urlsLoose(r.finalUrl, c.englishUrl)) add('final URL', r.finalUrl, 'FAIL', 'Translated URL resolves to the English page');
  else if (c.en && lang !== 'en' && c.en.bodyBlocks.length && p.bodyBlocks.length) {
    const sim = similarity(norm(c.en.bodyBlocks.join(' ')).slice(0, 8000), norm(p.bodyBlocks.join(' ')).slice(0, 8000));
    add('similarity to English page', `${Math.round(sim)}%`, sim >= 80 ? 'FAIL' : 'PASS', sim >= 80 ? 'Page is (almost) identical to the English page' : '');
  }
  if (cross) add('cross-language match', cross, 'FAIL', 'Live content belongs to another language version');

  f.status = worst(d.map((x) => x.status));
  f.live = `html lang=${p.htmlLang || '-'}`;
  f.note = d
    .filter((x) => x.status !== 'PASS' && x.note)
    .map((x) => x.note)
    .join('; ');
  return { summary: f, details: d };
}

// ---------------------------------------------------------------- other meta / source
function checkOtherMeta(c: Ctx): { summary: FieldCheck; details: FieldCheck[] } {
  const f = F('Other Meta', 'og / twitter / keywords / robots');
  const d: FieldCheck[] = [];
  if (!ok(c)) {
    f.status = 'NOT FOUND';
    f.note = why(c);
    return { summary: f, details: d };
  }
  const p = c.page!;
  const rec = c.rec;
  const pairs: [string, string | null][] = [
    ['og:title', rec.metaTitle],
    ['twitter:title', rec.metaTitle],
    ['og:description', rec.metaDescription],
    ['twitter:description', rec.metaDescription],
  ];
  for (const [name, src] of pairs) {
    if (!src) continue;
    const v = (p.meta[name] || [])[0];
    if (v === undefined) {
      d.push(F('Other Meta', name, src, '', 'WARNING', { note: `<meta ${name}> not found` }));
      continue;
    }
    const cmp = compareText(src, v, c.lang);
    d.push(F('Other Meta', name, src, v, cmp.status, { score: cmp.score, diff: cmp.diff, note: cmp.note }));
  }
  const ogUrl = (p.meta['og:url'] || [])[0];
  if (ogUrl) {
    const st: Status = urlsEqual(ogUrl, c.expectedUrl) ? 'PASS' : urlsLoose(ogUrl, c.expectedUrl) ? 'WARNING' : 'FAIL';
    d.push(F('Other Meta', 'og:url', c.expectedUrl, ogUrl, st, { note: st === 'FAIL' ? urlDiff(c.expectedUrl, ogUrl, c) : '' }));
  }
  if (rec.metaKeywords) {
    const v = (p.meta['keywords'] || [])[0];
    if (v === undefined) d.push(F('Other Meta', 'meta keywords', rec.metaKeywords, '', 'NOT FOUND', { note: '<meta name="keywords"> not found' }));
    else {
      const cmp = compareText(rec.metaKeywords, v, c.lang);
      d.push(F('Other Meta', 'meta keywords', rec.metaKeywords, v, cmp.status, { score: cmp.score, diff: cmp.diff, note: cmp.note }));
    }
  }
  const robots = [...(p.meta['robots'] || []), ...(p.meta['googlebot'] || [])].join(', ');
  const xr = (c.r && c.r.headers && c.r.headers['x-robots-tag']) || '';
  const toks = `${robots} ${xr}`.toLowerCase().split(/[,\s]+/);
  const noindex = toks.includes('noindex') || toks.includes('none');
  d.push(
    F('Other Meta', 'robots / X-Robots-Tag', 'indexable', [robots, xr].filter(Boolean).join(' | ') || '(not set)', noindex ? 'FAIL' : 'PASS', {
      note: noindex ? 'Page is blocked from indexing (noindex)' : '',
    }),
  );
  f.status = worst(d.map((x) => x.status));
  f.live = `${d.filter((x) => x.status === 'PASS').length}/${d.length} match`;
  f.note = d
    .filter((x) => x.status !== 'PASS')
    .map((x) => `${x.field}: ${x.note || x.status}`)
    .join('; ');
  return { summary: f, details: d };
}

function checkSource(c: Ctx): FieldCheck {
  const iss = c.rec.issues;
  const f = F(
    'Source File',
    'translation file',
    c.rec.docFile || '(missing)',
    `body: ${c.rec.bodySource}; FAQ rows: ${c.rec.faqs.length}; links: ${c.rec.links.length}`,
  );
  f.status = !c.rec.docFile ? 'NOT FOUND' : iss.length ? worst(iss.map((i) => i.status)) : 'PASS';
  if (f.status === 'N/A') f.status = 'PASS';
  f.note = iss
    .filter((i) => i.status !== 'PASS')
    .map((i) => `${i.field}: ${i.note}`)
    .join('; ');
  return f;
}

// ---------------------------------------------------------------- row
function overallOf(summary: Record<string, FieldCheck>, settings: Settings): { overall: Status; failing: string[] } {
  const advisory = new Set(settings.advisoryChecks || []);
  const statuses: Status[] = [];
  const failing: string[] = [];
  for (const [name, fc] of Object.entries(summary)) {
    if (fc.status === 'N/A') continue;
    if (fc.status !== 'PASS') failing.push(`${name} (${fc.status})${advisory.has(name) ? ' [advisory]' : ''}`);
    if (!advisory.has(name)) statuses.push(fc.status);
  }
  if (statuses.some((s) => s === 'FAIL' || s === 'NOT FOUND')) return { overall: 'FAIL', failing };
  if (statuses.includes('WARNING')) return { overall: 'WARNING', failing };
  return { overall: statuses.length ? 'PASS' : 'N/A', failing };
}

export function evaluateRow(plan: RowPlan, r: InspectResult | undefined, english: InspectResult | undefined, settings: Settings, sm: SitemapResult | null): AuditRow {
  const rec = plan.record;
  const langs = new Set<string>([...((sm && sm.languages) || []), 'en']);
  const expectedUrl = plan.candidates.length > 1 && r && r.requestedUrl ? r.requestedUrl : plan.expectedUrl;
  const englishUrl = plan.englishCandidates.length > 1 && english && english.requestedUrl ? english.requestedUrl : plan.englishUrl;
  const hreflang: Record<string, string> = {};
  for (const [k, v] of Object.entries(plan.hreflang)) hreflang[k] = v === plan.englishUrl ? englishUrl : v;
  if (expectedUrl && rec.lang) hreflang[hrefCode(rec.lang, settings)] = expectedUrl;

  const c: Ctx = {
    plan,
    rec,
    lang: rec.lang,
    r,
    page: r && r.page,
    en: english && english.status === 200 ? english.page : undefined,
    expectedUrl,
    englishUrl,
    hreflang,
    settings,
    langs,
    siblings: plan.report.records,
  };
  const summary: Record<string, FieldCheck> = {};
  const details: FieldCheck[] = [];
  const put = (fc: FieldCheck, extra: FieldCheck[] = []) => {
    summary[fc.check] = fc;
    details.push(fc, ...extra);
  };

  const p = c.page;
  put(checkHttp(c));
  put(checkText(c, 'Meta Title', 'meta title (<title>)', rec.metaTitle, p ? p.titles : [], '<title>', 'metaTitle'));
  put(checkText(c, 'Meta Description', 'meta description', rec.metaDescription, p ? p.meta['description'] || [] : [], 'meta description', 'metaDescription'));
  put(checkText(c, 'H1', 'H1 (Report Subtitle)', rec.reportSubtitle, p ? p.h1 : [], 'H1', 'reportSubtitle', false));
  put(checkCanonical(c));
  const hl = checkHreflang(c);
  put(hl.summary, hl.details);
  const ct = checkContent(c);
  put(ct.summary, ct.details);
  put(plan.sitemapCheck, plan.sitemapDetails);
  put(checkUrl(c));
  put(checkReportId(c));
  put(checkReportTitle(c));
  // FAQs are out of scope: they are not in the Description HTML, so they are not cross-checked.
  // Change CHECK_FAQ to true to switch the FAQ check back on.
  const CHECK_FAQ = false;
  if (CHECK_FAQ) {
    const fq = checkFaq(c);
    put(fq.summary, fq.details);
  } else {
    summary['FAQ'] = F('FAQ', 'FAQ questions & answers', '', '', 'N/A', { note: 'Not checked – FAQs are out of scope' });
  }
  const lk = checkLinks(c);
  put(lk.summary, lk.details);
  const lg = checkLanguage(c, ct.cross);
  put(lg.summary, lg.details);
  const om = checkOtherMeta(c);
  put(om.summary, om.details);
  put(checkSource(c));
  const ll = checkLinkLanguage(c);
  put(ll.summary, ll.details);

  const { overall, failing } = overallOf(summary, settings);
  return {
    key: plan.key,
    reportId: rec.reportId,
    reportName: plan.report.reportName,
    lang: rec.lang,
    langName: langName(rec.lang),
    expectedUrl,
    urlSource: plan.urlSource,
    finalUrl: r ? r.finalUrl : '',
    http: r ? (r.status !== null ? String(r.status) : r.error || 'error') : '',
    chain: r ? chainText(r) : '',
    summary,
    details,
    overall,
    failing,
    sourceFile: rec.docFile,
  };
}
