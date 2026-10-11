import type { ImageItem, LinkItem } from './types';
import { cleanWs } from './text';

export const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'button', 'caption', 'dd', 'details', 'dialog', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'label',
  'legend', 'li', 'main', 'nav', 'ol', 'option', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'ul',
]);
export const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'head', 'object', 'canvas', 'select']);

/** Visible text split into blocks (paragraphs, list items, headings, cells). Browser DOM version. */
export function domBlocks(root: Node): string[] {
  const blocks: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    const t = cleanWs(buf.join(''));
    buf = [];
    if (t) blocks.push(t);
  };
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        buf.push(child.nodeValue || '');
        return;
      }
      if (child.nodeType !== 1) return;
      const name = (child as Element).tagName.toLowerCase();
      if (SKIP_TAGS.has(name)) return;
      if (name === 'br') {
        flush();
        return;
      }
      if (BLOCK_TAGS.has(name)) {
        flush();
        walk(child);
        flush();
      } else walk(child);
    });
  };
  walk(root);
  flush();
  return blocks;
}

/** Parse a description body (HTML fragment or full document) from the translation files. */
export function parseBodyHtml(html: string): { blocks: string[]; headings: string[]; links: LinkItem[]; images: ImageItem[] } {
  const isDoc = /<body[\s>]/i.test(html);
  const doc = new DOMParser().parseFromString(isDoc ? html : `<!doctype html><html><body>${html}</body></html>`, 'text/html');
  const body = doc.body;
  const headings = Array.from(body.querySelectorAll('h2, h3'))
    .map((h) => cleanWs(h.textContent || ''))
    .filter(Boolean);
  const links = Array.from(body.querySelectorAll('a[href]'))
    .map((a) => ({ anchor: cleanWs(a.textContent || ''), href: (a.getAttribute('href') || '').trim() }))
    .filter((l) => l.href && !l.href.startsWith('#'));
  const images = Array.from(body.querySelectorAll('img'))
    .map((img) => ({ src: (img.getAttribute('src') || '').trim(), alt: cleanWs(img.getAttribute('alt') || '') }))
    .filter((i) => i.src && !i.src.startsWith('data:'));
  return { blocks: domBlocks(body), headings, links, images };
}
