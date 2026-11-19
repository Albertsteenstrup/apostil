// What the eye sees of a page in a theme of VS Code, for the browser check and the check in a real VS Code window.
// A browser page has no variables of VS Code. theme-colors.json holds those of the default themes, read once from a real VS Code (read-theme-colors.mjs);
// a page wears them with the class and the theme attributes that VS Code puts on the body.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const THEMES = JSON.parse(readFileSync(fileURLToPath(new URL('./theme-colors.json', import.meta.url)), 'utf8'));
/** Runs in a page, before its scripts or later: puts on the colours, the class and the attributes of a theme as VS Code does, in place of those it had. */
export function wearTheme(theme) {
  const put = () => {
    for (const name of [...document.documentElement.style].filter((one) => one.startsWith('--vscode-'))) document.documentElement.style.removeProperty(name);
    for (const [name, value] of Object.entries(theme.vars)) document.documentElement.style.setProperty(name, value);
    document.body.classList.remove(...[...document.body.classList].filter((one) => one.startsWith('vscode-')));
    document.body.classList.add(...theme.bodyClass.split(' '));
    Object.assign(document.body.dataset, theme.bodyData);
  };
  if (document.body) put();
  else new MutationObserver((_, watch) => { if (document.body) { watch.disconnect(); put(); } }).observe(document, { childList: true, subtree: true });
}
/**
 * Runs in a page: what the eye sees in a theme. `bright`: boxes and shapes much lighter than the page in a dark theme (a button aside); `boxed`: a text
 * on an arrow that stands in a box of its own, with a background other than the page or a border; `dim`: a removed thing whose dashed line does not show;
 * `normal` and `quiet`: the lowest contrast of a text against what stands behind it, and the texts under 4.5 to 1 (normal) or 3 to 1 (quiet and large).
 */
