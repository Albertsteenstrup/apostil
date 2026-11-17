// The saves of marks and of the look. `apostil add-marks` checks the marks of one group for one set against the code and keeps them in the map;
// `apostil set-look` checks a look and keeps it, with its files, in Apostil's store. Nothing goes into the repo.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { currentBranch, fileText, headCommit, repoFiles, repoId, repoRoot } from '../shared/git';
import { apostilCommands, lookFiles, lookProblems, type Look, type LookFile } from '../shared/look';
import {
  endingOf, fileProblem, FILE_USES, isId, isLine, isText, ONE_WORD, readPrints, RELATIONS, SERVICES, siteOf,
  type IconRefused, type Mark, type MarkSet, type MarkValue, type NamedThing, type Relation,
} from '../shared/marks';
import type { RepoMap } from '../shared/repo-map';
import type { Store } from '../shared/store';

/** The sets of a repo: the built-in services, then the sets of its look. */
export const setsOf = (store: Store, repo: string): MarkSet[] => [SERVICES, ...(store.getLook(repo)?.look.sets ?? [])];

/** The known values of a set: those that Apostil has seen in any repo, and those that the look of the repo declares. */
export function valuesOf(store: Store, repo: string, set: string): MarkValue[] {
  const own = store.getLook(repo)?.look.sets?.find((one) => one.id === set)?.values ?? [];
  const seen = store.markValues(set).filter((value) => !own.some((one) => one.id === value.id));
  return [...own, ...seen];
}

/** A small kept file (an icon) as a data address, for a page that draws it; undefined when the file is gone. */
export function dataAddress(path: string): string | undefined {
  const type: Record<string, string> = { png: 'image/png', svg: 'image/svg+xml', ico: 'image/x-icon', webp: 'image/webp' };
  try {
    return `data:${type[endingOf(path)] ?? 'image/png'};base64,${readFileSync(path).toString('base64')}`;
  } catch {
    return undefined;
  }
}

/** The kept icon of a value as a data address; undefined when it has none. */
export const iconData = (store: Store, set: string, value: MarkValue): string | undefined =>
  (value.icon ? dataAddress(store.iconFile(set, value.id, value.icon)) : undefined);

/** Reads a file of the repo folder, or undefined when it is not there or lies outside the folder. */
function readInRepo(root: string, path: string): Buffer | undefined {
  if (!isText(path) || path.startsWith('/') || path.split('/').includes('..')) return undefined;
  try {
    return readFileSync(join(root, path));
  } catch {
    return undefined;
  }
}

const ICON_ENDINGS = FILE_USES.icon.endings;

/** An icon or a look file that a writer put in the top folder of the repo: removed after a save that worked, so it never goes into a change. */
const isDraftFile = (path: string): boolean => /^apostil-(icon|look)-[^/]+$/.test(path);

// ----- add-marks -----

interface DraftValue {
  id: string;
  name?: string;
  site?: string;
  icon?: string;
}

interface DraftMark {
  value: string;
  file: string;
  line: number;
  name: string;
  relation?: Relation;
  thing?: NamedThing;
}

/** What `apostil add-marks` is given: the marks of one group for one set, the files that its writer read, new values, and icons that a website refused. */
interface MarksDraft {
  group: string;
  set: string;
  files?: string[];
  values?: DraftValue[];
  marks: DraftMark[];
  iconRefused?: { value: string; tried: string }[];
}

export interface AddMarksResult {
  saved: boolean;
  problems: string[];
  marks?: number; // the marks of the group for the set now
  values?: string[]; // the values that the save declared or gave an icon
  iconRefused?: number;
  iconsRemoved?: string[];
}

const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The problems of the form of the JSON, before anything is read. */
function draftShape(draft: unknown): string[] {
  const form = 'The JSON must be an object: { "group", "set", "files", "values"?, "marks": [ { "value", "file", "line", "name", "relation"?, "thing"? } ], "iconRefused"? }.';
  if (!isObject(draft)) return [form];
  const problems: string[] = [];
  if (!isId(draft.group)) problems.push('"group" must be the name of your group, as apostil mark-groups printed it.');
  if (!isId(draft.set)) problems.push('"set" must be the id of the mark set, for example "services".');
  if (!Array.isArray(draft.marks)) problems.push('"marks" must be a list of marks. Write an empty list when your files have none.');
  if (draft.files !== undefined && !(Array.isArray(draft.files) && draft.files.every(isText))) problems.push('"files" must be a list of the paths that your group lists.');
  if (draft.values !== undefined && !(Array.isArray(draft.values) && draft.values.every((one: unknown) => isObject(one) && isId(one.id)))) problems.push('"values" must be a list of { "id", "name", "site"?, "icon"? }, each id in small letters, digits and "-".');
  if (draft.iconRefused !== undefined && !(Array.isArray(draft.iconRefused) && draft.iconRefused.every((one: unknown) => isObject(one) && isText(one.value) && isText(one.tried)))) {
    problems.push('"iconRefused" must be a list of { "value", "tried" }: the id, and the web address that refused you.');
  }
  return problems;
}

