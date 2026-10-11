import type { AuditRow, FieldCheck, InspectResult, ReportSource, SitemapResult, SourceIssue, Status } from './types';
import { ALL_CHECKS, CORE_CHECKS, EXTRA_CHECKS, worst } from './types';
import { langName, sortLangs } from './languages';

export function matchLabel(s: Status): string {
  return s === 'PASS' ? 'Match' : s === 'WARNING' ? 'Mismatch (minor)' : s === 'FAIL' ? 'Mismatch' : s === 'NOT FOUND' ? 'Missing' : 'N/A';
}

export const AUDIT_HEADERS = [
  'ReportID', 'Language', 'URL', ...CORE_CHECKS, 'Overall', 'Fully Verified', 'Report Name',
  'Expected URL source', 'Final URL', 'HTTP / Redirect chain', ...EXTRA_CHECKS, 'Failing checks', 'Differences / Notes',
];

export function rowNotes(r: AuditRow): string {
  return ALL_CHECKS.map((k) => r.summary[k])
    .filter((x) => x && x.status !== 'PASS' && x.status !== 'N/A')
    .map((x) => `[${x.check}] ${x.note || x.diff || x.live}`)
    .join('\n');
}

export function auditValues(r: AuditRow): string[] {
  const st = (k: string) => (r.summary[k] ? r.summary[k].status : 'N/A');
  return [
    r.reportId, r.lang, r.expectedUrl, ...CORE_CHECKS.map(st), r.overall, r.overall === 'PASS' ? 'YES' : 'NO', r.reportName,
    r.urlSource, r.finalUrl, r.chain || r.http, ...EXTRA_CHECKS.map(st), r.failing.join(', '), rowNotes(r),
  ];
}

export const FIELD_HEADERS = [
  'ReportID', 'Language', 'URL', 'Check', 'Field', 'Source File Value', 'Live HTML Value', 'Match/Mismatch', 'Status',
  'Similarity %', 'Difference [-file-] {+live+}', 'Note',
];

export function fieldValues(r: AuditRow, d: FieldCheck): (string | number)[] {
  return [r.reportId, r.lang, r.expectedUrl, d.check, d.field, d.source, d.live, matchLabel(d.status), d.status, d.score === undefined ? '' : d.score, d.diff || '', d.note || ''];
}

export interface ReportSummaryRow {
  reportId: string;
  reportName: string;
  langs: Record<string, Status>;
  overall: Status;
  verified: string;
  diffs: string;
}

export function reportSummary(rows: AuditRow[]): ReportSummaryRow[] {
  const by = new Map<string, AuditRow[]>();
  for (const r of rows) {
    const list = by.get(r.reportId) || [];
    list.push(r);
    by.set(r.reportId, list);
  }
  const out: ReportSummaryRow[] = [];
  for (const [id, list] of Array.from(by.entries())) {
    const langs: Record<string, Status> = {};
    const diffs: string[] = [];
    for (const r of list) {
      langs[r.lang] = r.overall;
      if (r.overall === 'PASS') continue;
      const bad = ALL_CHECKS.filter((k) => r.summary[k] && r.summary[k].status !== 'PASS' && r.summary[k].status !== 'N/A').map((k) => `${k} (${r.summary[k].status})`);
      diffs.push(`${r.lang}: ${bad.join(', ')}`);
    }
    out.push({
      reportId: id,
      reportName: list[0].reportName,
      langs,
      overall: worst(list.map((r) => r.overall)),
      verified: `${list.filter((r) => r.overall === 'PASS').length}/${list.length}`,
      diffs: diffs.join('\n'),
    });
  }
  return out.sort((a, b) => (Number(a.reportId) || 0) - (Number(b.reportId) || 0));
}

export function langsOf(rows: AuditRow[]): string[] {
  return sortLangs(Array.from(new Set(rows.map((r) => r.lang))));
}

