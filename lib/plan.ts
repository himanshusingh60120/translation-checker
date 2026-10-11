import type { FieldCheck, ReportSource, Settings, SitemapEntry, SitemapResult, SourceRecord, Status } from './types';
import { worst } from './types';
import { idOf, langOfUrl, slugOf, stripLang, withLang } from './urls';

export interface ReportPlan {
  reportId: string;
  reportName: string;
  englishUrl: string;
  englishSource: string;
  englishCandidates: string[];
}

export interface RowPlan {
  key: string;
  report: ReportSource;
  record: SourceRecord;
  expectedUrl: string;
  urlSource: string;
  candidates: string[];
  englishUrl: string;
  englishCandidates: string[];
  hreflang: Record<string, string>;
  sitemapCheck: FieldCheck;
  sitemapDetails: FieldCheck[];
}

export function hrefCode(lang: string, settings: Settings): string {
  return String((settings.hreflangMap || {})[lang] || lang).toLowerCase();
}

function pick(entries: SitemapEntry[] | undefined, slug: string): SitemapEntry | undefined {
  if (!entries || !entries.length) return undefined;
  return entries.find((e) => !!slug && slugOf(e.loc) === slug) || entries[0];
}

function sitemapChecks(
  rec: SourceRecord,
  rep: ReportSource,
  sm: SitemapResult | null,
  byLang: Record<string, SitemapEntry[]>,
  enEntry: SitemapEntry | undefined,
  le: SitemapEntry | undefined,
  langSet: Set<string>,
): { check: FieldCheck; details: FieldCheck[] } {
  const C = 'Sitemap';
  const id = rep.reportId;
  const lang = rec.lang;
  const mk = (field: string, source: string, live: string, status: Status, note = ''): FieldCheck => ({ check: C, field, source, live, status, note });
  if (!sm || !sm.sitemaps || !sm.sitemaps.length) {
    const f = mk('sitemaps', `report ${id}`, '', 'NOT FOUND', `Sitemaps could not be read${sm && sm.error ? ': ' + sm.error : ''}`);
    return { check: f, details: [] };
  }
  const d: FieldCheck[] = [];
  const enList = byLang['en'] || [];
  const enMap = sm.sitemaps.find((s) => s.lang === 'en');
  if (!enList.length)
    d.push(mk('English sitemap', `ID ${id}`, '(not listed)', 'NOT FOUND', enMap ? `Report ${id} is not in ${enMap.url}` : 'English report sitemap not found'));
  else
    d.push(
      mk('English sitemap', `ID ${id}`, enList.map((e) => e.loc).join(' | '), enList.length > 1 ? 'WARNING' : 'PASS', enList.length > 1 ? `Report ID listed ${enList.length} times` : ''),
    );

  const langMap = sm.sitemaps.find((s) => s.lang === lang);
  const lList = byLang[lang] || [];
  if (!langMap) d.push(mk(`${lang} sitemap`, `ID ${id}`, '', 'NOT FOUND', `No /${lang}/sitemap-reports.xml in the sitemap index`));
  else if (langMap.status !== 200)
    d.push(mk(`${lang} sitemap`, `ID ${id}`, `HTTP ${langMap.status === null ? langMap.error : langMap.status}`, 'FAIL', `${langMap.url} could not be read`));
  else if (!lList.length) d.push(mk(`${lang} sitemap`, `ID ${id}`, '(not listed)', 'NOT FOUND', `Report ${id} is not in ${langMap.url}`));
  else {
    const distinct = new Set(lList.map((e) => e.loc)).size;
    d.push(
      mk(`${lang} sitemap`, `ID ${id}`, lList.map((e) => e.loc).join(' | '), lList.length > 1 ? 'WARNING' : 'PASS', lList.length > 1 ? `Listed ${lList.length} times (${distinct} distinct URLs)` : ''),
    );
  }

  if (le) {
    const ls = slugOf(le.loc);
    if (rec.slug)
      d.push(mk('slug: file vs language sitemap', rec.slug, ls, ls === rec.slug ? 'PASS' : 'FAIL', ls === rec.slug ? '' : 'Sitemap URL slug differs from the slug in the translation file'));
    if (enEntry) {
      const es = slugOf(enEntry.loc);
      d.push(mk('slug: language vs English sitemap', es, ls, es === ls ? 'PASS' : 'FAIL', es === ls ? '' : 'Translated URL uses a different slug than the English URL'));
      const ep = stripLang(enEntry.loc, langSet);
      const lp = stripLang(le.loc, langSet);
      d.push(mk('URL path vs English', ep, lp, ep === lp ? 'PASS' : 'WARNING', ep === lp ? '' : 'Translated URL path does not mirror the English path'));
    }
    const ul = langOfUrl(le.loc, langSet);
    d.push(mk('language prefix', `/${lang}/`, ul ? `/${ul}/` : '(none)', ul === lang ? 'PASS' : 'FAIL', ul === lang ? '' : 'Sitemap URL has the wrong language prefix'));
    if (idOf(le.loc) !== id) d.push(mk('report ID in URL', id, idOf(le.loc), 'FAIL'));
    if (rec.fileDate && le.lastmod) {
      const fileDay = rec.fileDate.slice(0, 10);
      const lm = le.lastmod.slice(0, 10);
      d.push(
        mk(
          'lastmod vs translation file date',
          fileDay,
          lm,
          lm >= fileDay ? 'PASS' : 'WARNING',
          lm >= fileDay ? '' : 'Sitemap lastmod is older than the translation file – the page may not have been updated yet',
        ),
      );
    }
  } else if (enEntry && rec.slug && slugOf(enEntry.loc) !== rec.slug) {
    d.push(mk('slug: file vs English sitemap', rec.slug, slugOf(enEntry.loc), 'FAIL', 'English sitemap URL slug differs from the slug in the translation file'));
  }

  const bad = d.filter((x) => x.status !== 'PASS');
  const check = mk(
    `ID ${id} in sitemaps`,
    `en + ${lang}`,
    bad.length ? bad.map((x) => x.field).join(', ') : 'listed correctly',
    worst(d.map((x) => x.status)),
    bad.map((x) => `${x.field}: ${x.note || x.status}`).join('; '),
  );
  return { check, details: d };
}