/**
 * Saves the marks of one group for one set. It replaces the marks of that set that the group saved before, and those of the files that the JSON names,
 * and keeps all else. The store reads, changes and writes the map in one step, so writers at the same time keep each other's work. Nothing is saved
 * when anything has a problem. A value is known in the set or declared once in the JSON; its icon is kept in Apostil's store, by set and value.
 */
export function addMarksToMap(store: Store, folder: string, draft: unknown): AddMarksResult {
  let result: AddMarksResult = { saved: false, problems: [] };
  const repo = repoId(folder);
  const root = repoRoot(folder);
  store.updateMap(repo, headCommit(folder), (stored) => {
    const fail = (problems: string[]): undefined => { result = { saved: false, problems }; return undefined; };
    if (!stored) return fail(['This repo has no saved map. Save one with apostil save-map first.']);
    const shape = draftShape(draft);
    if (shape.length) return fail(shape);
    const { group, set: setId, values: declared = [], marks: written, iconRefused = [] } = draft as MarksDraft;
    const set = setsOf(store, repo).find((one) => one.id === setId);
    if (!set) return fail([`"${setId}" is no mark set of this repo. Use "${SERVICES.id}", or a set that apostil look lists.`]);
    const services = set.id === SERVICES.id;
    const known = new Map(valuesOf(store, repo, set.id).map((value) => [value.id, value]));
    const problems: string[] = [];

    // The values that the JSON declares: once each; a new service with its name and web address, and no second id for one web address.
    const ids = new Set<string>();
    const icons = new Map<string, { path: string; bytes: Buffer }>();
    for (const value of declared) {
      const at = `The value "${value.id}"`;
      if (ids.has(value.id)) problems.push(`${at} is declared twice. Declare each value once.`);
      ids.add(value.id);
      const old = known.get(value.id);
      if (!old && !isText(value.name)) problems.push(`${at} is new, so give its "name".`);
      if (services && !old && !isText(value.site)) problems.push(`${at} is a new service, so give its "site": its web address, without https://.`);
      if (services && isText(value.site)) {
        const same = [...known.values(), ...declared.filter((one) => one !== value)].find((one) => one.id !== value.id && one.site && siteOf(one.site) === siteOf(value.site!));
        if (same) problems.push(`${at} has the web address ${siteOf(value.site)}, as the service "${same.id}". Use the id "${same.id}" for it.`);
      }
      if (value.icon !== undefined) {
        const bytes = readInRepo(root, value.icon);
        const bad = fileProblem(value.icon, bytes, 'icon');
        if (bad) problems.push(`${at}: ${bad}`);
        else icons.set(value.id, { path: value.icon, bytes: bytes! });
      }
    }
    const isKnown = (id: string): boolean => known.has(id) || ids.has(id);

    // The marks: a file of the repo, a line inside it, the word on that line, a known value, a relation for a service, a named thing of one word, one mark for one value at one line.
    const files = new Set(repoFiles(folder) ?? []);
    const texts = new Map<string, string[] | undefined>();
    const linesOf = (path: string): string[] | undefined => {
      if (!texts.has(path)) texts.set(path, fileText(folder, path)?.split('\n'));
      return texts.get(path);
    };
    const seen = new Set<string>();
    const named = new Set((draft as MarksDraft).files ?? written.map((mark) => mark?.file).filter(isText));
    const others = (stored.marks ?? []).filter((mark) => !(mark.set === set.id && (mark.group === group || named.has(mark.file))));
    written.forEach((mark, index) => {
      const at = `Mark ${index + 1} (${mark?.file ?? '?'} line ${mark?.line ?? '?'})`;
      if (!isObject(mark) || !isText(mark.value) || !isText(mark.file) || !isLine(mark.line) || !isText(mark.name)) {
        return void problems.push(`${at}: a mark is { "value", "file", "line", "name" }${services ? ', with "relation"' : ''}, and "thing" when the code names one.`);
      }
      if (!isKnown(mark.value)) problems.push(`${at}: "${mark.value}" is no known value of the set "${set.id}". Declare it once in "values"${services ? ' with its "name" and "site"' : ' with its "name"'}, or use a known id that apostil mark-groups lists.`);
      const lines = files.has(mark.file) ? linesOf(mark.file) : undefined;
      if (!lines) return void problems.push(`${at}: the file ${mark.file} is no file of the repo. Give a path that Git lists.`);
      const text = lines[mark.line - 1];
      if (text === undefined) return void problems.push(`${at}: line ${mark.line} is not inside ${mark.file}, which has ${lines.length} lines.`);
      if (mark.name.trim().length < 2 || !text.includes(mark.name)) problems.push(`${at}: line ${mark.line} does not hold "${mark.name}" (it holds "${text.trim().slice(0, 80)}"). Give a word that stands on that line.`);
      if (services && !RELATIONS.includes(mark.relation as Relation)) problems.push(`${at}: "relation" must be one of ${RELATIONS.map((one) => `"${one}"`).join(', ')}.`);
      if (!services && mark.relation !== undefined) problems.push(`${at}: leave out "relation". Only a service has one.`);
      if (mark.thing !== undefined && !(isObject(mark.thing) && typeof mark.thing.kind === 'string' && ONE_WORD.test(mark.thing.kind) && isText(mark.thing.name))) {
        problems.push(`${at}: "thing" must be { "kind": one word, as "table" or "model", "name": the fixed text in the code }.`);
      }
      const key = `${mark.value}|${mark.file}|${mark.line}`;
      if (seen.has(key) || others.some((other) => other.set === set.id && `${other.value}|${other.file}|${other.line}` === key)) {
        problems.push(`${at}: "${mark.value}" has a mark at this line already. Keep one mark for one value at one line.`);
      }
      seen.add(key);
    });
    // A service with marks has an icon, or is named in "iconRefused": a writer gets the icon with apostil icon, the owner sees letters otherwise.
    const pending = (id: string): string | undefined => ICON_ENDINGS.find((ending) => existsSync(store.iconFile(set.id, id, ending)));
    if (services) {
      const refusedNow = new Set([...iconRefused.map((one) => one.value), ...(stored.iconRefused ?? []).filter((one) => one.set === set.id).map((one) => one.value)]);
      for (const id of new Set(written.map((mark) => mark?.value).filter(isText))) {
        const value = declared.find((one) => one.id === id), old = known.get(id);
        if (!isKnown(id) || value?.icon || old?.icon || pending(id) || refusedNow.has(id)) continue;
        const site = siteOf(value?.site ?? old?.site ?? '');
        const address = site ? `https://${site}` : 'https://<its site>';
        problems.push(`Service "${value?.name ?? old?.name ?? id}" has no icon. Run apostil icon ${id} ${address}${old ? '' : ` --site ${site || '<its site>'}`}, or name a picture of its own website in "icon"; when its website gives none, add it to "iconRefused" with the address that you tried.`);
      }
    }
    for (const one of iconRefused) if (!isKnown(one.value)) problems.push(`The refused icon of "${one.value}": it is no known value. Declare it in "values" first.`);
    for (const path of named) if (!files.has(path)) problems.push(`"files" names ${path}, which is no file of the repo.`);
    if (problems.length) return fail(problems);

    // Keep the values and their icons, by set and value, for every repo.
    for (const value of declared) {
      const old = known.get(value.id);
      const icon = icons.get(value.id);
      if (icon) {
        const file = store.iconFile(set.id, value.id, endingOf(icon.path));
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, icon.bytes);
      }
      store.saveMarkValue(set.id, {
        id: value.id, name: value.name ?? old?.name ?? value.id, ...(value.site ?? old?.site ? { site: siteOf(value.site ?? old!.site!) } : {}),
        ...(icon ? { icon: endingOf(icon.path) } : old?.icon ? { icon: old.icon } : pending(value.id) ? { icon: pending(value.id) } : {}),
      });
    }
    const marks: Mark[] = written.map((mark) => ({
      set: set.id, value: mark.value, file: mark.file, line: mark.line, name: mark.name, ...(services ? { relation: mark.relation } : {}),
      ...(mark.thing ? { thing: { kind: mark.thing.kind, name: mark.thing.name } } : {}), group, code: linesOf(mark.file)![mark.line - 1],
    }));
    const withIcon = new Set([...icons.keys(), ...declared.filter((value) => pending(value.id)).map((value) => value.id), ...[...known.values()].filter((value) => value.icon).map((value) => value.id)]);
    const refused: IconRefused[] = [
      ...(stored.iconRefused ?? []).filter((one) => one.set !== set.id || (!withIcon.has(one.value) && !iconRefused.some((again) => again.value === one.value))),
      ...iconRefused.filter((one) => !withIcon.has(one.value)).map((one) => ({ set: set.id, value: one.value, tried: one.tried })),
    ];
    const map: RepoMap = {
      ...stored, marks: [...others, ...marks],
      markedFiles: { ...stored.markedFiles, [set.id]: { ...stored.markedFiles?.[set.id], ...readPrints(folder, set.id, [...named]) } },
      ...(refused.length ? { iconRefused: refused } : {}),
    };
    if (!refused.length) delete map.iconRefused;
    // The icon files in the top folder of the repo go: they are never a part of a change.
    const removed = [...icons.values()].map((icon) => icon.path).filter(isDraftFile);
    for (const path of removed) rmSync(join(root, path), { force: true });
    result = {
      saved: true, problems: [], marks: marks.length, ...(declared.length ? { values: declared.map((value) => value.id) } : {}),
      ...(refused.length ? { iconRefused: refused.filter((one) => one.set === set.id).length } : {}), ...(removed.length ? { iconsRemoved: removed } : {}),
    };
    return map;
  });
  return result;
}

