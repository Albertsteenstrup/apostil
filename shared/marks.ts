// Marks: icons that stand at lines of code. A writer saves each mark once, at a line (`apostil add-marks`), and Apostil rolls it up to the notes,
// the steps and the nodes that hold that line (view/media/marks.js draws them). A mark set is one kind of mark: the built-in set "services" holds
// the services that the code reaches; a look (shared/look.ts) can add sets of its own.

import { ID } from './change-file';
import { fileText, repoFiles } from './git';
import { areaOf, areaOrder, areasWaitingForNotes, codeFiles, fingerprint, largestFirst, noteGroups, slug } from './note-groups';
import { findBlock } from './notes-beside-code';
import type { RepoMap } from './repo-map';
import type { StoredMap } from './store';

export type Corner = 'upper-left' | 'upper-right' | 'lower-left' | 'lower-right';
export const CORNERS: Corner[] = ['upper-left', 'upper-right', 'lower-left', 'lower-right'];

/** What the code does with a service. */
export const RELATIONS = ['calls', 'stores', 'sends', 'runs on'] as const;
export type Relation = typeof RELATIONS[number];

/** One value of a mark set: a service, or a value of a set of a look. `icon` is the ending of its kept icon file ("png"), when it has one. */
export interface MarkValue {
  id: string;
  name: string;
  site?: string; // a service: its web address, without "https://"
  icon?: string;
}

/** A kind of mark: its values, the rule that tells its writers what to mark, and the corner where it stands on a node and on a note. */
export interface MarkSet {
  id: string;
  name: string;
  rule: string;
  values?: MarkValue[];
  corner: { node: Corner; note: Corner };
}

/** A thing inside a service that the code names with fixed text: a table, a model, an endpoint. */
export interface NamedThing {
  kind: string; // one word
  name: string;
}

/** One mark at a line of code. `code` is the text of that line at the save: a mark whose line changed is hidden until the next run, as a note is. */
export interface Mark {
  set: string;
  value: string;
  file: string;
  line: number;
  name: string; // a word that stands on the line
  relation?: Relation; // a service only
  thing?: NamedThing;
  group: string; // the group of the writer that saved it
  code: string;
}

/** A value whose own website refused the writer its icon: the main agent asks the owner before it takes the icon from another site. */
export interface IconRefused {
  set: string;
  value: string;
  tried: string;
}

/** The built-in set: the services that the code reaches. Its values are kept for every repo, so another repo needs no new icon. */
export const SERVICES: MarkSet = {
  id: 'services', name: 'Services', corner: { node: 'upper-right', note: 'upper-right' },
  rule: 'Mark each line where the code reaches a service outside the repo: a hosted API, a cloud product, a database, a tool for traces or events, or a platform that runs the code.',
};

// ----- the files that a writer gives: icons, pictures and films -----

const KB = 1024;
const ICON_MOST = 100 * KB;

/** The endings of each kind of file, and how to know such a file by its first bytes. */
const KINDS: Record<string, { name: string; test: (bytes: Buffer) => boolean }> = {
  png: { name: 'PNG', test: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  jpg: { name: 'JPEG', test: (b) => b[0] === 0xff && b[1] === 0xd8 },
  jpeg: { name: 'JPEG', test: (b) => b[0] === 0xff && b[1] === 0xd8 },
  gif: { name: 'GIF', test: (b) => b.subarray(0, 3).toString('latin1') === 'GIF' },
  webp: { name: 'WebP', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  ico: { name: 'ICO', test: (b) => b.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])) },
  svg: { name: 'SVG', test: (b) => /<svg[\s>]/i.test(b.subarray(0, 4096).toString('utf8')) },
  mp4: { name: 'MP4', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
};