/** Expected URLs come from the sitemaps (source of truth for "the numbers"); fall back to the slug. */
export function planAll(reports: ReportSource[], sm: SitemapResult | null, settings: Settings): { reports: ReportPlan[]; rows: RowPlan[] } {
  const origin = settings.origin.replace(/\/+$/, '');
  const langSet = new Set<string>((sm && sm.languages) || []);
  const outReports: ReportPlan[] = [];
  const rows: RowPlan[] = [];

  for (const rep of reports) {
    const id = rep.reportId;
    const byLang: Record<string, SitemapEntry[]> = (sm && sm.entries && sm.entries[id]) || {};
    const slug = rep.slug;
    const enEntry = pick(byLang['en'], slug);
    const englishCandidates = enEntry ? [enEntry.loc] : slug ? [`${origin}/report/${slug}-${id}`, `${origin}/${slug}-${id}`] : [];
    const englishUrl = englishCandidates[0] || '';
    outReports.push({
      reportId: id,
      reportName: rep.reportName,
      englishUrl,
      englishSource: enEntry ? 'English sitemap' : 'constructed from slug (not in English sitemap)',
      englishCandidates,
    });

    // hreflang set expected on every language version = every sitemap that lists this ID
    const hreflang: Record<string, string> = {};
    for (const l of Object.keys(byLang)) {
      const e = pick(byLang[l], slug);
      if (e) hreflang[hrefCode(l, settings)] = e.loc;
    }
    if (englishUrl && !hreflang[hrefCode('en', settings)]) hreflang[hrefCode('en', settings)] = englishUrl;
    if (settings.requireXDefault && englishUrl) hreflang['x-default'] = englishUrl;

    for (const rec of rep.records) {
      const lang = rec.lang;
      const recSlug = rec.slug || slug;
      const le = lang ? pick(byLang[lang], recSlug) : undefined;
      let expectedUrl = '';
      let urlSource = '';
      let candidates: string[] = [];
      if (le) {
        expectedUrl = le.loc;
        urlSource = `${lang} sitemap`;
        candidates = [le.loc];
      } else if (enEntry && lang) {
        expectedUrl = withLang(enEntry.loc, lang);
        urlSource = 'derived from English sitemap URL (not in language sitemap)';
        candidates = [expectedUrl];
      } else if (recSlug && lang) {
        candidates = [`${origin}/${lang}/report/${recSlug}-${id}`, `${origin}/${lang}/${recSlug}-${id}`];
        expectedUrl = candidates[0];
        urlSource = 'constructed from slug (not in any sitemap)';
      }
      const rowHreflang = { ...hreflang };
      if (expectedUrl && lang) rowHreflang[hrefCode(lang, settings)] = expectedUrl;
      const { check, details } = sitemapChecks(rec, rep, sm, byLang, enEntry, le, langSet);
      rows.push({
        key: `${id}|${lang}`,
        report: rep,
        record: rec,
        expectedUrl,
        urlSource,
        candidates,
        englishUrl,
        englishCandidates,
        hreflang: rowHreflang,
        sitemapCheck: check,
        sitemapDetails: details,
      });
    }
  }
  return { reports: outReports, rows };
}