// ---------------------------------------------------------------- downloads
function stamp(): string {
  return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

function csv(headers: string[], data: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v === null || v === undefined ? '' : v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + [headers, ...data].map((r) => r.map(esc).join(',')).join('\r\n');
}

export function exportCsv(rows: AuditRow[], kind: 'audit' | 'fields') {
  const text =
    kind === 'audit'
      ? csv(AUDIT_HEADERS, rows.map(auditValues))
      : csv(FIELD_HEADERS, rows.flatMap((r) => r.details.map((d) => fieldValues(r, d))));
  download(new Blob([text], { type: 'text/csv;charset=utf-8' }), `${kind === 'audit' ? 'audit' : 'field-comparison'}-${stamp()}.csv`);
}

export interface ExportContext {
  rows: AuditRow[];
  reports: ReportSource[];
  sourceIssues: SourceIssue[];
  sitemap: SitemapResult | null;
  inspected: Record<string, InspectResult>;
  started: string;
  finished: string;
  inputs: string[];
}

export function exportJson(ctx: ExportContext) {
  const data = {
    started: ctx.started,
    finished: ctx.finished,
    inputs: ctx.inputs,
    sitemap: ctx.sitemap ? { index: ctx.sitemap.index, fetchedAt: ctx.sitemap.fetchedAt, sitemaps: ctx.sitemap.sitemaps } : null,
    rows: ctx.rows.map((r) => ({ ...r, fullyVerified: r.overall === 'PASS' })),
    sourceIssues: ctx.sourceIssues,
  };
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `translation-audit-${stamp()}.json`);
}

const COLORS: Record<string, [string, string]> = {
  PASS: ['FFC6EFCE', 'FF006100'],
  WARNING: ['FFFFEB9C', 'FF9C5700'],
  FAIL: ['FFFFC7CE', 'FF9C0006'],
  'NOT FOUND': ['FFF8CBAD', 'FF843C0C'],
  'N/A': ['FFEDEDED', 'FF595959'],
  YES: ['FFC6EFCE', 'FF006100'],
  NO: ['FFFFC7CE', 'FF9C0006'],
  Match: ['FFC6EFCE', 'FF006100'],
  Mismatch: ['FFFFC7CE', 'FF9C0006'],
  'Mismatch (minor)': ['FFFFEB9C', 'FF9C5700'],
  Missing: ['FFF8CBAD', 'FF843C0C'],
};

const clip = (v: unknown) => {
  if (typeof v === 'number') return v;
  const s = v === null || v === undefined ? '' : String(v);
  return s.length > 32000 ? s.slice(0, 32000) + '…' : s;
};

function addSheet(wb: any, name: string, headers: string[], data: unknown[][], widths: number[], xSplit = 3) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit, ySplit: 1 }] });
  ws.addRow(headers);
  ws.getRow(1).eachCell((cell: any) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  for (const vals of data) {
    const row = ws.addRow(vals.map(clip));
    row.eachCell((cell: any) => {
      const v = cell.value;
      if (typeof v === 'string' && COLORS[v]) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS[v][0] } };
        cell.font = { bold: true, color: { argb: COLORS[v][1] } };
      } else if (typeof v === 'string' && (v.length > 60 || v.includes('\n'))) {
        cell.alignment = { wrapText: true, vertical: 'top' };
      }
    });
  }
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  if (data.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: data.length + 1, column: headers.length } };
  return ws;
}

