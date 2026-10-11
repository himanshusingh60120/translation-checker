'use client';

import { useMemo, useRef, useState } from 'react';
import ResultsView, { Badge } from '@/components/ResultsView';
import { parseTranslationInputs, type ParsedZip } from '@/lib/zip-parser';
import { planAll } from '@/lib/plan';
import { evaluateRow } from '@/lib/checks';
import { exportCsv, exportExcel, exportJson } from '@/lib/export';
import { langName, sortLangs, SITE_LANG_ORDER } from '@/lib/languages';
import { worst } from '@/lib/types';
import type { AuditRow, InspectResult, Settings, SitemapResult, SourceIssue } from '@/lib/types';

const DEFAULTS: Settings = {
  origin: 'https://www.kingsresearch.com',
  sitemapIndex: 'https://www.kingsresearch.com/sitemap.xml',
  concurrency: 4,
  requireXDefault: true,
  compareEnglish: true,
  advisoryChecks: ['Link Language'],
  hreflangMap: {},
};

async function postJson<T>(url: string, body: unknown, tries = 2): Promise<T> {
  let last: any = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
      return data as T;
    } catch (e) {
      last = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length || 1)) }, async () => {
    while (i < items.length) {
      const k = i++;
      await fn(items[k]);
    }
  });
  await Promise.all(workers);
}

function sortRows(rows: AuditRow[]): AuditRow[] {
  return [...rows].sort(
    (a, b) =>
      (Number(a.reportId) || 0) - (Number(b.reportId) || 0) ||
      (SITE_LANG_ORDER.indexOf(a.lang) + 100) % 100 - (SITE_LANG_ORDER.indexOf(b.lang) + 100) % 100,
  );
}

function parseMap(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(/[,;\n]+/)) {
    const [k, v] = part.split('=').map((s) => (s || '').trim().toLowerCase());
    if (k && v) out[k] = v;
  }
  return out;
}

