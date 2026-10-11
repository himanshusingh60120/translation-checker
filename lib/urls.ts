export function safeUrl(u: string): URL | null {
  try {
    return new URL((u || '').trim());
  } catch {
    return null;
  }
}

function decodedPath(x: URL): string {
  let p = x.pathname || '/';
  try {
    p = decodeURI(p);
  } catch {
    /* keep encoded */
  }
  return p;
}

/** Strict comparison form: scheme + host + decoded path + query (no fragment). */
export function normUrl(u: string, keepSlash = true): string {
  const x = safeUrl(u);
  if (!x) return (u || '').trim();
  let path = decodedPath(x);
  if (!keepSlash && path.length > 1) path = path.replace(/\/+$/, '') || '/';
  return `${x.protocol.toLowerCase()}//${x.host.toLowerCase()}${path}${x.search}`;
}

export function urlsEqual(a: string, b: string): boolean {
  return !!a && !!b && normUrl(a) === normUrl(b);
}

/** Equal ignoring scheme, "www.", trailing slash and path letter case. */
export function urlsLoose(a: string, b: string): boolean {
  const f = (u: string) => {
    const x = safeUrl(u);
    if (!x) return (u || '').trim().toLowerCase();
    return x.host.toLowerCase().replace(/^www\./, '') + (decodedPath(x).toLowerCase().replace(/\/+$/, '') || '/') + x.search;
  };
  return !!a && !!b && f(a) === f(b);
}

export function pathSegs(u: string): string[] {
  const x = safeUrl(u);
  return (x ? x.pathname : '').split('/').filter(Boolean);
}

/** Report ID = trailing "-<digits>" of the last path segment. */
export function idOf(u: string): string {
  const x = safeUrl(u);
  const p = (x ? x.pathname : u || '').replace(/\/+$/, '');
  const m = p.match(/-(\d+)$/);
  return m ? m[1] : '';
}

/** Slug = last path segment without the "-<id>" suffix. */
export function slugOf(u: string): string {
  const segs = pathSegs(u);
  return (segs[segs.length - 1] || '').replace(/-\d+$/, '');
}

/** Language prefix of a URL ("/de/report/..." -> "de"), '' for English. */
export function langOfUrl(u: string, langs: Set<string>): string {
  const s = (pathSegs(u)[0] || '').toLowerCase();
  if (!s) return '';
  if (langs.has(s)) return s;
  return /^[a-z]{2}(-[a-z]{2,4})?$/.test(s) ? s : '';
}

/** Path without the language prefix. */
export function stripLang(u: string, langs: Set<string>): string {
  const segs = pathSegs(u);
  if (segs.length && langOfUrl(u, langs)) segs.shift();
  return '/' + segs.join('/');
}

export function originOf(u: string): string {
  const x = safeUrl(u);
  return x ? x.origin : '';
}

/** https://host/report/x-1 + "de" -> https://host/de/report/x-1 */
export function withLang(u: string, lang: string): string {
  const x = safeUrl(u);
  if (!x) return u;
  return `${x.origin}/${lang}${x.pathname === '/' ? '' : x.pathname}${x.search}`;
}

export function hostOf(u: string): string {
  const x = safeUrl(u);
  return x ? x.host.toLowerCase().replace(/^www\./, '') : '';
}
