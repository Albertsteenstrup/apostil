// The one way that HTML from GitHub (a description, a comment) goes into a page. GitHub's HTML is not trusted.
// The output is written anew: only the tags and attributes of the allow-list, every text escaped.
// A link becomes data-link, which VS Code opens in the browser; a picture stays only over https from GitHub's own hosts.

// Tags that stay, each with the attributes that it keeps.
const TAGS: Record<string, string[]> = {
  p: [], br: [], hr: [], div: [], span: [], h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
  strong: [], b: [], em: [], i: [], u: [], del: [], s: [], ins: [], mark: [], small: [], sup: [], sub: [], kbd: [], code: [], pre: [], tt: [],
  blockquote: [], ul: [], ol: ['start'], li: [], dl: [], dt: [], dd: [],
  table: [], thead: [], tbody: [], tfoot: [], tr: [], th: ['align', 'colspan', 'rowspan'], td: ['align', 'colspan', 'rowspan'],
  a: ['href', 'title'], img: ['src', 'alt', 'title', 'width', 'height'], details: ['open'], summary: [],
  input: ['type', 'checked'], // only the box of a task list, below
};
// A <pre lang="mermaid"> becomes <pre data-mermaid>: the page draws it with its own Mermaid, or shows the code when it does not parse.

// Tags whose whole content goes too, not only the tag.
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'textarea', 'select', 'title', 'head', 'svg', 'math', 'frameset', 'applet']);

// The hosts that a picture may load from.
const PICTURE_HOSTS = /^(github\.com|[a-z0-9-]+\.githubusercontent\.com|github\.githubassets\.com)$/;

/** Decodes the entities of an attribute value, so that "&#106;avascript:" is seen for what it is. */
function decode(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&(amp|lt|gt|quot|apos|colon|tab|newline);/gi, (_, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n' })[name.toLowerCase()] ?? '');
}

const escapeAttr = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Text between tags: entities stay, a stray "<" or ">" is escaped, a lone "&" too. */
const escapeText = (text: string): string => text.replace(/&(?!#?[a-z0-9]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** An https link, or undefined. Control characters and spaces are taken out first, as a browser does. */
function httpsLink(raw: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  const value = decode(raw).replace(/[\u0000- \u007f]/g, '');
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** The attributes of one tag as written, by lower-case name. */
function attributesOf(text: string): Map<string, string> {
  const found = new Map<string, string>();
  const pattern = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of text.matchAll(pattern)) found.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  return found;
}

/** One opening tag as it goes out, or '' when it goes. */
function openTag(name: string, attributeText: string): string {
  const kept = TAGS[name];
  const attributes = attributesOf(attributeText);
  const out: string[] = [];
  if (name === 'input') {
    if (attributes.get('type')?.toLowerCase() !== 'checkbox') return '';
    return `<input type="checkbox" disabled${attributes.has('checked') ? ' checked' : ''}>`;
  }
  if (name === 'img') {
    const src = httpsLink(attributes.get('src') ?? '');
    if (!src || !PICTURE_HOSTS.test(new URL(src).hostname)) return attributes.get('alt') ? escapeText(decode(attributes.get('alt')!)) : '';
    out.push(`src="${escapeAttr(src)}"`);
  }
  if (name === 'pre' && attributes.get('lang')?.toLowerCase() === 'mermaid') out.push('data-mermaid');
  // A note box of GitHub ("> [!NOTE]"): the kind stays as data-alert, so that the page can draw it as a box. No class name is kept.
  const kind = name === 'div' ? /(?:^|\s)markdown-alert-(note|tip|important|warning|caution)(?:\s|$)/.exec(attributes.get('class') ?? '')?.[1] : undefined;
  if (kind) out.push(`data-alert="${kind}"`);
  if (name === 'p' && /(^|\s)markdown-alert-title(\s|$)/.test(attributes.get('class') ?? '')) out.push('data-alert-title');
  if (name === 'a') {
    const link = httpsLink(attributes.get('href') ?? '');
    if (link) out.push(`data-link="${escapeAttr(link)}"`);
  }
  for (const attribute of kept) {
    if (attribute === 'src' || attribute === 'href' || !attributes.has(attribute)) continue;
    const value = decode(attributes.get(attribute)!);
    if (['width', 'height', 'colspan', 'rowspan', 'start'].includes(attribute) && !/^\d{1,5}$/.test(value)) continue;
    if (attribute === 'align' && !/^(left|right|center)$/i.test(value)) continue;
    out.push(attribute === 'open' ? 'open' : `${attribute}="${escapeAttr(value)}"`);
  }
  return `<${name}${out.length ? ` ${out.join(' ')}` : ''}>`;
}

const TAG = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/;

/** Cleans HTML from GitHub: what is not on the allow-list goes, and every text is escaped. */
export function cleanHtml(input: string): string {
  let out = '';
  let at = 0;
  while (at < input.length) {
    const next = input.indexOf('<', at);
    if (next < 0) { out += escapeText(input.slice(at)); break; }
    out += escapeText(input.slice(at, next));
    const rest = input.slice(next);
    if (rest.startsWith('<!--')) { // a comment goes
      const end = input.indexOf('-->', next + 4);
      at = end < 0 ? input.length : end + 3;
      continue;
    }
    const tag = TAG.exec(rest);
    if (!tag) { // not a tag: a "<" in text, or a broken tag, stays as text
      out += '&lt;';
      at = next + 1;
      continue;
    }
    const [whole, closing, rawName, attributeText] = tag;
    const name = rawName.toLowerCase();
    at = next + whole.length;
    // Text for screen readers only ("Loading", "Footnotes") goes with its tag: the page shows no stray word.
    const hidden = !closing && /(^|\s)sr-only(\s|$)/.test(attributesOf(attributeText).get('class') ?? '');
    if (DROP_WITH_CONTENT.has(name) || hidden) {
      if (closing) continue;
      const end = input.toLowerCase().indexOf(`</${name}`, at);
      at = end < 0 ? input.length : (input.indexOf('>', end) + 1 || input.length);
      continue;
    }
    if (!TAGS[name]) continue; // an unknown tag goes, its text stays
    if (closing) out += ['br', 'hr', 'img', 'input'].includes(name) ? '' : `</${name}>`;
    else out += openTag(name, attributeText);
  }
  return out;
}