function ParsedPreview({ parsed, issues }: { parsed: ParsedZip; issues: SourceIssue[] }) {
  const recCount = parsed.reports.reduce((n, r) => n + r.records.length, 0);
  const bad = issues.filter((i) => i.status !== 'PASS');
  return (
    <div>
      <p>
        <b>{parsed.reports.length}</b> reports · <b>{recCount}</b> language files · {parsed.fileCount} files read from {parsed.inputs.join(', ')}
      </p>
      <div className="scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>ID</th>
              <th>Report</th>
              <th>Slug</th>
              <th>Languages (body source · FAQ rows · links)</th>
            </tr>
          </thead>
          <tbody>
            {parsed.reports.map((r) => (
              <tr key={r.reportId}>
                <td>{r.reportId}</td>
                <td>{r.reportName}</td>
                <td className="small">{r.slug || <span className="muted">–</span>}</td>
                <td>
                  <div className="chips">
                    {r.records.map((x) => {
                      const st = worst(x.issues.map((i) => i.status));
                      return (
                        <span
                          key={x.lang}
                          className={`chip ${st === 'FAIL' || st === 'NOT FOUND' ? 'bad' : st === 'WARNING' ? 'warn' : ''}`}
                          title={x.issues.map((i) => `${i.status}: ${i.field} – ${i.note}`).join('\n') || 'OK'}
                        >
                          {x.lang || '?'} · {x.bodySource} · {x.faqs.length} FAQ · {x.links.length} links
                        </span>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bad.length > 0 && (
        <details>
          <summary>
            {bad.length} translation-file issue(s) (Source Validation)
          </summary>
          <table className="inner">
            <thead>
              <tr>
                <th>ID</th>
                <th>Lang</th>
                <th>Field</th>
                <th>Status</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {bad.map((i, k) => (
                <tr key={k}>
                  <td>{i.reportId}</td>
                  <td>{i.lang}</td>
                  <td>{i.field}</td>
                  <td>
                    <Badge s={i.status} />
                  </td>
                  <td className="txt">
                    {i.note}
                    {i.value ? <span className="muted"> — {i.value}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function SitemapPanel({ sm }: { sm: SitemapResult }) {
  return (
    <details>
      <summary>
        Sitemaps read: {sm.sitemaps.filter((s) => s.status === 200).length}/{sm.sitemaps.length} ({sm.fetchedAt})
      </summary>
      {(sm.notes || []).map((n, i) => (
        <p key={i} className="muted small">
          {n}
        </p>
      ))}
      <table className="inner">
        <thead>
          <tr>
            <th>Lang</th>
            <th>Sitemap</th>
            <th>HTTP</th>
            <th>URLs</th>
          </tr>
        </thead>
        <tbody>
          {sm.sitemaps.map((s) => (
            <tr key={s.url}>
              <td>{s.lang}</td>
              <td>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.url}
                </a>
              </td>
              <td>{s.status === null ? s.error : s.status}</td>
              <td>{s.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export default function Home() {
  const [parsed, setParsed] = useState<ParsedZip | null>(null);
  const [parsing, setParsing] = useState('');
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [hreflangText, setHreflangText] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' });
  const [log, setLog] = useState<string[]>([]);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [sitemap, setSitemap] = useState<SitemapResult | null>(null);
  const [error, setError] = useState('');
  const [times, setTimes] = useState({ started: '', finished: '' });
  const cache = useRef<Record<string, Promise<InspectResult>>>({});
  const inspected = useRef<Record<string, InspectResult>>({});

  const addLog = (m: string) => setLog((prev) => [...prev.slice(-300), `${new Date().toLocaleTimeString()}  ${m}`]);

  const allIssues: SourceIssue[] = useMemo(
    () => (parsed ? [...parsed.issues, ...parsed.reports.flatMap((r) => r.records.flatMap((x) => x.issues))] : []),
    [parsed],
  );

  async function handleFiles(list: FileList | null) {
    if (!list || !list.length) return;
    setError('');
    setRows([]);
    setSitemap(null);
    setParsing('Reading files…');
    try {
      const res = await parseTranslationInputs(Array.from(list), (m) => setParsing(m));
      setParsed(res);
      if (!res.reports.length) setError('No PASTE-<Language>.docx / BODY-<Language>.html files were found. Expected "<Report Name> <ID> Translations/<Language>/PASTE-<Language>.docx".');
    } catch (e: any) {
      setError(`Could not read the files: ${(e && e.message) || e}`);
    } finally {
      setParsing('');
    }
  }

  function inspect(url: string): Promise<InspectResult> {
    if (!cache.current[url]) {
      cache.current[url] = postJson<InspectResult>('/api/inspect', { url }, 2)
        .catch((e: any): InspectResult => ({ requestedUrl: url, finalUrl: url, status: null, chain: [], error: `Inspector error: ${(e && e.message) || e}`, headers: {}, ms: 0 }))
        .then((r) => {
          inspected.current[url] = r;
          return r;
        });
    }
    return cache.current[url];
  }

  async function inspectFirst(cands: string[]): Promise<InspectResult | undefined> {
    let last: InspectResult | undefined;
    for (let i = 0; i < cands.length; i++) {
      last = await inspect(cands[i]);
      if (last.status === 404 && i < cands.length - 1) continue;
      return last;
    }
    return last;
  }

  async function run() {
    if (!parsed || !parsed.reports.length) return;
    const cfg: Settings = { ...settings, hreflangMap: parseMap(hreflangText) };
    setRunning(true);
    setRows([]);
    setLog([]);
    setError('');
    cache.current = {};
    inspected.current = {};
    const started = new Date().toISOString();
    setTimes({ started, finished: '' });
    try {
      addLog(`Reading sitemaps from ${cfg.sitemapIndex} …`);
      let sm: SitemapResult;
      try {
        sm = await postJson<SitemapResult>('/api/sitemap', { indexUrl: cfg.sitemapIndex, ids: parsed.reports.map((r) => r.reportId) }, 2);
      } catch (e: any) {
        addLog(`Sitemap error: ${(e && e.message) || e}`);
        sm = { index: cfg.sitemapIndex, fetchedAt: new Date().toISOString(), sitemaps: [], languages: [], entries: {}, error: String((e && e.message) || e) };
      }
      setSitemap(sm);
      addLog(`Sitemaps: ${sm.sitemaps.map((s) => `${s.lang}=${s.status === 200 ? s.count : s.status === null ? 'error' : 'HTTP ' + s.status}`).join(', ') || 'none'}`);
      const plan = planAll(parsed.reports, sm, cfg);
      for (const rp of plan.reports) addLog(`Report ${rp.reportId}: English URL ${rp.englishUrl || '(unknown)'} [${rp.englishSource}]`);

      const total = (cfg.compareEnglish ? plan.reports.length : 0) + plan.rows.length;
      let done = 0;
      const tick = (label: string) => {
        done++;
        setProgress({ done, total, label });
      };
      setProgress({ done: 0, total, label: 'starting' });

      const english: Record<string, InspectResult> = {};
      if (cfg.compareEnglish) {
        await pool(plan.reports, cfg.concurrency, async (rp) => {
          if (rp.englishCandidates.length) {
            const r = await inspectFirst(rp.englishCandidates);
            if (r) english[rp.reportId] = r;
          }
          tick(`English page ${rp.reportId}`);
        });
      }

      const out: AuditRow[] = [];
      await pool(plan.rows, cfg.concurrency, async (rowPlan) => {
        const r = rowPlan.candidates.length ? await inspectFirst(rowPlan.candidates) : undefined;
        let row: AuditRow;
        try {
          row = evaluateRow(rowPlan, r, english[rowPlan.report.reportId], cfg, sm);
        } catch (e: any) {
          addLog(`Evaluation error ${rowPlan.key}: ${(e && e.message) || e}`);
          return;
        }
        out.push(row);
        setRows(sortRows(out));
        if (row.overall !== 'PASS') addLog(`${row.overall.padEnd(7)} ${row.reportId} [${row.lang}] ${row.failing.join(', ')}`);
        tick(`${rowPlan.report.reportId} ${rowPlan.record.lang}`);
      });
      const finished = new Date().toISOString();
      setTimes({ started, finished });
      addLog(`Done: ${out.length} rows, ${out.filter((r) => r.overall === 'PASS').length} fully verified.`);
    } catch (e: any) {
      setError((e && e.message) || String(e));
    } finally {
      setRunning(false);
    }
  }

  const exportCtx = () => ({
    rows,
    reports: parsed ? parsed.reports : [],
    sourceIssues: allIssues,
    sitemap,
    inspected: inspected.current,
    started: times.started,
    finished: times.finished,
    inputs: parsed ? parsed.inputs : [],
  });

  const langsInZip = parsed ? sortLangs(Array.from(new Set(parsed.reports.flatMap((r) => r.records.map((x) => x.lang))))) : [];
  const pct = progress.total ? Math.round((100 * progress.done) / progress.total) : 0;

  return (
    <main>
      <header>
        <h1>Kings Research · Translation &amp; Live URL Verification</h1>
        <p className="muted">
          Translation file (source of truth) → sitemap → expected URL → live URL → HTML/SEO metadata → translated content. HTTP 200 alone never passes a row.
        </p>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="card">
        <h2>1. Translation files</h2>
        <p className="muted">
          Download the translations folder from Google Drive as a ZIP (several ZIPs are fine) and select it. Expected structure:{' '}
          <code>&lt;Report Name&gt; &lt;ID&gt; Translations/&lt;Language&gt;/PASTE-&lt;Language&gt;.docx</code> plus an optional{' '}
          <code>BODY-&lt;Language&gt;.html</code>. Files are read in your browser; nothing is uploaded.
        </p>
        <div className="row">
          <label className="button">
            Choose ZIP file(s)
            <input
              type="file"
              accept=".zip,application/zip"
              multiple
              hidden
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          <label className="button secondary">
            …or an unzipped folder
            <input
              type="file"
              multiple
              hidden
              {...({ webkitdirectory: '', directory: '' } as any)}
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          {parsing && <span className="muted">{parsing}</span>}
        </div>
        {parsed && <ParsedPreview parsed={parsed} issues={allIssues} />}
        {langsInZip.length > 0 && (
          <p className="muted small">Languages found: {langsInZip.map((l) => `${langName(l)} (${l})`).join(', ')}</p>
        )}
      </section>

      <section className="card">
        <h2>2. Settings</h2>
        <div className="settings">
          <label>
            Site origin
            <input value={settings.origin} onChange={(e) => setSettings({ ...settings, origin: e.target.value })} />
          </label>
          <label>
            Sitemap index
            <input value={settings.sitemapIndex} onChange={(e) => setSettings({ ...settings, sitemapIndex: e.target.value })} />
          </label>
          <label>
            Parallel requests
            <input
              type="number"
              min={1}
              max={8}
              value={settings.concurrency}
              onChange={(e) => setSettings({ ...settings, concurrency: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })}
            />
          </label>
          <label>
            hreflang code overrides (optional)
            <input placeholder="e.g. zh=zh-cn, pt=pt-br" value={hreflangText} onChange={(e) => setHreflangText(e.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.requireXDefault} onChange={(e) => setSettings({ ...settings, requireXDefault: e.target.checked })} />
            Expect hreflang x-default → English page
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.compareEnglish} onChange={(e) => setSettings({ ...settings, compareEnglish: e.target.checked })} />
            Fetch English pages (detect untranslated content)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.advisoryChecks.includes('Link Language')}
              onChange={(e) => setSettings({ ...settings, advisoryChecks: e.target.checked ? ['Link Language'] : [] })}
            />
            "Link Language" is advisory (doesn&apos;t affect Overall)
          </label>
        </div>
      </section>

      <section className="card">
        <h2>3. Verify</h2>
        <div className="row">
          <button onClick={run} disabled={!parsed || !parsed.reports.length || running}>
            {running ? 'Verifying…' : 'Run verification'}
          </button>
          {running && (
            <span className="muted">
              {progress.done}/{progress.total} · {progress.label}
            </span>
          )}
        </div>
        {(running || progress.total > 0) && (
          <div className="progress">
            <div style={{ width: `${pct}%` }} />
          </div>
        )}
        {sitemap && <SitemapPanel sm={sitemap} />}
        {log.length > 0 && <div className="log">{log.join('\n')}</div>}
      </section>

      {rows.length > 0 && (
        <section className="card">
          <h2>4. Results</h2>
          <div className="row">
            <button onClick={() => exportExcel(exportCtx())}>Download Excel report</button>
            <button className="secondary" onClick={() => exportCsv(rows, 'audit')}>
              Audit CSV
            </button>
            <button className="secondary" onClick={() => exportCsv(rows, 'fields')}>
              Field comparison CSV
            </button>
            <button className="secondary" onClick={() => exportJson(exportCtx())}>
              JSON
            </button>
          </div>
          <ResultsView rows={rows} />
        </section>
      )}
    </main>
  );
}