export async function exportExcel(ctx: ExportContext) {
  const mod: any = await import('exceljs');
  const ExcelJS = mod.default || mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kings Research Translation QA';
  const rows = ctx.rows;
  const langs = langsOf(rows);
  const count = (list: AuditRow[], s: Status) => list.filter((r) => r.overall === s).length;

  // Dashboard
  const dash = wb.addWorksheet('Dashboard');
  dash.addRow(['Kings Research – Multilingual Translation & Live URL Verification']);
  dash.getRow(1).font = { bold: true, size: 14 };
  dash.addRow([]);
  const info: [string, string | number][] = [
    ['Run started', ctx.started],
    ['Run finished', ctx.finished],
    ['Inputs', ctx.inputs.join(', ')],
    ['Sitemap index', ctx.sitemap ? ctx.sitemap.index : '-'],
    ['Reports', new Set(rows.map((r) => r.reportId)).size],
    ['Report × language rows', rows.length],
    ['Fully verified (PASS)', count(rows, 'PASS')],
    ['WARNING', count(rows, 'WARNING')],
    ['FAIL', count(rows, 'FAIL')],
  ];
  for (const [k, v] of info) {
    const r = dash.addRow([k, v]);
    r.getCell(1).font = { bold: true };
  }
  dash.addRow([]);
  const lh = dash.addRow(['Language', 'Rows', 'PASS', 'WARNING', 'FAIL', 'Verified %']);
  lh.font = { bold: true };
  for (const l of langs) {
    const list = rows.filter((r) => r.lang === l);
    dash.addRow([`${langName(l)} (${l})`, list.length, count(list, 'PASS'), count(list, 'WARNING'), count(list, 'FAIL'), list.length ? `${Math.round((100 * count(list, 'PASS')) / list.length)}%` : '0%']);
  }
  dash.addRow([]);
  const ch = dash.addRow(['Check', 'PASS', 'WARNING', 'FAIL', 'NOT FOUND', 'N/A']);
  ch.font = { bold: true };
  for (const k of ALL_CHECKS) {
    const st = rows.map((r) => (r.summary[k] ? r.summary[k].status : 'N/A'));
    dash.addRow([k, ...(['PASS', 'WARNING', 'FAIL', 'NOT FOUND', 'N/A'] as Status[]).map((s) => st.filter((x) => x === s).length)]);
  }
  dash.getColumn(1).width = 30;
  dash.getColumn(2).width = 40;

  // Report-wise summary
  const sum = reportSummary(rows);
  addSheet(
    wb,
    'Report Summary',
    ['ReportID', 'Report Name', ...langs.map((l) => l.toUpperCase()), 'Report Overall', 'Languages Fully Verified', 'Fields differing (by language)'],
    sum.map((s) => [s.reportId, s.reportName, ...langs.map((l) => s.langs[l] || 'N/A'), s.overall, s.verified, s.diffs]),
    [10, 40, ...langs.map(() => 11), 14, 14, 110],
    2,
  );

  addSheet(
    wb,
    'Audit',
    AUDIT_HEADERS,
    rows.map(auditValues),
    [10, 8, 60, ...CORE_CHECKS.map(() => 12), 11, 10, 36, 30, 55, 55, ...EXTRA_CHECKS.map(() => 13), 50, 110],
  );
  const fieldRows = rows.flatMap((r) => r.details.map((d) => fieldValues(r, d)));
  addSheet(wb, 'Field Comparison', FIELD_HEADERS, fieldRows, [10, 8, 50, 18, 28, 60, 60, 16, 11, 11, 60, 60]);
  addSheet(
    wb,
    'Differences Only',
    FIELD_HEADERS,
    rows.flatMap((r) => r.details.filter((d) => d.status !== 'PASS' && d.status !== 'N/A').map((d) => fieldValues(r, d))),
    [10, 8, 50, 18, 28, 60, 60, 16, 11, 11, 60, 60],
  );
  addSheet(
    wb,
    'Sitemap Check',
    ['ReportID', 'Language', 'Check', 'Expected', 'Sitemap value', 'Status', 'Note'],
    rows.flatMap((r) => r.details.filter((d) => d.check === 'Sitemap').map((d) => [r.reportId, r.lang, d.field, d.source, d.live, d.status, d.note || ''])),
    [10, 8, 32, 50, 70, 11, 70],
    2,
  );
  addSheet(
    wb,
    'Source Validation',
    ['ReportID', 'Language', 'File', 'Field', 'Value', 'Status', 'Note'],
    ctx.sourceIssues.map((i) => [i.reportId, i.lang, i.file, i.field, i.value, i.status, i.note]),
    [10, 8, 60, 20, 40, 11, 80],
    2,
  );
  const expected = ctx.reports.flatMap((rep) =>
    rep.records.map((r) => [
      rep.reportId, r.lang, rep.reportName, r.slug, r.reportTitle === null ? '(Leave as is)' : r.reportTitle, r.reportSubtitle === null ? '(Leave as is)' : r.reportSubtitle,
      r.metaTitle === null ? '(Leave as is)' : r.metaTitle, r.metaDescription === null ? '(Leave as is)' : r.metaDescription, r.bodySource, r.bodyBlocks.length,
      r.faqs.length, r.links.length, r.docFile, r.bodyFile || '', r.fileDate || '', r.cmsEditUrl || '',
    ]),
  );
  addSheet(
    wb,
    'Expected Data',
    ['ReportID', 'Language', 'Report Name', 'Slug', 'Report Title', 'Report Subtitle (H1)', 'Meta Title', 'Meta Description', 'Body source', 'Body blocks', 'FAQ rows', 'Links', 'PASTE file', 'BODY file', 'File date', 'CMS edit URL'],
    expected,
    [10, 8, 36, 36, 60, 36, 40, 60, 12, 10, 10, 8, 50, 40, 22, 50],
    2,
  );
  addSheet(
    wb,
    'Fetch Log',
    ['Requested URL', 'HTTP', 'Final URL', 'Redirect chain', 'Error', 'ms'],
    Object.values(ctx.inspected).map((r) => [r.requestedUrl, r.status === null ? '' : r.status, r.finalUrl, r.chain.map((h) => `${h.status} ${h.url}`).join(' → '), r.error || '', r.ms]),
    [70, 8, 70, 80, 50, 8],
    1,
  );

  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `translation-audit-${stamp()}.xlsx`);
}
