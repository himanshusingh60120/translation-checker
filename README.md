# Kings Research – Multilingual Translation & Live URL Verification (Vercel)

A Next.js app that checks every translated report page on kingsresearch.com against the
translation "PASTE" documents. The translation file is the **source of truth**; the live HTML is the
implementation being verified. A row is **Fully Verified** only when

`Translation file → sitemap → expected URL → live URL → HTML/SEO metadata → translated content`

all align. HTTP 200 alone never passes a row.

## 1. Deploy to Vercel

**Option A – GitHub (recommended)**
1. Unzip this folder, push it to a new GitHub repository.
2. vercel.com → *Add New… → Project* → import the repo. Framework is detected as **Next.js**; keep the defaults.
3. Click **Deploy**.

**Option B – Vercel CLI**
```bash
cd kings-translation-verifier-vercel
npx vercel          # first time: links/creates the project
npx vercel --prod
```

**Environment variables** (optional, Project → Settings → Environment Variables):

| Variable | Purpose |
|---|---|
| `BASIC_AUTH_USER`, `BASIC_AUTH_PASS` | Password-protect the app (recommended – it is an internal tool) |
| `ALLOWED_HOSTS` | Hosts the server may fetch. Default `www.kingsresearch.com,kingsresearch.com` |
| `FETCH_USER_AGENT` | User agent for page/sitemap requests |
| `FETCH_EXTRA_HEADERS` | JSON of extra headers, e.g. a secret header your Cloudflare/WAF rule allows |

Local run: `npm install && npm run dev` → http://localhost:3000. Type check: `npm run typecheck`
(the Vercel build is configured not to fail on type errors).

## 2. Use

1. In Google Drive, download the translations folder as ZIP (right-click → Download). Several ZIPs are fine.
   Expected structure (exactly what the Drive folders contain):
   ```
   <Report Name> <ID> Translations/
       Chinese/PASTE-Chinese.docx
       German/PASTE-German.docx
       German/BODY-German.html          (optional – used when the PASTE doc says "Open BODY-German.html")
       ...
   ```
2. Open the app → **Choose ZIP file(s)**. The files are parsed **in the browser** (nothing is uploaded).
   The preview shows every report × language found and any problems in the files themselves.
3. **Run verification**. The app reads the sitemaps, then fetches each page through `/api/inspect`.
4. Review the report-wise matrix and row-level audit. Click any row for
   `Source File Value | Live HTML Value | Match/Mismatch`. Download the Excel report.

## 3. How "the numbers" are checked (sitemaps)

The sitemap index (`/sitemap.xml`) lists `sitemap-reports.xml` for English and for every language
(`/fr/`, `/de/`, `/es/`, `/zh/`, `/ko/`, `/pt/`, `/ru/`, `/tr/`, `/ja/`). For every report ID in the ZIP the tool
looks the ID up in the English and in the language sitemap and checks:

* the ID is listed in the English sitemap and in that language's sitemap (and only once),
* the slug in the sitemap URL equals the slug in the PASTE doc ("Slug URL field reads …") and the English slug,
* the language prefix and the path mirror the English URL (old reports use `/de/<slug>-<id>`, newer ones `/de/report/<slug>-<id>`),
* `lastmod` is not older than the translation file (otherwise the page may not have been republished yet).

The URL found in the language sitemap is the **expected URL**. If the report is missing from the language
sitemap, the URL is derived from the English sitemap URL (and flagged).

## 4. What is compared (PASTE doc → live page)

| PASTE doc field | Live HTML | Check |
|---|---|---|
| Meta Title | `<title>` | Meta Title |
| Meta Description | `<meta name="description">` | Meta Description |
| Report Subtitle | `<h1>` | H1 |
| Report Title | H2 under the H1 (CMS appends ", 2025-2032") | Report Title (H2) |
| Description (HTML or BODY file) | page body, block by block (paragraphs, list items, table cells, headings, images) | Content |
| FAQ rows (Question / Answer, "Currently reads") | FAQ section, FAQ JSON-LD, Next.js page data | FAQ – flags rows where the **old** question is still live |
| Links table (anchor → URL) | `<a href>` in the page | Links |
| Report ID, slug, language | final URL, canonical, og:url, buy / snapshot / TOC links | Report ID, URL Check |
| — | `<link rel=canonical>` = expected URL | Canonical |
| — | `hreflang` set = all language URLs from the sitemaps + `en` + `x-default` | Hreflang |
| — | `<html lang>`, og:locale, script/language of the text, % English paragraphs, similarity to English page, cross-language match | Language |
| Meta Title / Description | og:title, og:description, twitter:*, og:url, robots/noindex | Other Meta |
| — | internal body links point to the same language (`/de/…`) | Link Language (advisory) |

Text is compared after normalising HTML entities, markup, Unicode compatibility forms (full-width
punctuation), curly quotes, dashes, non-breaking spaces and whitespace (all whitespace is ignored for Chinese/Japanese).
Numbers are compared locale-independently (`1,450.0` = `1.450,0`). Fields marked "Leave as is" are N/A.

## 5. Statuses

* **PASS** – identical after normalisation
* **WARNING** – only case/punctuation/spacing differs, minor wording in a body block, a redirect that ends on the right page,
  missing non-self hreflang alternate, image URL changed, etc.
* **FAIL** – real mismatch (wording, numbers, wrong URL/report/language, old FAQ text still live, canonical to English, noindex, 5xx…)
* **NOT FOUND** – 404/410, element missing in the live HTML, or field missing in the translation file
* **N/A** – nothing to compare ("Leave as is", no FAQ rows…)

Overall = FAIL if any check is FAIL/NOT FOUND, WARNING if any WARNING, else PASS (= Fully Verified).
"Link Language" is advisory by default (toggle in Settings).

## 6. Outputs

Excel workbook: **Dashboard**, **Report Summary** (each report × all languages + which fields differ),
**Audit** (`ReportID | Language | URL | HTTP | Meta Title | Meta Description | H1 | Canonical | Hreflang | Content | Overall` + supporting checks),
**Field Comparison**, **Differences Only**, **Sitemap Check**, **Source Validation**, **Expected Data**, **Fetch Log**.
Also CSV (audit, field comparison) and JSON.

## 7. Notes & troubleshooting

* **HTTP 403 / 429 on every page** – the site's bot protection is blocking Vercel. Allow-list the Vercel egress or add a
  secret header via `FETCH_EXTRA_HEADERS` and a matching WAF rule.
* **FAQ answers "verify manually"** – if the site loads FAQ answers only on click, they are not in the HTML;
  the questions are still verified.
* Each page is fetched by its own short serverless call (`maxDuration` 60 s), so large batches don't hit function time limits.
  Lower "Parallel requests" if the site rate-limits.
* Debug a single page: `/api/inspect?url=https://www.kingsresearch.com/de/report/…` ; sitemaps: `/api/sitemap?ids=3042,3015`.
