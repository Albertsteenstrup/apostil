// What each rule of a look picks now, in words, for `apostil set-look` and `apostil set-look --check`: "Rule 1: 2 nodes get a colour.", and a note
// for a rule that picks nothing now (not a fault: the marks of a new set come after the save). The picks are the pages' own: the first part of
// view/media/marks.js, read in Node as view/marks.test.ts does, on the diagrams of Home (homeData) and on the note cards of the map.

import { calledOf, LOOK_PARTS, type Look, type LookPartsList, type Pick } from '../shared/look';
import { repoId, repoRoot } from '../shared/git';
import type { Store } from '../shared/store';
import { homeData, type HomeDiagram } from '../view/home-data';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Marks = require('../../view/media/marks.js');

const LIST: LookPartsList = LOOK_PARTS;
/** The kinds of the things of the map, which the changes count. */
const MAP_KINDS: string[] = ['node', 'step', 'call', 'arrow', 'note'];

type Thing = { kind: string; slots?: Record<string, unknown> } & Record<string, unknown>;

/** Counts the things that a pick takes now, as the pages pick them. */
function counter(store: Store, folder: string): (pick: Pick) => number {
  const root = repoRoot(folder);
  const home = homeData(store, root);
  const marks = home.look?.marks ?? [];
  const diagrams = (home.map?.diagrams ?? []).map((diagram: HomeDiagram) => ({ diagram, things: Marks.thingsOf(diagram, { marks, rules: [] }) as Record<string, Thing> }));
  const things = diagrams.flatMap((one) => Object.values(one.things));
  // A note card of the file tab stands for the lines of its note. The window of a step is a note in the diagram of the step (view/media/home.js),
  // so a pick of notes that names a diagram takes those windows.
  const map = store.getMap(repoId(root))?.map;
  const cards: Thing[] = [...(map?.fileNotes ?? []), ...(map?.diagrams ?? []).flatMap((diagram) => diagram.notes ?? [])].map((note) => {
    const card = { kind: 'note', paths: [note.file], at: [{ file: note.file, from: note.lines[0], to: note.lines[1] }], fields: { title: note.title, file: note.file, function: note.symbol ?? '', tests: note.tests?.length ?? 0 } };
    return { ...card, marks: Marks.marksIn(card, marks) };
  });
  const windows: Thing[] = diagrams.flatMap(({ diagram, things: ofDiagram }) => Object.entries(ofDiagram).filter(([node]) => diagram.nodes[node]?.note).map(([, thing]) => ({ ...thing, kind: 'note' })));
  return (pick) => {
    if (pick.kind === 'note') return (pick.diagram ? windows : cards).filter((thing) => Marks.picks(pick, thing)).length;
    if (pick.kind !== 'arrow') return things.filter((thing) => Marks.picks(pick, thing)).length;
    // An arrow is a thing only inside edgesOf(), which gives the slots of a rule to the arrows that it picks: a probe slot tells which.
    const probe = { marks, rules: [{ pick, probe: { on: true } }] };
    return diagrams.reduce((sum, { diagram, things: ofDiagram }) => sum + Marks.edgesOf(diagram, probe, ofDiagram).filter((edge: Thing) => edge.slots?.['probe.on']).length, 0);
  };
}

const joined = (items: string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** What a rule gives the things that it picks, in words, from the `gets` of its slots in LOOK_PARTS; a field with no words there is named. A slot that is one target gives "target". */
function gives(rule: Look['rules'][number]): string {
  const words = Object.entries(rule).filter(([slot]) => slot !== 'pick').flatMap(([slot, fields]) =>
    (LIST.slots[slot]?.target ? ['target'] : Object.keys(fields ?? {})).map((field) => LIST.slots[slot]?.gets?.[field] ?? `"${slot}.${field}"`));
  return joined(words) || 'nothing';
}

/** Why a pick takes nothing now: the first part of it that alone takes nothing. */
function whyNothing(pick: Pick, count: (pick: Pick) => number): string {
  const { kind, ...rest } = pick;
  if (!count({ kind })) return `the map has no ${kind} now`;
  for (const [key, value] of Object.entries(rest) as [string, unknown][]) {
    if (count({ kind, [key]: value } as Pick)) continue;
    const list = Array.isArray(value) ? value.join(', ') : String(value);
    if (key === 'mark') return `no ${kind} holds a mark "${list}"`;
    if (key === 'paths') return `no ${kind} lies inside ${list}`;
    if (key === 'diagram') return `the diagram "${list}" has no ${kind}`;
    if (key === 'nodes') return kind === 'arrow' ? `no arrow runs between the nodes ${list}` : `no ${kind} is one of the nodes ${list}`;
    return `no ${kind} fits its "${key}"`;
  }
  return `no ${kind} fits all of its pick at once`;
}

/** One line for each rule of a look that passed the check: how many things it picks now and what it gives them; and a note for each rule that picks nothing. */
export function lookChanges(store: Store, folder: string, look: Look): { changes: string[]; notes: string[] } {
  const count = counter(store, folder);
  const changes: string[] = [];
  const notes: string[] = [];
  look.rules.forEach((rule, index) => {
    // A part of the side bar or of a pull request is not in the map, so it is not counted (build 61).
    if (!MAP_KINDS.includes(rule.pick.kind)) return void changes.push(`Rule ${index + 1}: ${calledOf(rule.pick.kind)} that it picks gets ${gives(rule)}.`);
    const many = count(rule.pick);
    changes.push(`Rule ${index + 1}: ${many} ${rule.pick.kind}${many === 1 ? ' gets' : 's get'} ${gives(rule)}.`);
    if (!many) notes.push(`Rule ${index + 1} picks nothing now: ${whyNothing(rule.pick, count)}.`);
  });
  return { changes, notes };
}
