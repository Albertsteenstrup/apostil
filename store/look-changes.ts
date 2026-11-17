// What each rule of a look picks now, in words, for `apostil set-look` and `apostil set-look --check`: "Rule 1: 2 nodes get a colour.", and a note
// for a rule that picks nothing now (not a fault: the marks of a new set come after the save). The picks are the pages' own: the first part of
// view/media/marks.js, read in Node as view/marks.test.ts does, on the diagrams of Home (homeData) and on the note cards of the map; and on the page of
// the saved change of the branch and its file tabs (changeThings and fileThings of marks.js, build 60).

import { an, LOOK_PARTS, nameOf, namesPart, type Look, type LookPartsList, type Pick } from '../shared/look';
import { currentBranch, repoId, repoRoot } from '../shared/git';
import type { Store } from '../shared/store';
import { homeData, type HomeDiagram } from '../view/home-data';
import { pageData } from '../view/page-data';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Marks = require('../../view/media/marks.js');

const LIST: LookPartsList = LOOK_PARTS;
/** The areas of the parts that the changes do not count: the list and the tree of the side bar, and the page of a pull request. */
const UNCOUNTED = ['side-bar', 'pull-lines', 'files', 'pull-request', 'conversation'];

type Thing = { kind: string; slots?: Record<string, unknown> } & Record<string, unknown>;

/** The kinds of the page of a change and of its file tabs: they are counted on the saved change of the branch and the files with notes or marks. */
const PAGE_AREAS = ['change', 'diffs', 'comments', 'file-tab'];
const onPage = (kind: string): boolean => PAGE_AREAS.includes((LIST.components[kind]?.area ?? ''));
/** The kinds whose things Home or a graphs page make as they show (a step of the trail, the panels of a graphs page, build 59): not counted either. */
const UNCOUNTED_KINDS = ['trail-step', 'header', 'frame', 'comment-box', 'count-line', 'panel', 'panel-node', 'panel-title', 'panel-level', 'panel-in'];

/** Counts the things that a pick takes now, as the pages pick them. `page` says whether the branch has a saved change. */
function counter(store: Store, folder: string): ((pick: Pick) => number) & { page: boolean } {
  const root = repoRoot(folder);
  const home = homeData(store, root);
  const marks = home.look?.marks ?? [];
  const none = { marks, rules: [] };
  const diagrams = (home.map?.diagrams ?? []).map((diagram: HomeDiagram) => ({ diagram, things: Marks.thingsOf(diagram, none) as Record<string, Thing> }));
  // The things of a diagram: its nodes, the count line of a step, its boxes (an area box, a file box), and a drawn process as a whole (build 59).
  const things = diagrams.flatMap(({ diagram, things: own }) => [...Object.values(own), ...Object.values(own).flatMap((thing) => (thing.count ? [thing.count as Thing] : [])),
    ...Marks.boxesOf(diagram, none), ...[Marks.drawingOf(diagram, none)].filter(Boolean)]);
  // A note card of the file tab stands for the lines of its note. The window of a step is a note in the diagram of the step (view/media/home.js),
  // so a pick of notes that names a diagram takes those windows.
  const map = store.getMap(repoId(root))?.map;
  const cards: Thing[] = [...(map?.fileNotes ?? []), ...(map?.diagrams ?? []).flatMap((diagram) => diagram.notes ?? [])].map((note) => {
    const card = { kind: 'note', paths: [note.file], at: [{ file: note.file, from: note.lines[0], to: note.lines[1] }], fields: { title: note.title, file: note.file, function: note.symbol ?? '', tests: note.tests?.length ?? 0 } };
    return { ...card, marks: Marks.marksIn(card, marks) };
  });
  const windows: Thing[] = diagrams.flatMap(({ diagram, things: ofDiagram }) => Object.entries(ofDiagram).filter(([node]) => diagram.nodes[node]?.note).map(([, thing]) => ({ ...thing, kind: 'note' })));
  // The page of the saved change of the branch, and the file tabs of the files with notes (of the change or of the map) or with marks.
  const change = store.findChange(repoId(root), currentBranch(root));
  const page = change ? pageData(store, change.id, root) : undefined;
  const notes = [...(page?.notes ?? []).filter((note) => !note.removed), ...(map?.fileNotes ?? [])].sort((a, b) => a.lines[0] - b.lines[0]);
  const files = [...new Set([...notes.map((note) => note.file), ...marks.map((mark: { file: string }) => mark.file)])];
  const tests = (name: string): number => page?.functionTests[name] ?? 0;
  const ofPage: Thing[] = [...(page ? Marks.changeThings(page, undefined, marks) : []), ...files.flatMap((path) => Marks.fileThings(path, notes.filter((note) => note.file === path), marks, tests))];
  const count = (pick: Pick): number => {
    if (onPage(pick.kind)) return ofPage.filter((thing) => thing.kind === pick.kind && Marks.picks(pick, thing)).length;
    if (pick.kind === 'note') return (pick.diagram ? windows : cards).filter((thing) => Marks.picks(pick, thing)).length;
    if (pick.kind !== 'arrow') return things.filter((thing) => Marks.picks(pick, thing)).length;
    // An arrow is a thing only inside edgesOf(), which gives the slots of a rule to the arrows that it picks: a probe slot tells which.
    const probe = { marks, rules: [{ pick, probe: { on: true } }] };
    return diagrams.reduce((sum, { diagram, things: ofDiagram }) => sum + Marks.edgesOf(diagram, probe, ofDiagram).filter((edge: Thing) => edge.slots?.['probe.on']).length, 0);
  };
  return Object.assign(count, { page: !!page });
}

