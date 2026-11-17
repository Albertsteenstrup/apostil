// The blocks of a look when they open: a page of the look in its tab, a section of its own in a window, or the window of a target. Their data is
// read now, and only now: a file of the repo through shared/repo-data.ts, a kept picture as an address, a diagram of the map as the graphs page
// draws a panel. A file that changed since the save gives one quiet line in place of its block. Home carries none of it (lookData() gives refs).
// One function for the extension, view/example-data.ts and the tests. No `vscode` import.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../shared/git';
import { blockKind, blocksOfRef, LOOK_PARTS, missingIn, withBlockRefs, type Block } from '../shared/look';
import { listedFiles, readRepoData, readRepoText, type ReadFault } from '../shared/repo-data';
import type { Store } from '../shared/store';
import { homeData, idOf, type HomeDiagram } from './home-data';
import { lookData, type LookData } from './look-data';
import { repoName } from './page-data';

const LIMITS = LOOK_PARTS.limits;

/** A block as the page draws it: its written value, the data of its file (with `from`, the file, and `more`, the rows left out), or one quiet line. */
export type ShownBlock = Record<string, unknown> & { title?: string; quiet?: string; from?: string; more?: number };

/** A page of the look as its tab shows it. `files` are the files of the repo that its blocks read: the tab follows them. */
export interface CustomPageData {
  kind: 'page';
  repo: string;
  folder: string;
  id: string;
  title: string;
  blocks: ShownBlock[];
  files: string[];
  look?: LookData; // for a diagram of a block, drawn in the look of the repo
  gone?: string; // the look has no such page now
}

/** Where the blocks read from: the repo, the files that Git lists, the kept files of the look, and the diagrams of the map (read once, when a block needs one). */
interface Place {
  folder: string;
  listed: Set<string>;
  keep: string;
  address: (file: string) => string;
  diagram: (id: string) => HomeDiagram | undefined;
  files: Set<string>;
}

const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
/** A value of a file as the words of a cell: a number or words as they are, anything else as JSON. */
const cell = (value: unknown): string | number => (typeof value === 'number' || typeof value === 'string' ? value : value === undefined || value === null ? '' : typeof value === 'boolean' ? String(value) : JSON.stringify(value));

/** The quiet line of a file that a block cannot read now. */
function goneLine(fault: ReadFault, path: string): string {
  const ending = (/\.([a-z]+)$/i.exec(path)?.[1] ?? '').toUpperCase();
  return {
    unlisted: `${path} is gone now.`, outside: `${path} lies outside the repo.`, large: `${path} is larger than ${LIMITS.fileBytes / 1024 / 1024} MB now.`,
    kind: `${path} is no CSV, TSV or JSON file.`, unread: `${path} does not read as ${ending} now.`,
  }[fault];
}

/** One block with its data now. */
function shown(block: Block, place: Place): ShownBlock {
  const kind = blockKind(block)!;
  const title = block.title ? { title: block.title } : {};
  const quiet = (words: string): ShownBlock => ({ ...title, quiet: words });
  const value = block[kind];
  if (kind === 'row') return { ...title, row: (value as Block[]).map((one) => shown(one, place)) };
  if (kind === 'picture') {
    const path = join(place.keep, String(value));
    return existsSync(path) ? { ...title, picture: place.address(path) } : quiet('The picture of this block is gone.');
  }
  if (kind === 'diagram') {
    const diagram = place.diagram(String(value));
    if (!diagram) return quiet(`The map has no diagram "${String(value)}" now.`);
    const { id, title: name, mermaid, graph, nodes, schema, edgeLines } = diagram;
    return { ...title, diagram: { id, title: name, mermaid, graph, nodes, lit: [], ...(schema ? { schema } : {}), ...(edgeLines ? { edgeLines } : {}) } };
  }
  if (kind === 'code' && typeof value === 'string') return { ...title, code: { text: value } };
  if (isObject(value) && typeof value.file === 'string') return fromFile(kind, value, title, place);
  return { ...title, [kind]: withBlockRefs(value) }; // links and a button keep their targets; the window of a target only its ref
}

