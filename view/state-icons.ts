// The icons of the states of a pull request, as CSS. The files in view/media/icons stay as they are; each becomes a data address
// for the mask of ".pri", so the icon takes the colour of its state through currentColor. A mask from a file address would need CORS.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One CSS rule for each icon file (.pri is the state icon, .ico every other): `:is(.pri,.ico).<name>{--icon:url("data:...")}`. */
export function iconCss(media: string): string {
  const folder = join(media, 'icons');
  return readdirSync(folder).filter((file) => file.endsWith('.svg')).sort().map((file) => {
    const svg = readFileSync(join(folder, file), 'utf8').trim();
    return `:is(.pri,.ico).${file.slice(0, -4)}{--icon:url("data:image/svg+xml,${encodeURIComponent(svg)}")}`;
  }).join('\n');
}

/** A line of JavaScript that adds the icon rules to a page that opens as a file in a browser. */
export const iconScript = (media: string): string =>
  `document.head.insertAdjacentHTML('beforeend', ${JSON.stringify(`<style>${iconCss(media)}</style>`)});\n`;