/** Many of a kind in words: "nodes", "cards of the change", "boxes of the files in no part", "comment marks". */
function many(kind: string): string {
  const name = nameOf(kind);
  const [head, rest = ''] = name.split(/(?= (?:of|between|in|to) )/);
  return `${head.replace(/(x|s)$/, '$1e')}s${rest}`;
}

const joined = (items: string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** What a rule gives the things that it picks, in words, from the `gets` of its slots in LOOK_PARTS; a field with no words there is named. A slot that is one target gives "target". */
function gives(rule: Look['rules'][number]): string {
  const words = Object.entries(rule).filter(([slot]) => slot !== 'pick').flatMap(([slot, fields]) =>
    (LIST.slots[slot]?.target ? ['target'] : Object.keys(fields ?? {})).map((field) => LIST.slots[slot]?.gets?.[field] ?? `"${slot}.${field}"`));
  return joined(words) || 'nothing';
}

/** Why a pick takes nothing now: the first part of it that alone takes nothing. */
function whyNothing(pick: Pick, count: ((pick: Pick) => number) & { page: boolean }): string {
  const { kind, ...rest } = pick;
  const name = nameOf(kind);
  if (!count({ kind }) && onPage(kind) && !count.page && LIST.components[kind]?.area !== 'file-tab') return 'this branch has no saved change';
  if (!count({ kind })) return onPage(kind) ? `no page has a ${name} now` : `the map has no ${name} now`;
  for (const [key, value] of Object.entries(rest) as [string, unknown][]) {
    if (count({ kind, [key]: value } as Pick)) continue;
    const list = Array.isArray(value) ? value.join(', ') : String(value);
    if (key === 'mark') return `no ${name} holds a mark "${list}"`;
    if (key === 'paths') return `no ${name} lies inside ${list}`;
    if (key === 'diagram') return `the diagram "${list}" has no ${name}`;
    if (key === 'nodes') return kind === 'arrow' ? `no arrow runs between the nodes ${list}` : `no ${name} is one of the nodes ${list}`;
    return `no ${nameOf(kind)} fits its "${key}"`;
  }
  return `no ${nameOf(kind)} fits all of its pick at once`;
}

/** One line for each rule of a look that passed the check: how many things it picks now and what it gives them; and a note for each rule that picks nothing. */
export function lookChanges(store: Store, folder: string, look: Look): { changes: string[]; notes: string[] } {
  const count = counter(store, folder);
  const changes: string[] = [];
  const notes: string[] = [];
  look.rules.forEach((rule, index) => {
    // A part of the side bar or of a pull request is neither in the map nor on the page of the change, so it is not counted (build 61).
    if (UNCOUNTED.includes(LIST.components[rule.pick.kind]?.area) || UNCOUNTED_KINDS.includes(rule.pick.kind)) return void changes.push(`Rule ${index + 1}: ${an(rule.pick.kind)} that it picks gets ${gives(rule)}.`);
    const picked = count(rule.pick);
    changes.push(`Rule ${index + 1}: ${picked} ${picked === 1 ? `${nameOf(rule.pick.kind)} gets` : `${many(rule.pick.kind)} get`} ${gives(rule)}.`);
    if (!picked) notes.push(`Rule ${index + 1} picks nothing now: ${whyNothing(rule.pick, count)}.`);
    // A part id is checked against the saved change of the branch; with none, it is not checked.
    if (namesPart(rule) && !count.page) notes.push(`Rule ${index + 1} names a part, and this branch has no saved change: the part is not checked.`);
  });
  // A page of the look (build 58): the tab that it opens as.
  for (const page of look.pages ?? []) changes.push(`Page "${page.id}" opens as the tab "${page.title}", with ${page.blocks.length} ${page.blocks.length === 1 ? 'block' : 'blocks'}.`);
  return { changes, notes };
}
