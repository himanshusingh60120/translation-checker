import type { FaqItem, LinkItem } from './types';

/**
 * Parser for the Kings Research "PASTE-<Language>.docx" CMS instruction documents:
 *
 *   <Report Name> (<ID>) <Language>          / <Language> · Edit Report
 *   Edit screen: https://cms.kingsresearch.com/reports/language-edit/<ID>/<n>
 *   ... confirm the Slug URL field reads <slug> and the language tab shows <Language>.
 *   REPORT INFORMATION / SEO   -> "Label *" followed by the value or "Leave as is."
 *   DESCRIPTION                -> HTML source lines (or "Open BODY-<Language>.html"),
 *                                 reading copy, "The body carries N links" + links table
 *   TABLE OF CONTENT / SNAPSHOT / SEGMENTS
 *   FAQS                       -> Row <id> / Currently reads: <old> / Question / <new> / Answer / <new>
 *   COMMENT
 */
export interface PasteDoc {
  headerName?: string;
  headerId?: string;
  langName?: string;
  editUrl?: string;
  editId?: string;
  editLangIndex?: string;
  slug?: string;
  /** label -> value; null = "Leave as is"; missing key = label not in document */
  fields: Record<string, string | null>;
  bodyHtml?: string;
  bodyFileHint?: string;
  readingCopy: string[];
  expectedLinkCount?: number;
  links: LinkItem[];
  faqs: FaqItem[];
  expectedFaqCount?: number;
  comment?: string;
  warnings: string[];
}

const SIMPLE_LABELS = [
  'report title', 'report subtitle', 'slug url', 'forecast period', 'release date', 'base year',
  'report banner preview', 'region', 'country', 'category', 'subcategory', 'no. of pages', 'prod. price',
  'multi price', 'corp. price', 'data points', 'report type', 'author', 'cluster',
  'meta title', 'meta description', 'meta keywords',
];
const OTHER_LABELS = [
  'description', 'table of content', 'table of contents', 'snapshot (label / value)',
  'segments (label / value)', 'faqs (question / answer)', 'comment',
];
const LABELS = new Set([...SIMPLE_LABELS, ...OTHER_LABELS]);
const SECTIONS = new Set([
  'report information', 'seo', 'description', 'table of content', 'table of contents', 'snapshot',
  'snapshots', 'segments', 'faqs', 'faq', 'comment', 'comments',
]);

