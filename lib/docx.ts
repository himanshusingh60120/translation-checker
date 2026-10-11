import JSZip from 'jszip';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function closestPara(n: Element): Element | null {
  let cur = n.parentElement;
  while (cur) {
    if (cur.namespaceURI === W && cur.localName === 'p') return cur;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Plain-text paragraphs of a .docx in document order (runs the browser; uses DOMParser).
 * Table cells come out as their own paragraphs, line breaks split paragraphs.
 */
export async function docxParagraphs(data: ArrayBuffer | Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(data);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('Not a Word document (word/document.xml missing)');
  const xml = await file.async('string');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('document.xml could not be parsed');

  const paras = doc.getElementsByTagNameNS(W, 'p');
  const out: string[] = [];
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    let text = '';
    const nodes = p.getElementsByTagNameNS(W, '*');
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k];
      if (closestPara(n) !== p) continue; // belongs to a nested paragraph (text box)
      const parent = n.parentElement ? n.parentElement.localName : '';
      switch (n.localName) {
        case 't':
          text += n.textContent || '';
          break;
        case 'tab':
          if (parent !== 'tabs') text += '\t';
          break;
        case 'br':
        case 'cr':
          text += '\n';
          break;
        case 'noBreakHyphen':
          text += '-';
          break;
        default:
          break;
      }
    }
    for (const line of text.split('\n')) out.push(line);
  }
  return out;
}