/** A block whose data is a file of the repo: its rows, keys or lines now, or one quiet line when the file changed since the save. */
function fromFile(kind: string, source: Record<string, any>, title: { title?: string }, place: Place): ShownBlock {
  const path: string = source.file;
  const quiet = (words: string): ShownBlock => ({ ...title, quiet: words });
  place.files.add(path);
  if (kind === 'code' && Array.isArray(source.lines)) {
    const read = readRepoText(place.folder, path, LIMITS.fileBytes, place.listed);
    if ('fault' in read) return quiet(goneLine(read.fault, path));
    const lines = read.text.split('\n');
    const [from, to] = source.lines as number[];
    if (to > lines.length) return quiet(`${path} has ${lines.length} lines now.`);
    return { ...title, code: { text: lines.slice(from - 1, to).join('\n'), file: path, from, to } };
  }
  const read = readRepoData(place.folder, path, LIMITS.fileBytes, place.listed);
  if ('fault' in read) return quiet(goneLine(read.fault, path));
  const { rows, keys } = read.data;
  if ((kind === 'table' || kind === 'bars') !== !!rows) return quiet(`${path} holds ${rows ? 'rows' : 'one object'} now.`);
  const missing = missingIn(kind, source, read.data);
  if (missing) return quiet(`${path} has no ${missing.of} "${missing.name}" now.`);
  const most: number = source.rows ?? LIMITS.rowsWhenNone;
  const more = rows ? Math.max(0, rows.rows.length - most) : 0;
  const from = { from: path, ...(more ? { more } : {}) };
  if (kind === 'table') return { ...title, table: { columns: source.columns, rows: rows!.rows.slice(0, most).map((row) => (source.columns as string[]).map((name) => cell(row[name]))) }, ...from };
  if (kind === 'bars') return { ...title, bars: rows!.rows.slice(0, most).map((row) => [String(cell(row[source.label])), Number(row[source.value]) || 0]), ...from };
  if (kind === 'fields') return { ...title, fields: (source.keys as string[]).map((key) => [key, cell(keys![key])]), from: path };
  const found = keys![source.key];
  if (kind === 'code') return { ...title, code: { text: JSON.stringify(found, null, 2), file: path } };
  // A state: a word, or an object with its word, colour and words.
  const state = isObject(found) && typeof found.word === 'string' ? { word: found.word, ...(found.color ? { color: found.color } : {}), ...(found.text ? { text: String(found.text) } : {}) } : { word: String(cell(found)) };
  return { ...title, state, from: path };
}

/** The blocks with their data now, and the files of the repo that they read. */
export function blocksNow(store: Store, folder: string, blocks: Block[], address: (file: string) => string): { blocks: ShownBlock[]; files: string[] } {
  const root = repoRoot(folder);
  const repo = idOf(root) ?? '';
  let diagrams: HomeDiagram[] | undefined;
  const place: Place = {
    folder: root, listed: listedFiles(root), keep: store.lookFolder(repo), address, files: new Set(),
    diagram: (id) => (diagrams ??= homeData(store, root).map?.diagrams ?? []).find((one) => one.id === id),
  };
  return { blocks: blocks.map((block) => shown(block, place)), files: [...place.files] };
}

/** The answer to a page that asks for the blocks of a ref (a section of its own, the window of a target): the blocks now, or why there are none. */
export function blocksAnswer(store: Store, folder: string, ref: string, address: (file: string) => string): { blocks: ShownBlock[] } | { gone: string } {
  const repo = idOf(folder);
  const look = repo ? store.getLook(repo)?.look : undefined;
  const blocks = look && blocksOfRef(look, ref);
  if (!blocks) return { gone: 'The look of this repo changed since this page loaded.' };
  return { blocks: blocksNow(store, folder, blocks, address).blocks };
}

/** A page of the look for its tab: its title and its blocks with their data now. A diagram of a block brings the look with the marks. */
export function pageData(store: Store, folder: string, id: string, address: (file: string) => string): CustomPageData {
  const repo = idOf(folder);
  const page = repo ? store.getLook(repo)?.look.pages?.find((one) => one.id === id) : undefined;
  const base = { kind: 'page' as const, repo: repoName(folder), folder, id };
  if (!repo || !page) return { ...base, title: id, blocks: [], files: [], gone: `The look of this repo has no page "${id}" now.` };
  const { blocks, files } = blocksNow(store, folder, page.blocks, address);
  const withDiagram = JSON.stringify(page.blocks).includes('"diagram":');
  return { ...base, title: page.title, blocks, files, ...(store.getMap(repo) ? { look: lookData(store, repo, folder, address, withDiagram) } : {}) };
}

/** The pages of the look of a repo, by id and title: the command that opens one lists them. */
export const lookPages = (store: Store, folder: string): { id: string; title: string }[] => {
  const repo = idOf(folder);
  return (repo ? store.getLook(repo)?.look.pages ?? [] : []).map(({ id, title }) => ({ id, title }));
};
