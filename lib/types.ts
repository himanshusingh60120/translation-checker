export type Status = 'PASS' | 'FAIL' | 'WARNING' | 'NOT FOUND' | 'N/A';

export const STATUS_RANK: Record<Status, number> = { 'N/A': 0, PASS: 1, WARNING: 2, 'NOT FOUND': 3, FAIL: 4 };

export function worst(statuses: Status[]): Status {
  let out: Status = 'N/A';
  for (const s of statuses) if (STATUS_RANK[s] > STATUS_RANK[out]) out = s;
  return out;
}

/** Required audit columns, in this order. */
export const CORE_CHECKS = ['HTTP', 'Meta Title', 'Meta Description', 'H1', 'Canonical', 'Hreflang', 'Content'];
/** Supporting checks. "Link Language" is advisory by default (does not affect Overall). */
export const EXTRA_CHECKS = [
  'Sitemap',
  'URL Check',
  'Report ID',
  'Report Title (H2)',
  'FAQ',
  'Links',
  'Language',
  'Other Meta',
  'Source File',
  'Link Language',
];
export const ALL_CHECKS: string[] = [...CORE_CHECKS, ...EXTRA_CHECKS];

export interface FieldCheck {
  check: string;
  field: string;
  source: string; // value from the translation file (source of truth)
  live: string; // value from the live HTML
  status: Status;
  score?: number; // similarity 0-100
  diff?: string; // [-only in file-] {+only on live page+}
  note?: string;
}

export interface SourceIssue {
  reportId: string;
  lang: string;
  file: string;
  field: string;
  value: string;
  status: Status;
  note: string;
}

export interface FaqItem {
  rowId: string;
  current?: string; // "Currently reads" = old question still in the CMS
  question: string;
  answer: string;
  questionUnchanged?: boolean;
  answerUnchanged?: boolean;
}
export interface LinkItem {
  anchor: string;
  href: string;
}
export interface ImageItem {
  src: string;
  alt: string;
}

export interface SourceRecord {
  reportId: string;
  reportName: string;
  lang: string;
  langName: string;
  slug: string;
  folder: string;
  docFile: string;
  bodyFile?: string;
  fileDate?: string;
  cmsEditUrl?: string;
  /** null = "Leave as is" in the PASTE doc (field not changed) */
  reportTitle: string | null;
  reportSubtitle: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  metaKeywords: string | null;
  bodyHtml: string;
  bodySource: 'body-file' | 'docx-html' | 'reading-copy' | 'none';
  bodyBlocks: string[];
  bodyHeadings: string[];
  bodyLinks: LinkItem[];
  bodyImages: ImageItem[];
  links: LinkItem[];
  expectedLinkCount?: number;
  faqs: FaqItem[];
  expectedFaqCount?: number;
  issues: SourceIssue[];
}

export interface ReportSource {
  reportId: string;
  reportName: string;
  slug: string;
  folder: string;
  records: SourceRecord[];
}

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}
export interface SitemapInfo {
  lang: string;
  url: string;
  status: number | null;
  count: number;
  error?: string;
}
export interface SitemapResult {
  index: string;
  indexStatus?: number | null;
  fetchedAt: string;
  sitemaps: SitemapInfo[];
  languages: string[];
  /** entries[reportId][lang] = sitemap URLs carrying that report ID */
  entries: Record<string, Record<string, SitemapEntry[]>>;
  notes?: string[];
  error?: string;
}

export interface PageData {
  titles: string[];
  meta: Record<string, string[]>;
  htmlLang: string;
  canonical: string[];
  canonicalRaw: string[];
  hreflang: { lang: string; href: string; raw: string }[];
  h1: string[];
  h2: string[];
  h3: string[];
  bodyBlocks: string[];
  links: { text: string; href: string }[];
  images: ImageItem[];
  reportIds: Record<string, string[]>;
  faqLd: { q: string; a: string }[];
  /** Text embedded in Next.js page data (__NEXT_DATA__ / RSC payload), e.g. collapsed FAQ answers */
  dataText: string;
}

export interface InspectResult {
  requestedUrl: string;
  finalUrl: string;
  status: number | null;
  chain: { status: number; url: string }[];
  error?: string;
  headers: Record<string, string>;
  page?: PageData;
  ms: number;
}

export interface Settings {
  origin: string;
  sitemapIndex: string;
  concurrency: number;
  requireXDefault: boolean;
  compareEnglish: boolean;
  advisoryChecks: string[];
  hreflangMap: Record<string, string>;
}

export interface AuditRow {
  key: string;
  reportId: string;
  reportName: string;
  lang: string;
  langName: string;
  expectedUrl: string;
  urlSource: string;
  finalUrl: string;
  http: string;
  chain: string;
  summary: Record<string, FieldCheck>;
  details: FieldCheck[];
  overall: Status;
  failing: string[];
  sourceFile: string;
}
