'use client';

import { Fragment, useMemo, useState } from 'react';
import type { AuditRow, FieldCheck } from '@/lib/types';
import { CORE_CHECKS, EXTRA_CHECKS } from '@/lib/types';
import { langsOf, matchLabel, reportSummary } from '@/lib/export';
import { langName } from '@/lib/languages';

export function Badge({ s, title }: { s: string; title?: string }) {
  return (
    <span className={`badge b-${String(s).replace(/[^A-Za-z]/g, '')}`} title={title}>
      {s}
    </span>
  );
}

export function Diff({ text }: { text?: string }) {
  if (!text) return null;
  const parts = text.split(/(\[-[\s\S]*?-\]|\{\+[\s\S]*?\+\})/g);
  return (
    <span className="diff">
      {parts.map((p, i) =>
        p.startsWith('[-') && p.endsWith('-]') ? (
          <del key={i}>{p.slice(2, -2)}</del>
        ) : p.startsWith('{+') && p.endsWith('+}') ? (
          <ins key={i}>{p.slice(2, -2)}</ins>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}

const SHORT: Record<string, string> = {
  'Meta Title': 'Title',
  'Meta Description': 'Desc',
  'Report Title (H2)': 'H2 Title',
  'URL Check': 'URL',
  'Report ID': 'ID',
  'Other Meta': 'Other',
  'Source File': 'File',
  'Link Language': 'Link lang',
};

function Details({ row, onlyDiff }: { row: AuditRow; onlyDiff: boolean }) {
  const list: FieldCheck[] = onlyDiff ? row.details.filter((d) => d.status !== 'PASS' && d.status !== 'N/A') : row.details;
  return (
    <div className="details">
      <div className="muted small">
        Expected: <a href={row.expectedUrl} target="_blank" rel="noreferrer">{row.expectedUrl}</a> ({row.urlSource}) · HTTP: {row.chain || row.http} · File: {row.sourceFile}
      </div>
      {!list.length && <p className="muted">No differences.</p>}
      {!!list.length && (
        <table className="inner">
          <thead>
            <tr>
              <th>Check</th>
              <th>Field</th>
              <th>Source File Value</th>
              <th>Live HTML Value</th>
              <th>Match/Mismatch</th>
              <th>Sim.</th>
              <th>Difference / note</th>
            </tr>
          </thead>
          <tbody>
            {list.map((d, i) => (
              <tr key={i}>
                <td className="nowrap">{d.check}</td>
                <td>{d.field}</td>
                <td className="txt">{d.source}</td>
                <td className="txt">{d.live}</td>
                <td>
                  <Badge s={d.status} title={matchLabel(d.status)} />
                </td>
                <td className="nowrap">{d.score === undefined ? '' : `${d.score}%`}</td>
                <td className="txt">
                  <Diff text={d.diff} />
                  {d.diff && d.note ? <br /> : null}
                  {d.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function ResultsView({ rows }: { rows: AuditRow[] }) {
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [langFilter, setLangFilter] = useState('ALL');
  const [reportFilter, setReportFilter] = useState('ALL');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [onlyDiff, setOnlyDiff] = useState(true);
  const [showAll, setShowAll] = useState(true);

  const langs = useMemo(() => langsOf(rows), [rows]);
  const summary = useMemo(() => reportSummary(rows), [rows]);
  const cols = showAll ? [...CORE_CHECKS, ...EXTRA_CHECKS] : CORE_CHECKS;
  const filtered = rows.filter(
    (r) =>
      (statusFilter === 'ALL' || r.overall === statusFilter) &&
      (langFilter === 'ALL' || r.lang === langFilter) &&
      (reportFilter === 'ALL' || r.reportId === reportFilter) &&
      (!q || `${r.reportId} ${r.reportName} ${r.expectedUrl} ${r.failing.join(' ')}`.toLowerCase().includes(q.toLowerCase())),
  );
  const n = (s: string) => rows.filter((r) => r.overall === s).length;

  return (
    <div>
      <div className="cards">
        <div className="stat">
          <b>{rows.length}</b>
          <span>report × language rows</span>
        </div>
        <div className="stat ok">
          <b>{n('PASS')}</b>
          <span>fully verified</span>
        </div>
        <div className="stat warn">
          <b>{n('WARNING')}</b>
          <span>warnings</span>
        </div>
        <div className="stat bad">
          <b>{n('FAIL')}</b>
          <span>failures</span>
        </div>
      </div>

      <h3>Report-wise summary</h3>
      <div className="scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>ID</th>
              <th>Report</th>
              {langs.map((l) => (
                <th key={l} title={langName(l)}>
                  {l.toUpperCase()}
                </th>
              ))}
              <th>Verified</th>
              <th>Fields differing</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((s) => (
              <tr key={s.reportId}>
                <td>{s.reportId}</td>
                <td>{s.reportName}</td>
                {langs.map((l) => (
                  <td
                    key={l}
                    className="click"
                    onClick={() => {
                      setReportFilter(s.reportId);
                      setLangFilter(l);
                      setStatusFilter('ALL');
                      setOpen(`${s.reportId}|${l}`);
                    }}
                  >
                    {s.langs[l] ? <Badge s={s.langs[l]} /> : <span className="muted">–</span>}
                  </td>
                ))}
                <td className="nowrap">{s.verified}</td>
                <td className="txt small">{s.diffs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Row-level audit</h3>
      <div className="row filters">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="ALL">All statuses</option>
          <option value="PASS">PASS</option>
          <option value="WARNING">WARNING</option>
          <option value="FAIL">FAIL</option>
        </select>
        <select value={langFilter} onChange={(e) => setLangFilter(e.target.value)}>
          <option value="ALL">All languages</option>
          {langs.map((l) => (
            <option key={l} value={l}>
              {langName(l)} ({l})
            </option>
          ))}
        </select>
        <select value={reportFilter} onChange={(e) => setReportFilter(e.target.value)}>
          <option value="ALL">All reports</option>
          {summary.map((s) => (
            <option key={s.reportId} value={s.reportId}>
              {s.reportId} – {s.reportName}
            </option>
          ))}
        </select>
        <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> all checks
        </label>
        <label>
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> details: differences only
        </label>
      </div>
      <div className="scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>ReportID</th>
              <th>Lang</th>
              <th>URL</th>
              {cols.map((c) => (
                <th key={c} title={c}>
                  {SHORT[c] || c}
                </th>
              ))}
              <th>Overall</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <Fragment key={r.key}>
                <tr className="click" onClick={() => setOpen(open === r.key ? null : r.key)}>
                  <td>{r.reportId}</td>
                  <td>{r.lang}</td>
                  <td className="url">
                    <a href={r.expectedUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      {r.expectedUrl.replace(/^https?:\/\/(www\.)?/, '')}
                    </a>
                  </td>
                  {cols.map((c) => (
                    <td key={c}>
                      <Badge s={r.summary[c] ? r.summary[c].status : 'N/A'} title={r.summary[c] ? r.summary[c].note || r.summary[c].live : ''} />
                    </td>
                  ))}
                  <td>
                    <Badge s={r.overall} />
                  </td>
                </tr>
                {open === r.key && (
                  <tr>
                    <td colSpan={cols.length + 4}>
                      <Details row={r} onlyDiff={onlyDiff} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Click a row to see Source File Value | Live HTML Value | Match/Mismatch for every field.</p>
    </div>
  );
}
