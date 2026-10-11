import type { Status } from './types';

// ---------------------------------------------------------------- entities
const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0', ndash: '\u2013', mdash: '\u2014',
  lsquo: '\u2018', rsquo: '\u2019', sbquo: '\u201A', ldquo: '\u201C', rdquo: '\u201D', bdquo: '\u201E',
  hellip: '\u2026', trade: '\u2122', reg: '\u00AE', copy: '\u00A9', euro: '\u20AC', pound: '\u00A3',
  yen: '\u00A5', cent: '\u00A2', deg: '\u00B0', middot: '\u00B7', bull: '\u2022', times: '\u00D7',
  divide: '\u00F7', laquo: '\u00AB', raquo: '\u00BB', lsaquo: '\u2039', rsaquo: '\u203A', shy: '\u00AD',
  sect: '\u00A7', para: '\u00B6', plusmn: '\u00B1', le: '\u2264', ge: '\u2265', ne: '\u2260',
  thinsp: '\u2009', ensp: '\u2002', emsp: '\u2003', zwj: '\u200D', zwnj: '\u200C', iexcl: '\u00A1',
  iquest: '\u00BF', ordm: '\u00BA', ordf: '\u00AA', micro: '\u00B5', permil: '\u2030', prime: '\u2032',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  agrave: 'à', egrave: 'è', igrave: 'ì', ograve: 'ò', ugrave: 'ù', Agrave: 'À', Egrave: 'È',
  acirc: 'â', ecirc: 'ê', icirc: 'î', ocirc: 'ô', ucirc: 'û', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô',
  atilde: 'ã', otilde: 'õ', ntilde: 'ñ', Atilde: 'Ã', Otilde: 'Õ', Ntilde: 'Ñ',
  ccedil: 'ç', Ccedil: 'Ç', euml: 'ë', iuml: 'ï', yuml: 'ÿ', oelig: 'œ', OElig: 'Œ',
  aelig: 'æ', AElig: 'Æ', oslash: 'ø', Oslash: 'Ø', aring: 'å', Aring: 'Å',
};

export const ENTITY_RE = /&(?:[a-zA-Z][a-zA-Z0-9]{1,9}|#\d{2,7}|#[xX][0-9a-fA-F]{2,6});/;

export function decodeEntities(input: string): string {
  if (!input || input.indexOf('&') < 0) return input || '';
  return input.replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,9});/g, (m: string, e: string) => {
    if (e[0] === '#') {
      const hex = e[1] === 'x' || e[1] === 'X';
      const cp = parseInt(hex ? e.slice(2) : e.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return m;
      try {
        return String.fromCodePoint(cp);
      } catch {
        return m;
      }
    }
    const v = NAMED[e] !== undefined ? NAMED[e] : NAMED[e.toLowerCase()];
    return v !== undefined ? v : m;
  });
}

