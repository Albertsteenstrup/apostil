// The icons of files and folders as the Explorer of VS Code shows them, in the file icon theme that he uses (build 85): a theme is read from its JSON,
// a path is resolved as VS Code resolves it, and the page gets only the icons of the rows that it shows, as CSS. No `vscode` import: the tests read it.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** One icon of a theme: a picture (`iconPath`, SVG or PNG), or a character of a font of the theme. */
export interface IconDefinition { iconPath?: string; fontCharacter?: string; fontColor?: string; fontSize?: string; fontId?: string }

/** Which icon a file or a folder gets, by its name, its extension or its language; `file` and `folder` when nothing else fits. */
export interface IconAssociations {
  file?: string;
  folder?: string;
  fileNames?: Record<string, string>;
  fileExtensions?: Record<string, string>;
  languageIds?: Record<string, string>;
  folderNames?: Record<string, string>;
}

export interface IconFont { id: string; src: { path: string; format?: string }[]; weight?: string; style?: string; size?: string }

/** A file icon theme as its JSON has it, with `root`: the folder of that JSON, against which its paths are read. */
export interface IconTheme extends IconAssociations {
  iconDefinitions: Record<string, IconDefinition>;
  fonts?: IconFont[];
  light?: IconAssociations;
  highContrast?: IconAssociations;
  usesCurrentColor?: boolean;
  root: string;
}

/** The languages that VS Code gives files, from `contributes.languages` of all extensions: by whole name, and by extension (".ts", ".d.ts"). */
export interface Languages { names: Record<string, string>; extensions: Record<string, string> }

/** The kind of colour theme: the `light` part of an icon theme applies in a light theme, `highContrast` in a high contrast theme. */
export type ThemeKind = 'dark' | 'light' | 'contrast';

/** What a page gets: the CSS of the icons that its rows use, and the class of each path (a folder ends with "/"). */
export interface FileIcons { css: string; paths: Record<string, string> }

/** JSON with comments and trailing commas, as VS Code reads the files of a theme. */
export function parseJsonc(text: string): unknown {
  let out = '';
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === '"') { // a string, as it is
      const start = at;
      for (at++; at < text.length && text[at] !== '"'; at++) if (text[at] === '\\') at++;
      out += text.slice(start, at + 1);
    } else if (char === '/' && text[at + 1] === '/') { while (at < text.length && text[at] !== '\n') at++; out += '\n'; }
    else if (char === '/' && text[at + 1] === '*') { at = text.indexOf('*/', at + 2); if (at < 0) break; at++; }
    else out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** Reads a theme from its JSON file; undefined when it cannot be read. */
export function readIconTheme(file: string): IconTheme | undefined {
  try {
    const json = parseJsonc(readFileSync(file, 'utf8')) as Omit<IconTheme, 'root'>;
    return json && typeof json === 'object' && json.iconDefinitions ? { ...json, root: dirname(file) } : undefined;
  } catch {
    return undefined;
  }
}

/** The languages of the `contributes.languages` of these extensions (their package.json), as VS Code reads `filenames` and `extensions`. */
export function languagesOf(packages: unknown[]): Languages {
  const languages: Languages = { names: {}, extensions: {} };
  for (const json of packages) {
    const list = (json as { contributes?: { languages?: unknown } })?.contributes?.languages;
    for (const one of Array.isArray(list) ? list : []) {
      const { id, filenames, extensions } = one as { id?: unknown; filenames?: unknown; extensions?: unknown };
      if (typeof id !== 'string') continue;
      for (const name of Array.isArray(filenames) ? filenames : []) if (typeof name === 'string') languages.names[name.toLowerCase()] ??= id;
      for (const ext of Array.isArray(extensions) ? extensions : []) if (typeof ext === 'string') languages.extensions[ext.toLowerCase()] ??= id;
    }
  }
  return languages;
}

/** The language of a file name: by its whole name, then by its longest extension that a language claims. */
export function languageOf(name: string, languages: Languages): string | undefined {
  const lower = name.toLowerCase();
  if (languages.names[lower]) return languages.names[lower];
  for (let at = lower.indexOf('.'); at >= 0; at = lower.indexOf('.', at + 1)) {
    const id = languages.extensions[lower.slice(at)];
    if (id) return id;
  }
  return undefined;
}

/** VS Code reads the names and extensions of a theme in small letters; the language ids stay as they are. */
const lowerKeys = (record?: Record<string, string>): Record<string, string> | undefined => record && Object.fromEntries(Object.entries(record).map(([key, id]) => [key.toLowerCase(), id]));
const loweredParts = new WeakMap<IconAssociations, IconAssociations>();
function lowered(part: IconAssociations): IconAssociations {
  let one = loweredParts.get(part);
  if (!one) loweredParts.set(part, one = { ...part, fileNames: lowerKeys(part.fileNames), fileExtensions: lowerKeys(part.fileExtensions), folderNames: lowerKeys(part.folderNames) });
  return one;
}

/**
 * The id of the icon of a path, as VS Code resolves it (a folder ends with "/"). A file: `fileNames` by its name, then `fileExtensions` from the longest
 * compound extension ("d.ts" before "ts"), then `languageIds` by its language, then `file`. A folder: `folderNames`, then `folder`. In a light theme
 * the `light` part wins where it names the same, in a high contrast theme the `highContrast` part.
 */