// ----- set-look -----

export interface SetLookResult {
  saved: boolean;
  problems: string[];
  rules?: number;
  sets?: string[];
  files?: number; // the files that the look keeps in Apostil's store
  filesRemoved?: string[]; // the draft files of the top folder that the save removed
}

/** A draft of a look with its problems; with none, the look, the files that it names, and the bytes of each, read from the repo folder or the store. */
interface LookDraft {
  problems: string[];
  look?: Look;
  files?: LookFile[];
  read?: { file: LookFile; bytes: Buffer | undefined }[];
}

/** Checks a draft of a look as set-look does, its files too. It reads the repo folder and the store, and writes nothing. */
function readLookDraft(store: Store, folder: string, draft: unknown): LookDraft {
  const repo = repoId(folder);
  const root = repoRoot(folder);
  const parts = store.findChange(repo, currentBranch(root))?.file.parts.map((part) => part.id); // the parts of the saved change of the branch, when it has one
  const problems = lookProblems(draft, { folder: root, map: store.getMap(repo)?.map, commands: apostilCommands(), parts });
  if (problems.length) return { problems };
  const look = JSON.parse(JSON.stringify(draft)) as Look;
  const files = lookFiles(look);
  const keep = store.lookFolder(repo);
  // A file of the repo folder; else a file that Apostil keeps for this look already, as `apostil look` names it (a kept file, or the ending of the icon of a value).
  const kept = (file: LookFile): Buffer | undefined => {
    const path = file.value && /^(png|svg|ico|webp)$/.test(file.path) ? store.iconFile(file.value.set, file.value.id, file.path) : join(keep, file.path);
    return !file.path.includes('/') && existsSync(path) ? readFileSync(path) : undefined;
  };
  const read = files.map((file) => ({ file: file.value && /^(png|svg|ico|webp)$/.test(file.path) ? { ...file, path: `${file.value.id}.${file.path}` } : file, bytes: readInRepo(root, file.path) ?? kept(file) }));
  const bad = read.flatMap(({ file, bytes }) => { const problem = fileProblem(file.path, bytes, file.use); return problem ? [`${file.at}: ${problem}`] : []; });
  return bad.length ? { problems: bad } : { problems: [], look, files, read };
}