export function escapeHtml(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function stripTags(s: string): string {
  return cleanWs(decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')));
}

export function cleanWs(s: string): string {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- normalisation
/** Entities, markup, Unicode compatibility forms, quotes/dashes, invisible chars and whitespace. */
export function normalize(input: unknown, fold = true): string {
  if (input === null || input === undefined) return '';
  let s = decodeEntities(String(input));
  if (/<\/?[a-zA-Z][^<>]*>/.test(s)) s = s.replace(/<\/?[a-zA-Z][^<>]*>/g, ' ');
  s = decodeEntities(s);
  s = s
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u00B4\u2039\u203A]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return fold ? s.toLowerCase() : s;
}

export const CJK_LANGS = new Set(['zh', 'ja']);
export function isCJK(lang: string): boolean {
  return CJK_LANGS.has(lang);
}

/** Language-aware normalisation: Chinese/Japanese ignore all whitespace. */
export function norm(input: unknown, lang = '', fold = true): string {
  const s = normalize(input, fold);
  return isCJK(lang) ? s.replace(/\s+/g, '') : s;
}

export function stripPunct(s: string): string {
  return s.replace(/[\p{P}\p{S}\p{Z}\p{C}]/gu, '');
}

// ---------------------------------------------------------------- similarity / diff
/** Character-bigram Dice coefficient, 0-100. Fast and robust for long texts. */
export function similarity(a: string, b: string): number {
  if (a === b) return 100;
  if (!a || !b || a.length < 2 || b.length < 2) return 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  let inter = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const c = counts.get(g) || 0;
    if (c > 0) {
      counts.set(g, c - 1);
      inter++;
    }
  }
  return (200 * inter) / (a.length + b.length - 2);
}

export function bestMatch(needle: string, candidates: string[]): { text: string; score: number; index: number } {
  let text = '';
  let score = 0;
  let index = -1;
  candidates.forEach((c, i) => {
    if (!c) return;
    const lo = Math.min(c.length, needle.length);
    const hi = Math.max(c.length, needle.length);
    if (hi && lo / hi < 0.5) return;
    const s = similarity(needle, c);
    if (s > score) {
      score = s;
      text = c;
      index = i;
    }
  });
  return { text, score, index };
}

/** Word (or character for CJK) diff: [-only in translation file-] {+only on live page+} */
export function wordDiff(a: string, b: string, cjk = false, limit = 700): string {
  if (a === b) return '';
  const MAX = 400;
  const ta = (cjk ? Array.from(a) : a.split(' ')).slice(0, MAX);
  const tb = (cjk ? Array.from(b) : b.split(' ')).slice(0, MAX);
  const n = ta.length;
  const m = tb.length;
  const dp: number[][] = [];
  for (let i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const sep = cjk ? '' : ' ';
  const out: string[] = [];
  let eq: string[] = [];
  let del: string[] = [];
  let ins: string[] = [];
  const flushEq = () => {
    if (!eq.length) return;
    out.push(eq.length > 8 ? [...eq.slice(0, 3), '…', ...eq.slice(-3)].join(sep) : eq.join(sep));
    eq = [];
  };
  const flushChange = () => {
    if (del.length) out.push('[-' + del.join(sep) + '-]');
    if (ins.length) out.push('{+' + ins.join(sep) + '+}');
    del = [];
    ins = [];
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ta[i] === tb[j]) {
      flushChange();
      eq.push(ta[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      flushEq();
      del.push(ta[i++]);
    } else {
      flushEq();
      ins.push(tb[j++]);
    }
  }
  if (i < n || j < m) flushEq();
  while (i < n) del.push(ta[i++]);
  while (j < m) ins.push(tb[j++]);
  flushChange();
  flushEq();
  const s = out.join(' ');
  return s.length > limit ? s.slice(0, limit) + '…' : s;
}

/** Compare a short field. PASS = identical after normalisation; WARNING = only case/punctuation/spacing; FAIL otherwise. */
export function compareText(src: string, live: string, lang = ''): { status: Status; score: number; diff: string; note: string } {
  const a = norm(src, lang, false);
  const b = norm(live, lang, false);
  const notes: string[] = [];
  let status: Status;
  if (a === b) status = 'PASS';
  else if (a.toLowerCase() === b.toLowerCase()) {
    status = 'WARNING';
    notes.push('Differs only in letter case');
  } else if (stripPunct(a.toLowerCase()) === stripPunct(b.toLowerCase())) {
    status = 'WARNING';
    notes.push('Differs only in punctuation / spacing');
  } else status = 'FAIL';
  if (live && ENTITY_RE.test(live)) {
    notes.push('Live value contains undecoded HTML entities (double-encoded)');
    if (status === 'PASS') status = 'WARNING';
  }
  const score = Math.round(similarity(a.toLowerCase(), b.toLowerCase()) * 10) / 10;
  return { status, score, diff: a === b ? '' : wordDiff(a, b, isCJK(lang)), note: notes.join('; ') };
}

// ---------------------------------------------------------------- numbers
const NUM_RE = /(?<!\d)\d{1,3}(?:[ \u00A0\u202F]\d{3})+(?:[.,]\d+)?(?!\d)|\d+(?:[.,]\d+)*/g;

/** '1,450.0' / '1.450,0' / '1 450,0' -> '1450'; '2,83' / '2.83' -> '2.83' */
export function canonNumber(token: string): string {
  let t = token.replace(/[ \u00A0\u202F]/g, '');
  if (t.includes(',') && t.includes('.')) {
    const dec = t.lastIndexOf(',') > t.lastIndexOf('.') ? ',' : '.';
    const thou = dec === ',' ? '.' : ',';
    t = t.split(thou).join('').replace(dec, '.');
  } else if (t.includes(',') || t.includes('.')) {
    const sep = t.includes(',') ? ',' : '.';
    const parts = t.split(sep);
    t = parts.length > 2 || parts[parts.length - 1].length === 3 ? parts.join('') : parts.join('.');
  }
  const v = Number(t);
  if (!Number.isFinite(v)) return token;
  return String(Math.round(v * 1e6) / 1e6);
}

export function numberKey(s: string): string {
  const t = normalize(s, false);
  const m = t.match(NUM_RE) || [];
  return m.map(canonNumber).sort().join('|');
}

// ---------------------------------------------------------------- scripts & language
export function scriptOf(ch: string): string {
  const cp = ch.codePointAt(0) || 0;
  if (cp < 0x80) return /[A-Za-z]/.test(ch) ? 'latin' : 'other';
  if ((cp >= 0xc0 && cp <= 0x24f) || (cp >= 0x1e00 && cp <= 0x1eff)) return 'latin';
  if (cp >= 0x400 && cp <= 0x52f) return 'cyrillic';
  if (cp >= 0x370 && cp <= 0x3ff) return 'greek';
  if ((cp >= 0x600 && cp <= 0x6ff) || (cp >= 0x750 && cp <= 0x77f) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)) return 'arabic';
  if ((cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f) || (cp >= 0xac00 && cp <= 0xd7af)) return 'hangul';
  if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff) || (cp >= 0xff66 && cp <= 0xff9f)) return 'kana';
  if ((cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff)) return 'han';
  if (cp >= 0x0e00 && cp <= 0x0e7f) return 'thai';
  if (cp >= 0x0900 && cp <= 0x097f) return 'devanagari';
  return 'other';
}