export function iconOf(theme: IconTheme, path: string, kind: ThemeKind, languages: Languages): string | undefined {
  const parts = [kind === 'light' ? theme.light : kind === 'contrast' ? theme.highContrast : undefined, theme].filter((one): one is IconAssociations => !!one).map(lowered);
  const pick = (get: (one: IconAssociations) => string | undefined): string | undefined => {
    for (const one of parts) { const id = get(one); if (id && theme.iconDefinitions[id]) return id; }
    return undefined;
  };
  const folder = path.endsWith('/');
  const name = (folder ? path.slice(0, -1) : path).split('/').pop()!.toLowerCase();
  if (folder) return pick((one) => one.folderNames?.[name]) ?? pick((one) => one.folder);
  const byName = pick((one) => one.fileNames?.[name]);
  if (byName) return byName;
  for (let at = name.indexOf('.'); at >= 0; at = name.indexOf('.', at + 1)) {
    const id = pick((one) => one.fileExtensions?.[name.slice(at + 1)]);
    if (id) return id;
  }
  const language = languageOf(name, languages);
  // VS Code takes the icon of "json" for "jsonc" when a theme has none of its own.
  const byLanguage = language && (pick((one) => one.languageIds?.[language]) ?? (language === 'jsonc' ? pick((one) => one.languageIds?.json) : undefined));
  return byLanguage || pick((one) => one.file);
}

// What may go into the CSS from a theme: nothing else of its JSON reaches the page.
const COLOR = /^#[0-9a-f]{3,8}$/i;
const SIZE = /^\d+(\.\d+)?(px|em|rem|%)$/;
const FONT_ID = /^[\w-]+$/;
const CHARACTER = /^\\[0-9a-f]{1,6}$/i;

/** A font character of a theme ("\E099", or one letter) as the content of CSS. */
function contentOf(character: string): string | undefined {
  if (CHARACTER.test(character)) return `"${character}"`;
  return [...character].length === 1 ? `"\\${character.codePointAt(0)!.toString(16)}"` : undefined;
}

/**
 * The icons of these paths in a theme, for a page: one class for each icon that a row uses ("fi1", "fi2", …) and its CSS, with the fonts that those
 * icons take. `address` gives the address of a file of the theme in the page (asWebviewUri). A path with no icon is left out; with no icon at all,
 * undefined. Only what the rows use is sent, never the whole theme.
 */
export function iconsFor(theme: IconTheme, paths: string[], kind: ThemeKind, languages: Languages, address: (file: string) => string): FileIcons | undefined {
  const classes = new Map<string, string>();
  const out: FileIcons = { css: '', paths: {} };
  const rules: string[] = [];
  const fonts = new Set<string>();
  const firstFont = theme.fonts?.[0];
  const url = (file: string): string => `url("${address(join(theme.root, file)).replace(/["\\\n]/g, encodeURIComponent)}")`;
  for (const path of [...new Set(paths)]) {
    const id = iconOf(theme, path, kind, languages);
    const icon = id ? theme.iconDefinitions[id] : undefined;
    if (!id || !icon) continue;
    if (!classes.has(id)) {
      const cls = `fi${classes.size + 1}`;
      let rule = '';
      if (icon.iconPath) {
        // A theme that draws its icons in the colour of the words takes them as a mask, as VS Code does.
        rule = theme.usesCurrentColor ? `.fi.${cls}{background:currentColor;-webkit-mask:${url(icon.iconPath)} center/contain no-repeat;mask:${url(icon.iconPath)} center/contain no-repeat}`
          : `.fi.${cls}{background:${url(icon.iconPath)} center/contain no-repeat}`;
      } else if (icon.fontCharacter && contentOf(icon.fontCharacter)) {
        const font = theme.fonts?.find((one) => one.id === icon.fontId) ?? firstFont;
        if (font && FONT_ID.test(font.id)) {
          fonts.add(font.id);
          const size = [icon.fontSize, font.size, firstFont?.size, '150%'].find((one) => one && SIZE.test(one));
          rule = `.fi.${cls}::before{content:${contentOf(icon.fontCharacter)};font-family:"fi-${font.id}";font-size:${size}${icon.fontColor && COLOR.test(icon.fontColor) ? `;color:${icon.fontColor}` : ''}}`;
        }
      }
      if (!rule) continue;
      classes.set(id, cls);
      rules.push(rule);
    }
    out.paths[path] = classes.get(id)!;
  }
  if (!rules.length) return undefined;
  const faces = (theme.fonts ?? []).filter((font) => fonts.has(font.id)).map((font) => {
    const src = font.src.map((one) => `${url(one.path)}${one.format && FONT_ID.test(one.format) ? ` format("${one.format}")` : ''}`).join(',');
    const weight = /^(normal|bold|\d{3})$/.test(font.weight ?? '') ? font.weight : 'normal';
    const style = /^(normal|italic|oblique)$/.test(font.style ?? '') ? font.style : 'normal';
    return `@font-face{font-family:"fi-${font.id}";src:${src};font-weight:${weight};font-style:${style};font-display:block}`;
  });
  out.css = [...faces, ...rules].join('\n');
  return out;
}

/** The paths of the rows of the page of a change: its changed files, the files of its parts, and the files in no part. */
export function changePaths(page: { files: { path: string }[]; parts?: { files: string[] }[]; checks?: { filesInNoPart?: string[] } }): string[] {
  return [...new Set([...page.files.map((file) => file.path), ...(page.parts ?? []).flatMap((part) => part.files), ...(page.checks?.filesInNoPart ?? [])])];
}

/** The paths of the rows of Home: the folders and files of each node of each diagram of the map. */
export function homePaths(map: { diagrams: { nodes: Record<string, { paths: { path: string }[] }> }[] } | undefined): string[] {
  return [...new Set((map?.diagrams ?? []).flatMap((diagram) => Object.values(diagram.nodes ?? {}).flatMap((node) => node.paths.map((one) => one.path))))];
}
