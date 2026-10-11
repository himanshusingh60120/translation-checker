import JSZip from 'jszip';
import { docxParagraphs } from './docx';
import { parsePasteDoc, type PasteDoc } from './paste-doc';
import { parseBodyHtml } from './html-blocks';
import { langFromName, langName, sortLangs } from './languages';
import { escapeHtml, guessLatin, isLatinLang, normalize, scriptShare } from './text';
import { urlsLoose } from './urls';
import type { ReportSource, SourceIssue, SourceRecord, Status } from './types';

interface Entry {
  path: string;
  name: string;
  date?: Date;
  bytes: () => Promise<Uint8Array>;
  text: () => Promise<string>;
}

export interface ParsedZip {
  reports: ReportSource[];
  issues: SourceIssue[];
  fileCount: number;
  inputs: string[];
}

async function collectZip(zip: JSZip, prefix: string, out: Entry[], depth: number): Promise<void> {
  for (const key of Object.keys(zip.files)) {
    const f = zip.files[key];
    if (!f || f.dir) continue;
    const path = key.replace(/\\/g, '/');
    if (/(^|\/)__MACOSX\//.test(path)) continue;
    const base = path.split('/').pop() || '';
    if (!base || base.startsWith('._') || base.startsWith('~$') || base === '.DS_Store') continue;
    if (/\.zip$/i.test(base) && depth < 3) {
      try {
        const inner = await JSZip.loadAsync(await f.async('uint8array'));
        await collectZip(inner, `${prefix}${path}!/`, out, depth + 1);
      } catch {
        /* not a readable zip – ignore */
      }
      continue;
    }
    out.push({ path: prefix + path, name: base, date: f.date, bytes: () => f.async('uint8array'), text: () => f.async('string') });
  }
}

const REPORT_RE = /^(.*?)[\s_-]*\(?(\d{2,7})\)?(?:[\s_-]+translations?)?$/i;

function locate(path: string) {
  const segs = path
    .replace(/!\//g, '/')
    .split('/')
    .filter(Boolean)
    .map((s) => s.replace(/\.zip$/i, ''));
  const file = segs.pop() || '';
  let reportIdx = -1;
  for (let i = segs.length - 1; i >= 0; i--)
    if (/translations?$/i.test(segs[i]) && REPORT_RE.test(segs[i])) {
      reportIdx = i;
      break;
    }
  if (reportIdx < 0)
    for (let i = segs.length - 1; i >= 0; i--)
      if (/\d{2,7}\)?$/.test(segs[i]) && REPORT_RE.test(segs[i])) {
        reportIdx = i;
        break;
      }
  let reportId = '';
  let reportName = '';
  let folder = '';
  if (reportIdx >= 0) {
    const m = segs[reportIdx].match(REPORT_RE);
    if (m) {
      reportName = m[1].trim();
      reportId = m[2];
      folder = segs.slice(0, reportIdx + 1).join('/');
    }
  }
  let lang = '';
  let langFolder = '';
  for (let i = segs.length - 1; i > reportIdx; i--) {
    const l = langFromName(segs[i]);
    if (l) {
      lang = l;
      langFolder = segs[i];
      break;
    }
  }
  const fm = file.match(/^(?:PASTE|BODY)[\s_-]+(.+?)\.(?:docx|html?)$/i);
  const fileLang = fm ? langFromName(fm[1]) : '';
  if (!lang) lang = fileLang;
  return { reportId, reportName, folder, lang, langFolder, fileLang, file };
}

interface Group {
  reportId: string;
  reportName: string;
  folder: string;
  lang: string;
  langFolder: string;
  fileLang: string;
  docs: Entry[];
  bodies: Entry[];
}

function toIso(d?: Date): string | undefined {
  if (!d || isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function sourceLanguageIssues(rec: SourceRecord, add: (f: string, s: Status, n: string, v?: string) => void) {
  const sample = [rec.metaTitle, rec.metaDescription, rec.reportSubtitle, ...rec.bodyBlocks.slice(0, 40)].filter(Boolean).join('\n');
  if (!sample || !rec.lang) return;
  if (!isLatinLang(rec.lang)) {
    const { share, letters } = scriptShare(sample, rec.lang);
    if (letters >= 30 && share < 0.5)
      add('translation language', 'WARNING', `Only ${Math.round(share * 100)}% of the letters are in ${langName(rec.lang)} script`, sample.slice(0, 120));
  } else {
    const g = guessLatin(sample);
    if (g.lang && g.lang !== rec.lang)
      add('translation language', 'WARNING', `Translated text looks like ${langName(g.lang)}, not ${langName(rec.lang)}`, sample.slice(0, 120));
  }
}

async function buildRecord(g: Group, onProgress?: (m: string) => void): Promise<SourceRecord> {
  const docEntry = g.docs.find((d) => /^PASTE/i.test(d.name)) || g.docs[0];
  const rec: SourceRecord = {
    reportId: g.reportId,
    reportName: g.reportName,
    lang: g.lang,
    langName: langName(g.lang),
    slug: '',
    folder: g.folder,
    docFile: docEntry ? docEntry.path : '',
    fileDate: toIso(docEntry ? docEntry.date : undefined),
    reportTitle: null,
    reportSubtitle: null,
    metaTitle: null,
    metaDescription: null,
    metaKeywords: null,
    bodyHtml: '',
    bodySource: 'none',
    bodyBlocks: [],
    bodyHeadings: [],
    bodyLinks: [],
    bodyImages: [],
    links: [],
    faqs: [],
    issues: [],
  };
  const add = (field: string, status: Status, note: string, value = '') =>
    rec.issues.push({ reportId: rec.reportId, lang: rec.lang, file: rec.docFile || g.folder, field, value: String(value).slice(0, 300), status, note });

  if (!docEntry) add('PASTE docx', 'NOT FOUND', 'No PASTE-<Language>.docx in this language folder');
  if (g.docs.length > 1) add('PASTE docx', 'WARNING', `${g.docs.length} .docx files in the folder; used ${docEntry ? docEntry.name : '?'}`);

  let doc: PasteDoc | null = null;
  if (docEntry) {
    onProgress && onProgress(`Reading ${docEntry.path}`);
    try {
      doc = parsePasteDoc(await docxParagraphs(await docEntry.bytes()));
    } catch (e: any) {
      add('PASTE docx', 'FAIL', `Could not read the DOCX: ${e && e.message ? e.message : e}`);
    }
  }

  if (doc) {
    if (!rec.reportId) rec.reportId = doc.headerId || doc.editId || '';
    if (!rec.reportName) rec.reportName = doc.headerName || '';
    if (doc.headerId && doc.headerId !== rec.reportId) add('report ID', 'FAIL', `Document header says report ${doc.headerId}, folder says ${rec.reportId}`, doc.headerId);
    if (doc.editId && doc.editId !== rec.reportId) add('report ID', 'FAIL', `CMS edit link is for report ${doc.editId}, folder says ${rec.reportId}`, doc.editUrl || '');
    if (doc.headerName && rec.reportName && normalize(doc.headerName) !== normalize(rec.reportName))
      add('report name', 'WARNING', `Document header "${doc.headerName}" differs from folder name "${rec.reportName}"`, doc.headerName);

    const docLang = langFromName(doc.langName || '');
    if (!rec.lang) rec.lang = docLang;
    if (docLang && rec.lang && docLang !== rec.lang) add('language', 'FAIL', `Document is for ${doc.langName} but sits in the "${g.langFolder || '?'}" folder`, doc.langName || '');
    if (!doc.langName) add('language', 'WARNING', 'Language not stated in the document header');
    if (g.fileLang && rec.lang && g.fileLang !== rec.lang) add('language', 'FAIL', `File name says ${langName(g.fileLang)}, folder says ${langName(rec.lang)}`);
    rec.langName = langName(rec.lang);

    rec.slug = doc.slug || '';
    if (!rec.slug) add('slug', 'WARNING', 'Slug not found ("confirm the Slug URL field reads …")');
    rec.cmsEditUrl = doc.editUrl;

    const fieldMap: [keyof SourceRecord, string, string][] = [
      ['reportTitle', 'report title', 'Report Title'],
      ['reportSubtitle', 'report subtitle', 'Report Subtitle'],
      ['metaTitle', 'meta title', 'Meta Title'],
      ['metaDescription', 'meta description', 'Meta Description'],
      ['metaKeywords', 'meta keywords', 'Meta Keywords'],
    ];
    for (const [key, label, display] of fieldMap) {
      const v = doc.fields[label];
      (rec as any)[key] = v === undefined ? (key === 'metaKeywords' ? null : '') : v;
      if (key === 'metaKeywords') continue;
      if (v === undefined) add(display, 'NOT FOUND', `${display} field not found in the document`);
      else if (v === '') add(display, 'NOT FOUND', `${display} is empty`);
    }

    // ---- body
    const hint = (doc.bodyFileHint || '').toLowerCase();
    const bodyEntry = g.bodies.find((b) => hint && b.name.toLowerCase() === hint) || g.bodies.find((b) => /^BODY/i.test(b.name)) || g.bodies[0];
    let html = '';
    if (bodyEntry) {
      html = await bodyEntry.text();
      rec.bodySource = 'body-file';
      rec.bodyFile = bodyEntry.path;
    }
    if (doc.bodyHtml) {
      if (!html) {
        html = doc.bodyHtml;
        rec.bodySource = 'docx-html';
      } else {
        const a = parseBodyHtml(html).blocks.map((b) => normalize(b)).join('\n');
        const b = parseBodyHtml(doc.bodyHtml).blocks.map((x) => normalize(x)).join('\n');
        if (a !== b) add('body', 'WARNING', 'The BODY file and the HTML inside the DOCX differ; the BODY file was used');
      }
    }
    if (!html && doc.readingCopy.length) {
      html = doc.readingCopy
        .filter((l) => !/^\\?\[?chart image/i.test(l))
        .map((l) => `<p>${escapeHtml(l)}</p>`)
        .join('\n');
      rec.bodySource = 'reading-copy';
      add('body', 'WARNING', doc.bodyFileHint ? `${doc.bodyFileHint} is not in the ZIP; compared against the reading copy in the DOCX` : 'No HTML body found; compared against the reading copy in the DOCX');
    }
    if (!html) add('body', 'NOT FOUND', doc.bodyFileHint ? `${doc.bodyFileHint} is not in the ZIP` : 'No description body found');
    if (html) {
      const parsed = parseBodyHtml(html);
      rec.bodyHtml = html;
      rec.bodyBlocks = parsed.blocks;
      rec.bodyHeadings = rec.bodySource === 'reading-copy' ? [] : parsed.headings;
      rec.bodyLinks = parsed.links;
      rec.bodyImages = parsed.images;
    }

    // ---- links
    rec.links = doc.links;
    rec.expectedLinkCount = doc.expectedLinkCount;
    if (doc.expectedLinkCount !== undefined && doc.links.length && doc.expectedLinkCount !== doc.links.length)
      add('links', 'WARNING', `Document says the body carries ${doc.expectedLinkCount} links but the table lists ${doc.links.length}`);
    if (rec.bodySource !== 'reading-copy' && rec.bodyLinks.length) {
      for (const l of doc.links)
        if (!rec.bodyLinks.some((b) => urlsLoose(b.href, l.href))) add('links', 'WARNING', `Link "${l.anchor}" from the links table is not in the body HTML`, l.href);
      if (doc.expectedLinkCount !== undefined && rec.bodyLinks.length !== doc.expectedLinkCount)
        add('links', 'WARNING', `Body HTML has ${rec.bodyLinks.length} links, document says ${doc.expectedLinkCount}`);
    }

    // ---- FAQs
    rec.faqs = doc.faqs;
    rec.expectedFaqCount = doc.expectedFaqCount;
    if (doc.expectedFaqCount !== undefined && doc.expectedFaqCount !== doc.faqs.length)
      add('FAQ', 'WARNING', `Document says ${doc.expectedFaqCount} rows change but ${doc.faqs.length} rows were found`);
    for (const f of doc.faqs) {
      if (!f.question) add(`FAQ row ${f.rowId}`, 'WARNING', 'Question is empty');
      if (!f.answer && !f.answerUnchanged) add(`FAQ row ${f.rowId}`, 'WARNING', 'Answer is empty');
    }

    for (const w of doc.warnings) add('document', 'WARNING', w);
    sourceLanguageIssues(rec, add);
  }
  if (!rec.lang) add('language', 'FAIL', 'Language could not be determined from folder, file name or document');
  if (!rec.reportId) add('report ID', 'FAIL', 'Report ID could not be determined from folder or document');
  for (const i of rec.issues) {
    i.reportId = rec.reportId;
    i.lang = rec.lang;
  }
  return rec;
}

/** Read Drive ZIP downloads (or loose files / an unzipped folder) into report records. */
export async function parseTranslationInputs(files: File[], onProgress?: (m: string) => void): Promise<ParsedZip> {
  const entries: Entry[] = [];
  const issues: SourceIssue[] = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      onProgress && onProgress(`Opening ${file.name}`);
      try {
        const zip = await JSZip.loadAsync(file);
        await collectZip(zip, `${file.name}!/`, entries, 0);
      } catch (e: any) {
        issues.push({ reportId: '', lang: '', file: file.name, field: 'zip', value: '', status: 'FAIL', note: `Could not open ZIP: ${e && e.message ? e.message : e}` });
      }
    } else {
      const rel = (file as any).webkitRelativePath || file.name;
      entries.push({
        path: rel,
        name: file.name,
        date: new Date(file.lastModified),
        bytes: async () => new Uint8Array(await file.arrayBuffer()),
        text: () => file.text(),
      });
    }
  }

  const groups = new Map<string, Group>();
  for (const e of entries) {
    const isDoc = /\.docx$/i.test(e.name);
    const isBody = /\.html?$/i.test(e.name);
    if (!isDoc && !isBody) continue;
    const loc = locate(e.path);
    const key = `${loc.reportId || '?'}|${loc.lang || '?'}|${loc.reportId ? '' : e.path}`;
    let g = groups.get(key);
    if (!g) {
      g = { reportId: loc.reportId, reportName: loc.reportName, folder: loc.folder, lang: loc.lang, langFolder: loc.langFolder, fileLang: loc.fileLang, docs: [], bodies: [] };
      groups.set(key, g);
    }
    (isDoc ? g.docs : g.bodies).push(e);
  }

  const records: SourceRecord[] = [];
  for (const g of groups.values()) {
    if (!g.docs.length && !g.bodies.length) continue;
    records.push(await buildRecord(g, onProgress));
  }

  const byReport = new Map<string, ReportSource>();
  for (const r of records) {
    const id = r.reportId || '?';
    let rep = byReport.get(id);
    if (!rep) {
      rep = { reportId: id, reportName: r.reportName, slug: r.slug, folder: r.folder, records: [] };
      byReport.set(id, rep);
    }
    if (!rep.slug && r.slug) rep.slug = r.slug;
    if (!rep.reportName && r.reportName) rep.reportName = r.reportName;
    const dup = rep.records.find((x) => x.lang === r.lang);
    if (dup) {
      issues.push({ reportId: id, lang: r.lang, file: r.docFile, field: 'duplicate', value: '', status: 'WARNING', note: `Two translation sets for ${langName(r.lang)}; kept ${dup.docFile}` });
      continue;
    }
    rep.records.push(r);
  }
  for (const rep of byReport.values()) {
    const order = sortLangs(rep.records.map((r) => r.lang));
    rep.records.sort((a, b) => order.indexOf(a.lang) - order.indexOf(b.lang));
    const slugs = new Set(rep.records.map((r) => r.slug).filter(Boolean));
    if (slugs.size > 1)
      for (const r of rep.records)
        r.issues.push({ reportId: rep.reportId, lang: r.lang, file: r.docFile, field: 'slug', value: r.slug, status: 'WARNING', note: `Languages of this report name different slugs: ${Array.from(slugs).join(', ')}` });
  }
  const reports = Array.from(byReport.values()).sort((a, b) => (Number(a.reportId) || 0) - (Number(b.reportId) || 0));
  return { reports, issues, fileCount: entries.length, inputs: files.map((f) => f.name) };
}