const SCRIPTS: Record<string, string[]> = {
  zh: ['han'], ja: ['han', 'kana'], ko: ['hangul'], ru: ['cyrillic'], uk: ['cyrillic'], bg: ['cyrillic'],
  ar: ['arabic'], fa: ['arabic'], th: ['thai'], hi: ['devanagari'], el: ['greek'],
};
export function expectedScripts(lang: string): string[] {
  return SCRIPTS[lang] || ['latin'];
}
export function isLatinLang(lang: string): boolean {
  return expectedScripts(lang)[0] === 'latin';
}

export function scriptShare(text: string, lang: string): { share: number; letters: number } {
  const exp = new Set(expectedScripts(lang));
  let letters = 0;
  let hit = 0;
  for (const ch of text || '') {
    if (!/\p{L}/u.test(ch)) continue;
    letters++;
    if (exp.has(scriptOf(ch))) hit++;
  }
  return { share: letters ? hit / letters : 0, letters };
}

const STOP: Record<string, string> = {
  en: 'the and of to is for that with by are this from which its have has been will their these such through during while also into',
  de: 'der die das und ist mit für von den des dem auf eine einer wird werden sich nach durch auch zur zum bei über sowie',
  fr: 'le les des et est pour par dans une sur qui aux avec sont cette ces leur plus ainsi entre être été du au',
  es: 'el los las del y que por para con una es se su sus al más como este esta entre sobre también han ha',
  pt: 'os do da dos das e em que para com um uma por no na nos nas ao mais como pelo pela são',
  tr: 've bir bu için ile olarak daha olan gibi çok veya kadar göre tarafından ise değil ayrıca üzerinde arasında sonra',
  it: 'il di che per con del della dei delle una sono nel nella alla gli anche come più questo questa',
  nl: 'het een van voor met zijn door aan als bij die wordt worden ook naar deze dat niet om',
};
const STOPSETS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(STOP).map(([k, v]) => [k, new Set(v.split(' '))]),
);

/** Stop-word language guess for Latin-script text (en/de/fr/es/pt/tr/it/nl). '' if undetermined. */
export function guessLatin(text: string, minTokens = 20): { lang: string; tokens: number; scores: Record<string, number> } {
  const toks = normalize(text).split(/[^\p{L}]+/u).filter(Boolean);
  const scores: Record<string, number> = {};
  let best = '';
  let bestScore = 0;
  for (const [lang, set] of Object.entries(STOPSETS)) {
    let n = 0;
    for (const t of toks) if (set.has(t)) n++;
    scores[lang] = n;
    if (n > bestScore) {
      bestScore = n;
      best = lang;
    }
  }
  const minHits = minTokens >= 20 ? 3 : 2;
  return { lang: toks.length >= minTokens && bestScore >= minHits ? best : '', tokens: toks.length, scores };
}