function labelOf(line: string): string | null {
  const t = line
    .replace(/\\\*/g, '*')
    .replace(/\s*\*+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return LABELS.has(t) ? t : null;
}

function sectionOf(line: string): string | null {
  const t = line.trim();
  if (!t || t !== t.toUpperCase() || !/[A-Z]/.test(t)) return null;
  const k = t.toLowerCase().replace(/\s+/g, ' ');
  return SECTIONS.has(k) ? k : null;
}

const isLeave = (v: string) => /^leave (it )?as is\b/i.test((v || '').trim());

export function parsePasteDoc(rawLines: string[]): PasteDoc {
  const doc: PasteDoc = { fields: {}, readingCopy: [], links: [], faqs: [], warnings: [] };
  const L = rawLines.map((l) => l.replace(/\u00A0/g, ' ').trim()).filter((l) => l.length > 0);

  // ---- header
  for (const s of L.slice(0, 15)) {
    const m = s.match(/^(.+?)\s*\((\d{1,7})\)(.*)$/);
    if (m && !doc.headerId) {
      doc.headerName = m[1].trim();
      doc.headerId = m[2];
      const rest = m[3].trim();
      if (/^[A-Za-z][A-Za-z ]{1,30}$/.test(rest) && !doc.langName) doc.langName = rest;
    }
    const m2 = s.match(/^([A-Za-z][A-Za-z ]{1,30}?)\s*[\u00B7\u2022|-]\s*Edit Report/i);
    if (m2) doc.langName = m2[1].trim();
  }
  const all = L.join('\n');
  let m = all.match(/https?:\/\/[^\s<>]*language-edit\/(\d+)\/(\d+)[^\s<>]*/i);
  if (m) {
    doc.editUrl = m[0];
    doc.editId = m[1];
    doc.editLangIndex = m[2];
  }
  m = all.match(/Slug URL field reads\s+([a-z0-9][a-z0-9\-_/]*)/i);
  if (m) doc.slug = m[1].replace(/[-_/]+$/, '');
  if (!doc.langName) {
    m = all.match(/language tab shows\s+([A-Za-z][A-Za-z ]*?)\s*[.\n]/i);
    if (m) doc.langName = m[1].trim();
  }

  // ---- sections
  type Mode = 'fields' | 'desc' | 'faq' | 'comment' | 'other';
  let mode: Mode = 'fields';
  let section = '';
  let label: string | null = null;
  let buf: string[] = [];
  const desc: string[] = [];
  const faq: string[] = [];
  const comment: string[] = [];
  const other: Record<string, string[]> = {};
  const commit = () => {
    if (label && SIMPLE_LABELS.includes(label)) {
      const v = buf.join('\n').trim();
      doc.fields[label] = isLeave(v) ? null : v;
    }
    label = null;
    buf = [];
  };

  for (const s of L) {
    const sec = sectionOf(s);
    if (sec) {
      commit();
      section = sec;
      if (sec === 'description') mode = 'desc';
      else if (sec.startsWith('faq')) mode = 'faq';
      else if (sec.startsWith('comment')) mode = 'comment';
      else if (sec === 'report information' || sec === 'seo') mode = 'fields';
      else mode = 'other';
      continue;
    }
    if (mode === 'fields') {
      const lab = labelOf(s);
      if (lab) {
        commit();
        label = lab;
      } else if (label) buf.push(s);
      continue;
    }
    if (mode === 'desc') desc.push(s);
    else if (mode === 'faq') faq.push(s);
    else if (mode === 'comment') {
      if (!labelOf(s)) comment.push(s);
    } else if (!labelOf(s)) (other[section] = other[section] || []).push(s);
  }
  commit();

  for (const [sec, lines] of Object.entries(other)) {
    if (lines.some((l) => !isLeave(l))) doc.warnings.push(`${sec.toUpperCase()} section contains changes that this tool does not verify`);
  }

  // ---- description
  if (desc.length) {
    const start = labelOf(desc[0]) === 'description' ? 1 : 0;
    const below = desc.findIndex((l) => /^Below is the same body/i.test(l));
    const end = desc.findIndex((l) => /^End of the reading copy/i.test(l));
    const htmlEnd = below >= 0 ? below : end >= 0 ? end : desc.length;
    let first = -1;
    for (let k = start; k < htmlEnd; k++) {
      if (/^<\s*(?:[a-zA-Z][a-zA-Z0-9]*|!--)/.test(desc[k])) {
        first = k;
        break;
      }
    }
    if (first >= 0) doc.bodyHtml = desc.slice(first, htmlEnd).join('\n');
    const hint = desc.slice(0, htmlEnd).join('\n').match(/\b(BODY[-_ ][^\s()<>"']+?\.html?)\b/i);
    if (hint) doc.bodyFileHint = hint[1];
    if (below >= 0) doc.readingCopy = desc.slice(below + 1, end >= 0 ? end : desc.length);
    if (end >= 0) {
      const c = desc[end].match(/carries\s+(\d+)\s+links?/i);
      if (c) doc.expectedLinkCount = Number(c[1]);
      else if (/carries\s+no\s+links?/i.test(desc[end])) doc.expectedLinkCount = 0;
      const rest = desc.slice(end + 1);
      for (let k = 0; k < rest.length; k++) {
        const a = rest[k];
        if (/^(anchor text|anchor|link|url)$/i.test(a)) continue;
        const nxt = (rest[k + 1] || '').replace(/^<|>$/g, '').trim();
        if (!/^https?:\/\//i.test(a) && /^https?:\/\//i.test(nxt)) {
          doc.links.push({ anchor: a, href: nxt });
          k++;
        }
      }
    }
  }

  // ---- FAQs
  let cur: { rowId: string; current?: string; question?: string; answer?: string } | null = null;
  let field: 'q' | 'a' | null = null;
  let newRows = 0;
  const pushCur = () => {
    if (!cur) return;
    const q = (cur.question || '').trim();
    const a = (cur.answer || '').trim();
    const item: FaqItem = { rowId: cur.rowId, current: cur.current, question: q, answer: a };
    if (isLeave(q)) {
      item.questionUnchanged = true;
      item.question = cur.current || '';
    }
    if (isLeave(a)) {
      item.answerUnchanged = true;
      item.answer = '';
    }
    doc.faqs.push(item);
  };
  for (const s of faq) {
    if (/^FAQs?\s*\(Question/i.test(s)) continue;
    const row = s.match(/^(?:Row\s+(\d+)|(New|Add(?:ed)?)\s+row\b.*)$/i);
    if (row) {
      pushCur();
      cur = { rowId: row[1] || `new-${++newRows}` };
      field = null;
      continue;
    }
    if (!cur) {
      // preamble such as "All 12 rows change, question AND answer."
      const cnt = s.match(/(\d+)\s+rows?\b/i);
      if (cnt && doc.expectedFaqCount === undefined) doc.expectedFaqCount = Number(cnt[1]);
      continue;
    }
    const cr = s.match(/^Currently reads:\s*(.*)$/i);
    if (cr) {
      cur.current = cr[1].trim();
      continue;
    }
    if (/^Question:?$/i.test(s)) {
      field = 'q';
      continue;
    }
    if (/^Answer:?$/i.test(s)) {
      field = 'a';
      continue;
    }
    if (field === 'q') cur.question = (cur.question ? cur.question + '\n' : '') + s;
    else if (field === 'a') cur.answer = (cur.answer ? cur.answer + '\n' : '') + s;
  }
  pushCur();

  if (comment.length) doc.comment = comment.join('\n');
  return doc;
}