/** The kinds of files that each use takes, and the most bytes. */
export const FILE_USES = {
  icon: { endings: ['png', 'svg', 'ico', 'webp'], most: ICON_MOST, words: 'an icon' },
  picture: { endings: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'], most: 2 * KB * KB, words: 'a picture' },
  film: { endings: ['mp4'], most: 20 * KB * KB, words: 'a film' }, // only MP4 with H.264 video: a real VS Code window played that and did not open a WebM file
} as const;
export type FileUse = keyof typeof FILE_USES;

/** The ending of an icon from its first bytes (png, svg, ico or webp), or undefined when it is none of them. */
export const iconEndingOf = (bytes: Buffer): string | undefined => FILE_USES.icon.endings.find((ending) => KINDS[ending].test(bytes));

export const endingOf = (path: string): string => (/\.([a-z0-9]+)$/i.exec(path)?.[1] ?? '').toLowerCase();

/** The names of H.264 video inside an MP4 file. */
const H264 = ['avc1', 'avc3'];

/** An SVG may hold no script, no event attribute (onclick=…) and no outside address: the page shows it as it is. */
const unsafeSvg = (text: string): boolean => /<script|\son[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|javascript:)|url\(\s*["']?\s*(?:https?:|\/\/)|@import/i.test(text);

/** What is wrong with a file for its use, as one sentence; undefined when it is right. `bytes` is undefined when the file cannot be read. */
export function fileProblem(path: string, bytes: Buffer | undefined, use: FileUse): string | undefined {
  const { endings, most, words } = FILE_USES[use];
  const ending = endingOf(path);
  const kinds = endings.map((one) => KINDS[one].name).filter((name, at, all) => all.indexOf(name) === at).join(', ');
  if (!bytes) return `The file ${path} does not exist. Save ${words} there first, or give the path of a file in the repo folder.`;
  if (!(endings as readonly string[]).includes(ending)) return `The file ${path} is no ${kinds} file. Give ${words} as one of these: ${kinds}.`;
  if (!KINDS[ending].test(bytes)) return `The file ${path} is not a ${KINDS[ending].name} file inside, whatever its name says. Save it again as ${KINDS[ending].name}.`;
  if (bytes.length > most) return `The file ${path} is ${Math.ceil(bytes.length / KB).toLocaleString('en-US')} KB. Give ${words} of at most ${(most / KB).toLocaleString('en-US')} KB, for example a smaller size of it.`;
  if (ending === 'svg' && unsafeSvg(bytes.toString('utf8'))) return `The file ${path} holds a script, an event attribute or an outside address. Give a PNG, or an SVG with none of them.`;
  if (use === 'film' && !H264.some((name) => bytes.includes(name, 0, 'latin1'))) return `The film ${path} holds no H.264 video. VS Code plays a film only as an MP4 file with H.264 video: save it again with that kind of video.`;
  return undefined;
}

// ----- marks whose line changed -----

/** Where a mark stands in the text of its file now (counted from 1), or undefined when its line changed: then it is hidden until the next run. */
export function markLineNow(mark: Pick<Mark, 'line' | 'code'>, lines: string[]): number | undefined {
  const at = findBlock(lines, [mark.code], mark.line - 1);
  return at < 0 ? undefined : at + 1;
}

/** Each mark with the line where it stands now, or undefined when it is hidden. Reads each file once. */
export function marksNow<T extends Pick<Mark, 'file' | 'line' | 'code'>>(folder: string, marks: T[]): { mark: T; at?: number }[] {
  const texts = new Map<string, string[] | undefined>();
  return marks.map((mark) => {
    if (!texts.has(mark.file)) texts.set(mark.file, fileText(folder, mark.file)?.split('\n'));
    const lines = texts.get(mark.file);
    return { mark, at: lines ? markLineNow(mark, lines) : undefined };
  });
}

// ----- the work for the writers of a set -----

/**
 * The signs of a service that the candidates of `mark-groups --set services` come from: the one list. Each finds lines; the writer keeps a line
 * when it reaches a service, and drops it otherwise. `may` guesses the service from the words that the sign found.
 */
const SIGNS: { why: string; find: RegExp; may: (found: RegExpExecArray) => string }[] = [
  { why: 'a web address', find: /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/i, may: (found) => found[1].toLowerCase().replace(/^(www|api)\./, '') },
  { why: 'a key or an address read from the environment', find: /(?:environ|getenv|process\.env|import\.meta\.env)\W{1,4}([A-Z][A-Z0-9_]*_(?:URL|URI|KEY|TOKEN|SECRET|HOST|DSN|ENDPOINT))\b/, may: (found) => found[1].split('_')[0].toLowerCase() },
  { why: 'an HTTP client', find: /\b(?:requests|httpx|aiohttp|axios|urllib\.request)\.(?:get|post|put|patch|delete|request|urlopen)\b|\bfetch\(/, may: () => '' },
  { why: 'a query of a database', find: /\b(?:select\b.+\bfrom|insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+table)\s+([a-z_][\w.]*)/i, may: () => '' },
  { why: 'a client of a service', find: /\b([A-Z][A-Za-z0-9]*?)(?:Client|Api|API|SDK)\(|\b([a-z0-9_]+)\.(?:client|resource|create_client|connect)\(/, may: (found) => (found[1] ?? found[2] ?? '').toLowerCase() },
];

/** Files that set up services for the code: compose files, infrastructure files, and the files of a platform that runs it. */
const SERVICE_FILES = /(^|\/)((docker-)?compose\.ya?ml|serverless\.ya?ml|[^/]+\.tf|template\.ya?ml|vercel\.json|netlify\.toml|fly\.toml|app\.ya?ml)$/i;

/** A line that a sign found, with the service that it may be. */
export interface Candidate {
  line: number;
  text: string;
  why: string;
  may?: string;
}

const CANDIDATE_TEXT = 160; // a long line is cut in the list

/** The lines of a text that a sign of a service finds; every line of a file that sets up services. */
export function candidatesIn(path: string, text: string): Candidate[] {
  const found: Candidate[] = [];
  const all = SERVICE_FILES.test(path);
  text.split('\n').forEach((line, index) => {
    if (!line.trim()) return;
    const hit = SIGNS.map((sign) => ({ sign, match: sign.find.exec(line) })).find((one) => one.match);
    if (!hit && !(all && /\b(image|service|provider|resource|url|endpoint|bucket|function)\b/i.test(line))) return;
    const may = hit?.sign.may(hit.match!);
    found.push({ line: index + 1, text: line.trim().slice(0, CANDIDATE_TEXT), why: hit?.sign.why ?? 'a file that sets up services', ...(may ? { may } : {}) });
  });
  return found;
}

/** One file for a writer of marks; for services, with its candidate lines. */
export interface MarkFile {
  path: string;
  lines: number;
  candidates?: Candidate[];
}

export interface MarkGroup {
  name: string;
  area?: string;
  files: MarkFile[];
}

const GROUP_LINES = 3000; // a writer of a custom set reads whole files: about this many lines in a group
const GROUP_CANDIDATES = 60; // a service writer reads the lines around its candidates

/** What a file of a set is now: the fingerprint of the text that the writer read (for services, its candidate lines), to know when it needs work again. */
const readPrint = (set: string, text: string, path: string): string =>
  fingerprint(set === SERVICES.id ? candidatesIn(path, text).map((one) => one.text).join('\n') : text);

/**
 * The work for the writers of a set, by area as note-groups gives it: only the files that need work, unless `all`. A file needs work when no writer of
 * the set has read it, when its text (for services, its candidate lines) changed since, or when a mark of it no longer stands at its line.
 * For services only the files with candidates are listed, each with its candidate lines. The groups are listed largest first, by their lines of code.
 */
export function markGroups(folder: string, map: RepoMap | undefined, set: string, all = false): { groups: MarkGroup[]; skipped: number } {
  const { files, skipped } = codeFiles(folder);
  const services = set === SERVICES.id;
  // For services also the files that set up services, which are no code files.
  const setUp = services ? ((repoFiles(folder) ?? []).filter((path) => SERVICE_FILES.test(path) && !files.some((one) => one.path === path))
    .flatMap((path) => { const text = fileText(folder, path); return text ? [{ path, text }] : []; })) : [];
  const read = map?.markedFiles?.[set] ?? {};
  const own = (map?.marks ?? []).filter((mark) => mark.set === set);
  const hidden = new Set(marksNow(folder, own).filter((one) => one.at === undefined).map((one) => one.mark.file));
  const byArea = new Map<string | undefined, MarkFile[]>();
  for (const { path, text } of [...files, ...setUp].sort((a, b) => a.path.localeCompare(b.path))) {
    const candidates = services ? candidatesIn(path, text) : undefined;
    if (services && !candidates!.length && !own.some((mark) => mark.file === path)) continue;
    if (!all && read[path] === readPrint(set, text, path) && !hidden.has(path)) continue;
    const area = areaOf(map, path);
    byArea.set(area, [...(byArea.get(area) ?? []), { path, lines: text.split('\n').length, ...(candidates ? { candidates } : {}) }]);
  }
  const groups: MarkGroup[] = [];
  const size = (file: MarkFile): number => (services ? file.candidates?.length ?? 1 : file.lines);
  for (const area of areaOrder(map)) {
    let current: MarkFile[] = [];
    const close = (): void => {
      if (current.length) groups.push({ name: `${slug(area)}-${fingerprint(`${set}\n${current.map((file) => file.path).join('\n')}`).slice(0, 6)}`, ...(area ? { area } : {}), files: current });
      current = [];
    };
    for (const file of byArea.get(area) ?? []) {
      if (current.length && current.reduce((sum, one) => sum + size(one), 0) + size(file) > (services ? GROUP_CANDIDATES : GROUP_LINES)) close();
      current.push(file);
    }
    close();
  }
  return { groups: largestFirst(groups, (group) => group.files.reduce((sum, file) => sum + file.lines, 0)), skipped };
}

/**
 * What `apostil mark-groups` prints: the groups of the areas whose notes are all saved, so that the service and mark writers of an area
 * start as soon as its notes are saved, not when all notes of the repo are saved, and `waiting`: how many areas still wait for notes. With no map, every group.
 */
export function readyMarkGroups(folder: string, stored: StoredMap | undefined, set: string, all = false): ReturnType<typeof markGroups> & { waiting: number } {
  const listed = markGroups(folder, stored?.map, set, all);
  if (!stored) return { ...listed, waiting: 0 };
  const waiting = areasWaitingForNotes(noteGroups(folder, stored).groups);
  return { ...listed, groups: listed.groups.filter((group) => !waiting.has(group.area ?? '')), waiting: waiting.size };
}

/** The fingerprints that a save of a group keeps for the files that its writer read. */
export const readPrints = (folder: string, set: string, paths: string[]): Record<string, string> =>
  Object.fromEntries(paths.flatMap((path) => { const text = fileText(folder, path); return text === undefined ? [] : [[path, readPrint(set, text, path)]]; }));

// ----- what `apostil marks` prints -----

const HIDDEN_SHOWN = 10;

/** The counts of each set and value, the marks whose line changed (hidden until the next run) and the refused icons. Never all marks: an agent reads it. */
export function markFacts(folder: string, map: RepoMap | undefined, sets: MarkSet[], valuesOf: (set: string) => MarkValue[], only?: string) {
  const marks = map?.marks ?? [];
  const now = marksNow(folder, marks);
  return {
    sets: sets.filter((set) => !only || set.id === only).map((set) => {
      const own = now.filter((one) => one.mark.set === set.id);
      const standing = own.filter((one) => one.at !== undefined);
      const hidden = own.filter((one) => one.at === undefined);
      const known = new Map(valuesOf(set.id).map((value) => [value.id, value]));
      const used = [...new Set(own.map((one) => one.mark.value))];
      return {
        id: set.id, name: set.name, marks: standing.length,
        values: used.map((id) => ({ id, name: known.get(id)?.name ?? id, icon: !!known.get(id)?.icon, marks: standing.filter((one) => one.mark.value === id).length })),
        ...(hidden.length ? { hidden: { count: hidden.length, files: [...new Set(hidden.map((one) => one.mark.file))].slice(0, HIDDEN_SHOWN) } } : {}),
      };
    }),
    iconRefused: (map?.iconRefused ?? []).filter((one) => !only || one.set === only),
    // The services with marks and no icon: apostil icon tries each from its site (skill apostil-map-repo, Step 7).
    noIcon: (!only || only === SERVICES.id ? [...new Set(now.filter((one) => one.mark.set === SERVICES.id && one.at !== undefined).map((one) => one.mark.value))] : [])
      .flatMap((id) => { const value = valuesOf(SERVICES.id).find((one) => one.id === id); return value?.icon ? [] : [{ id, name: value?.name ?? id, ...(value?.site ? { site: value.site } : {}) }]; }),
  };
}

// ----- the checks of add-marks that need no store -----

export const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
export const isLine = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1;
export const isId = (value: unknown): value is string => isText(value) && ID.test(value);
export const ONE_WORD = /^[a-z][a-z0-9_-]*$/i;

/** A web address as Apostil keeps it: no "https://", no "www.", no slash at its end, in small letters. */
export const siteOf = (site: string): string => site.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
