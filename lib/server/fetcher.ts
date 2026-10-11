// Server-only: used by the API routes (Node runtime on Vercel).

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 KingsResearchTranslationQA/2.0';

export function allowedHosts(): string[] {
  return (process.env.ALLOWED_HOSTS || 'www.kingsresearch.com,kingsresearch.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Only http(s) URLs on the allow-listed hosts may be fetched (prevents use as an open proxy). */
export function assertAllowed(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http(s) URLs are allowed');
  if (!allowedHosts().includes(u.hostname.toLowerCase())) throw new Error(`Host not allowed: ${u.hostname} (set ALLOWED_HOSTS)`);
  return u;
}

function requestHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'user-agent': process.env.FETCH_USER_AGENT || DEFAULT_UA,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': '*',
    'cache-control': 'no-cache',
  };
  if (process.env.FETCH_EXTRA_HEADERS) {
    try {
      Object.assign(h, JSON.parse(process.env.FETCH_EXTRA_HEADERS));
    } catch {
      /* ignore malformed JSON */
    }
  }
  return h;
}

export interface FetchResult {
  status: number | null;
  finalUrl: string;
  chain: { status: number; url: string }[];
  body: string;
  headers: Record<string, string>;
  error?: string;
  ms: number;
}

/** GET with manual redirect following so every hop (301/302/307/308) is recorded. */
export async function fetchWithChain(url: string, timeoutMs = 25000): Promise<FetchResult> {
  const t0 = Date.now();
  const chain: { status: number; url: string }[] = [];
  let current = url;
  try {
    for (let hop = 0; hop < 10; hop++) {
      assertAllowed(current);
      const res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: requestHeaders(),
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        chain.push({ status: res.status, url: current });
        current = new URL(location, current).toString();
        try {
          await res.arrayBuffer();
        } catch {
          /* ignore */
        }
        continue;
      }
      const body = await res.text();
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      return { status: res.status, finalUrl: current, chain, body, headers, ms: Date.now() - t0 };
    }
    return { status: null, finalUrl: current, chain, body: '', headers: {}, error: 'Too many redirects', ms: Date.now() - t0 };
  } catch (e: any) {
    return {
      status: null,
      finalUrl: current,
      chain,
      body: '',
      headers: {},
      error: `${(e && e.name) || 'Error'}: ${(e && e.message) || e}`,
      ms: Date.now() - t0,
    };
  }
}

/** One retry for network errors, 429 and 5xx. */
export async function fetchWithRetry(url: string, timeoutMs = 25000): Promise<FetchResult> {
  let r = await fetchWithChain(url, timeoutMs);
  if (r.status === null || r.status === 429 || (r.status >= 500 && r.status < 600)) {
    if (r.error && /Host not allowed|Only http|Invalid URL/.test(r.error)) return r;
    await new Promise((res) => setTimeout(res, 1500));
    r = await fetchWithChain(url, timeoutMs);
  }
  return r;
}
