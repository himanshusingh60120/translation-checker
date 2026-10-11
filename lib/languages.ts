const NAME_TO_CODE: Record<string, string> = {
  chinese: 'zh',
  'simplified chinese': 'zh',
  'chinese simplified': 'zh',
  mandarin: 'zh',
  french: 'fr',
  german: 'de',
  spanish: 'es',
  korean: 'ko',
  portuguese: 'pt',
  'brazilian portuguese': 'pt',
  russian: 'ru',
  turkish: 'tr',
  japanese: 'ja',
  italian: 'it',
  arabic: 'ar',
  dutch: 'nl',
  polish: 'pl',
  vietnamese: 'vi',
  thai: 'th',
  indonesian: 'id',
  english: 'en',
  deutsch: 'de',
  français: 'fr',
  francais: 'fr',
  español: 'es',
  espanol: 'es',
  português: 'pt',
  portugues: 'pt',
  türkçe: 'tr',
  turkce: 'tr',
  '中文': 'zh',
  '日本語': 'ja',
  '한국어': 'ko',
  'русский': 'ru',
};

export const CODE_TO_NAME: Record<string, string> = {
  zh: 'Chinese',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  ko: 'Korean',
  pt: 'Portuguese',
  ru: 'Russian',
  tr: 'Turkish',
  ja: 'Japanese',
  it: 'Italian',
  ar: 'Arabic',
  nl: 'Dutch',
  pl: 'Polish',
  vi: 'Vietnamese',
  th: 'Thai',
  id: 'Indonesian',
  en: 'English',
};

/** Order used on kingsresearch.com sitemaps */
export const SITE_LANG_ORDER = ['en', 'fr', 'de', 'es', 'zh', 'ko', 'pt', 'ru', 'tr', 'ja'];
export const KNOWN_SITE_LANGS = ['fr', 'de', 'es', 'zh', 'ko', 'pt', 'ru', 'tr', 'ja'];

/** "German" / "de" / "de-DE" / "Chinese" -> "de" / "zh". Returns '' when unknown. */
export function langFromName(input: string): string {
  const k = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ');
  if (!k) return '';
  if (NAME_TO_CODE[k]) return NAME_TO_CODE[k];
  const m = k.match(/^([a-z]{2})(?:[- ][a-z]{2,4})?$/);
  if (m && CODE_TO_NAME[m[1]]) return m[1];
  return '';
}

export function langName(code: string): string {
  return CODE_TO_NAME[code] || (code ? code.toUpperCase() : '?');
}

export function sortLangs(langs: string[]): string[] {
  return [...langs].sort((a, b) => {
    const ia = SITE_LANG_ORDER.indexOf(a);
    const ib = SITE_LANG_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
}