export function lookOfPage(dark) {
  const paint = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const color = (css) => { // [r, g, b, a] of any colour of CSS
    if (!css || css === 'none') return [0, 0, 0, 0];
    const mixed = /^color\(srgb ([^)]+)\)$/.exec(css);
    if (mixed) { const parts = mixed[1].split(/[ /]+/).filter(Boolean).map(Number); return [parts[0] * 255, parts[1] * 255, parts[2] * 255, parts[3] ?? 1]; }
    const plain = /^rgba?\(([^)]+)\)$/.exec(css);
    if (plain) { const parts = plain[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [parts[0], parts[1], parts[2], parts[3] ?? 1]; }
    paint.clearRect(0, 0, 1, 1); paint.fillStyle = css; paint.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = paint.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const over = ([r, g, b, a], [R, G, B]) => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)];
  const lum = ([r, g, b]) => { const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (x, y) => { const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); };
  const page = color(getComputedStyle(document.body).backgroundColor).slice(0, 3);
  const shows = (el) => { const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth && getComputedStyle(el).visibility !== 'hidden'; };
  const nameOf = (el) => `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(' ')[0]}`;
  // The colour behind an element: the backgrounds under it laid one over the other, down to the first that is solid; in a drawing, the fill of a shape.
  const behind = (el) => {
    const layers = [];
    for (let at = el; at; at = at.parentElement) {
      const shape = at instanceof SVGElement && at.matches('g.node, g.cluster, g:has(> rect.actor)') ? at.querySelector(':scope > :is(rect,polygon,path,circle)') : null;
      const layer = at instanceof SVGElement ? (shape ? color(getComputedStyle(shape).fill) : [0, 0, 0, 0]) : color(getComputedStyle(at).backgroundColor);
      if (layer[3] > 0) layers.push(layer);
      if (layer[3] >= 0.999) break;
    }
    let base = layers.length && layers.at(-1)[3] >= 0.999 ? layers.pop().slice(0, 3) : page;
    for (const layer of layers.reverse()) base = over(layer, base);
    return base;
  };
  const faded = (el) => { let value = 1; for (let at = el; at; at = at.parentElement) value *= Number(getComputedStyle(at).opacity); return value; };
  const quietColors = ['--muted', '--faint', '--d-dashed'].map((name) => { const probe = document.body.appendChild(document.createElement('i')); probe.style.color = `var(${name})`; const value = getComputedStyle(probe).color; probe.remove(); return value; });
  const bright = [];
  if (dark) {
    for (const el of document.querySelectorAll('body *')) {
      // A button, an icon, the dot where states start, and the chip of a mark, which is light in every theme so that a coloured icon reads;
      // the bar of a block "bars" and the dot of a block "state", which are data in the accent colour, not boxes.
      if (el.closest('marker, .tip, button, .ghs, .newest, .ico, .pri, .dot, img, .state-start, .mk-chip, .mk-more, .bk-bar, .bk-dot') || !shows(el)) continue;
      const box = el.getBoundingClientRect();
      if (box.width < 8 || box.height < 8) continue;
      const svg = el instanceof SVGElement;
      if (svg && !el.matches('rect, polygon, path, circle, ellipse')) continue;
      const fill = color(svg ? getComputedStyle(el).fill : getComputedStyle(el).backgroundColor);
      fill[3] *= faded(el); // a box with an opacity shows as strong as its colour times its opacity
      if (fill[3] < 0.5) continue;
      const seen = over(fill, page);
      if (lum(seen) > 0.06 && ratio(seen, page) > 1.8) bright.push(`${nameOf(el)} ${ratio(seen, page).toFixed(2)}`);
    }
  }
  const boxed = [...document.querySelectorAll('.stage span.edgeLabel, .stage .labelBkg')].filter(shows).filter((el) => {
    const style = getComputedStyle(el);
    const back = color(style.backgroundColor);
    return (back[3] > 0.05 && ratio(over(back, page), behind(el.closest('.stage'))) > 1.1) || parseFloat(style.borderTopWidth) > 0 || style.boxShadow !== 'none' || style.outlineStyle !== 'none';
  }).map((el) => `${nameOf(el)} "${el.textContent.trim()}"`);
  const dim = [...document.querySelectorAll('.stage g.node.d-removed > :is(rect,polygon,path,circle), .stage :is(path,line).d-removed:not(.hit)')].filter(shows)
    .filter((el) => { const style = getComputedStyle(el); return !/[1-9]/.test(style.strokeDasharray) || ratio(over(color(style.stroke), page), page) < 2; }).map(nameOf);
  const kinds = { normal: { lowest: 99, low: [] }, quiet: { lowest: 99, low: [] } };
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('script, style, .tip, [hidden], .rest, .d-removed, .ghost') || ![...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim()) || !shows(el) || el.getAnimations().length) continue; // a pulsing thing is read when it is whole
    const style = getComputedStyle(el);
    const opacity = faded(el);
    if (opacity < 0.3) continue;
    const back = behind(el);
    const [r, g, b, a] = color(el instanceof SVGElement ? style.fill : style.color);
    const value = ratio(over([r, g, b, a * opacity], back), back);
    const size = parseFloat(style.fontSize);
    // quiet: the quiet colours, a faded thing, large text, and the sign of a diff row, which says again what the colour of its row says
    const quiet = size >= 24 || (size >= 18.6 && Number(style.fontWeight) >= 600) || quietColors.includes(style.color) || opacity < 1 || el.matches('.g');
    const kind = quiet ? kinds.quiet : kinds.normal;
    kind.lowest = Math.min(kind.lowest, Math.round(value * 100) / 100);
    if (value < (quiet ? 3 : 4.5) && kind.low.length < 6) kind.low.push(`${nameOf(el)} "${el.textContent.trim().slice(0, 20)}" ${value.toFixed(2)}`);
  }
  return { bright: bright.slice(0, 6), boxed: boxed.slice(0, 6), dim, ...kinds };
}