/** `apostil set-look --check`: the problems that set-look would refuse a look for, its files too. It saves nothing and removes no file. */
export const checkLook = (store: Store, folder: string, draft: unknown): string[] => readLookDraft(store, folder, draft).problems;

/**
 * Checks a look and keeps it as the look of the repo, in Apostil's store; a new look replaces the old one, and `{ "rules": [] }` brings back the default.
 * Each file that it names (an icon, a picture, a film) is checked and kept in the store, and the look names the kept file. Nothing goes into the repo.
 */
export function setLook(store: Store, folder: string, draft: unknown): SetLookResult {
  const { problems, look, files, read } = readLookDraft(store, folder, draft);
  if (!look || !files || !read) return { saved: false, problems };
  const repo = repoId(folder);
  const root = repoRoot(folder);
  const keep = store.lookFolder(repo);
  // A kept file is named by its contents, so the same file twice is kept once.
  mkdirSync(keep, { recursive: true });
  for (const { file, bytes } of read) {
    const name = `${createHash('sha1').update(bytes!).digest('hex').slice(0, 16)}.${endingOf(file.path)}`;
    writeFileSync(join(keep, name), bytes!);
    file.put(name);
  }
  // The icons of the values of the sets are kept as the icons of add-marks are, so that one path draws every icon.
  for (const set of look.sets ?? []) {
    for (const value of set.values ?? []) {
      if (!value.icon) continue;
      const file = store.iconFile(set.id, value.id, endingOf(value.icon));
      mkdirSync(dirname(file), { recursive: true });
      copyFileSync(join(keep, value.icon), file);
      value.icon = endingOf(value.icon);
    }
  }
  store.saveLook(repo, look);
  const removed = [...new Set(files.map((file) => file.path).filter(isDraftFile))];
  for (const path of removed) rmSync(join(root, path), { force: true });
  return { saved: true, problems: [], rules: look.rules.length, sets: (look.sets ?? []).map((set) => set.id), files: new Set(read.map(({ file }) => file.path)).size, ...(removed.length ? { filesRemoved: removed } : {}) };
}
