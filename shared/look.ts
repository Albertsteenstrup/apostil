// The look of a repo: rules that a user asks for in plain words and an agent saves with `apostil set-look` (store/marks-save.ts).
// A rule picks things and changes one or more slots of them; everything else keeps the default look. The page applies the rules when it draws (view/media/marks.js).
// LOOK_PARTS is the one list of what a look can change: the components, their slots with their fields, what a rule can pick, and every action.
// The check of set-look, the files of a look and `apostil look-slots` (shared/look-slots.ts) all read it; the prompt of the look writer holds no list.
// A new part is one entry here: its `area` (a new area also gets its index line in `areas`), its `what`, its `words` (other words that a person
// may use for it, for the search) and one `example`, a whole rule that passes the check. `core: true` marks what most looks use; all else is
// found through its area. A slot may also give `gets`: what each field gives a thing, in a few words, for the changes that set-look prints.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathProblem } from './checks';
import { diagramGraph } from './diagram-graph';
import { fileText, repoFiles } from './git';
import { CORNERS, FILE_USES, isId, isLine, isText, SERVICES, type Corner, type FileUse, type MarkSet } from './marks';
import { processDiagramId } from './process-diagrams';
import type { RepoMap } from './repo-map';

/** The shapes of Mermaid that a box can take. */
export const SHAPES = ['rect', 'rounded', 'stadium', 'subproc', 'cyl', 'circle', 'diam', 'hex', 'lean-r', 'lean-l', 'trap-b', 'trap-t', 'doc', 'docs', 'notch-rect', 'flag', 'tri', 'odd', 'dbl-circ'];
const MAX_WIDTH = 8;

/** The kinds of values that a field takes, in words: the check of a field and `apostil look-slots` both use them. */
const VALUES = {
  colour: 'one colour as "#rrggbb"; Apostil makes the colour of the dark theme and of the words itself',
  width: `a number of pixels from 0.5 to ${MAX_WIDTH}`,
  yes: 'true or false',
  shape: `one of ${SHAPES.join(', ')}`,
  text: 'words',
  picture: `a file of ${FILE_USES.picture.endings.join(', ')}, at most 2 MB`,
  film: 'an mp4 file with H.264 video, at most 20 MB; VS Code plays no other kind of film, and a film plays with no sound',
  button: '{ "icon": a file of an icon, "name": what it is in a few words, "action"?: one action }',
  corner: '{ "set": the id of a mark set } for its icons, a button { "icon", "name", "action"? }, or null for nothing',
} as const;
type ValueKind = keyof typeof VALUES;

/** A rule as an example in the list. It may hold the placeholders <folder>/, <file>, <diagram>, <node> and <set>:<value>. */
type Example = Readonly<Record<string, unknown>>;

/** The form of LOOK_PARTS, which the readers of the list (shared/look-slots.ts) read it by. */
export interface LookPartsList {
  areas: Readonly<Record<string, string>>; // each area with one index line: the words of what is inside, as a person says them
  components: Readonly<Record<string, { what: string; area: string; slots: readonly string[]; example: Example; words?: readonly string[]; core?: boolean }>>;
  picks: Readonly<Record<string, string>>;
  slots: Readonly<Record<string, {
    what: string; one?: boolean; fields: Readonly<Record<string, ValueKind>>; example: Example; area?: string; words?: readonly string[];
    core?: true | readonly string[]; // true: every field is in the core; a list: these fields
    gets?: Readonly<Record<string, string>>;
  }>>;
  values: Readonly<Record<string, string>>;
  actions: Readonly<Record<string, { what: string; form: string; area?: string; words?: readonly string[] }>>;
  sets: { what: string; form: string; area: string; words?: readonly string[] };
}

const BLUE = '#2b6cb0';
const AMBER = '#b45309';

/**
 * The one list of what a look can change. A component is a kind of thing that a rule picks, with its slots; a slot has fields, each of one kind of
 * value; `one` means that a rule gives exactly one field of the slot. An action is what a button does on a click. A set is a new kind of mark.
 */
export const LOOK_PARTS = {
  components: {
    node: {
      what: 'a node of a written diagram of the map', area: 'diagrams', core: true, slots: ['box', 'content', 'corners'], words: ['box', 'area', 'part', 'folder', 'module'],
      example: { pick: { kind: 'node', diagram: '<diagram>', nodes: ['<node>'] }, box: { color: BLUE, shape: 'cyl' } },
    },
    step: {
      what: 'a step, or a process, of a drawn process', area: 'processes', core: true, slots: ['box', 'content', 'corners'], words: ['process', 'flow', 'job', 'stage', 'task'],
      example: { pick: { kind: 'step', paths: ['<folder>/'] }, box: { line: AMBER, width: 2 } },
    },
    call: {
      what: 'a call out of the repo in a drawn process', area: 'processes', core: true, slots: ['box', 'content', 'corners'], words: ['service', 'outside', 'external', 'api', 'request'],
      example: { pick: { kind: 'call', mark: '<set>:<value>' }, box: { dashed: true } },
    },
    arrow: {
      what: 'an arrow of a diagram of the map or of a drawn process', area: 'diagrams', core: true, slots: ['arrow'], words: ['edge', 'link', 'line', 'connection', 'label'],
      example: { pick: { kind: 'arrow', paths: ['<folder>/'] }, arrow: { color: BLUE, width: 2 } },
    },
    note: {
      what: 'a note card in the file tab, and the window of a step', area: 'notes', core: true, slots: ['note', 'corners'], words: ['card', 'comment', 'annotation', 'explanation'],
      example: { pick: { kind: 'note', paths: ['<file>'] }, note: { color: AMBER } },
    },
  },
  picks: {
    kind: 'the component: always given',
    paths: 'folders (ending with "/") and files of the repo: things whose paths lie inside them; an arrow when both its ends do',
    diagram: 'the id of a diagram of the map, or "process:<id>" for a drawn process',
    nodes: 'ids of nodes of the written diagram that "diagram" names; an arrow when both its ends are among them',
    mark: '"<set>:<value>" or "<set>:*": things whose code holds such a mark',
  },
  slots: {
    box: {
      what: 'the box of a node', core: true, fields: { color: 'colour', line: 'colour', width: 'width', dashed: 'yes', shape: 'shape' },
      words: ['colour', 'fill', 'border', 'outline', 'frame', 'thick', 'dotted', 'cylinder', 'circle', 'round'],
      gets: { color: 'a colour', line: 'a line colour', width: 'a line width', dashed: 'a dashed or solid line', shape: 'a shape' },
      example: { pick: { kind: 'node', paths: ['<folder>/'] }, box: { color: BLUE, dashed: true } },
    },
    content: {
      what: 'what stands in place of the box: its words, a picture or a film; the place, the arrows, the window and the click stay', one: true, fields: { words: 'text', picture: 'picture', film: 'film' },
      words: ['text', 'label', 'name', 'rename', 'image', 'photo', 'screenshot', 'video', 'movie', 'gif'],
      gets: { words: 'other words', picture: 'a picture', film: 'a film' },
      example: { pick: { kind: 'node', diagram: '<diagram>', nodes: ['<node>'] }, content: { picture: '<file>' } },
    },
    corners: {
      what: 'the four corners of a node or a note; a set or a button in the upper right takes the place of the icons of the services', area: 'marks', core: true,
      fields: Object.fromEntries(CORNERS.map((corner) => [corner, 'corner'])), words: ['icon', 'badge', 'logo', 'button', 'corner', 'hide'],
      gets: Object.fromEntries(CORNERS.map((corner) => [corner, `a new ${corner} corner`])),
      example: { pick: { kind: 'note', paths: ['<file>'] }, corners: { 'upper-left': { set: 'services' }, 'lower-right': { icon: '<file>', name: 'Open the code', action: { file: '<file>', line: 1 } } } },
    },
    note: {
      what: 'the bar of a note', core: true, fields: { color: 'colour' }, words: ['bar', 'stripe', 'colour'], gets: { color: 'a colour of the bar' },
      example: { pick: { kind: 'note', mark: '<set>:<value>' }, note: { color: AMBER } },
    },
    arrow: {
      what: 'the line of an arrow, and a button at its label', core: ['color', 'width', 'dashed'], fields: { color: 'colour', width: 'width', dashed: 'yes', icon: 'button' },
      words: ['line', 'colour', 'thick', 'thin', 'dotted', 'label', 'button'],
      gets: { color: 'a colour', width: 'a width', dashed: 'a dashed or solid line', icon: 'a button' },
      example: { pick: { kind: 'arrow', diagram: '<diagram>' }, arrow: { color: BLUE, width: 2, dashed: true } },
    },
  },
  values: VALUES,
  actions: {
    file: { what: 'opens a file of the repo, at "line" when it is given', form: '{ "file": "<path>", "line"?: <number> }', area: 'marks', words: ['open', 'code', 'source', 'jump'] },
    url: { what: 'opens a web address that starts with https://, after VS Code asks', form: '{ "url": "https://…" }', area: 'marks', words: ['link', 'website', 'web', 'page', 'browser', 'docs'] },
    command: { what: 'runs a command of Apostil, and no other command', form: '{ "command": "<a command of Apostil>" }', area: 'marks', words: ['run', 'apostil'] },
    prompt: { what: 'sends the words to a new session of the agent of the repo, as a comment is sent, after VS Code asks', form: '{ "prompt": "<words>" }', area: 'marks', words: ['agent', 'ask', 'session', 'question'] },
    place: { what: 'opens a place in Apostil: a diagram of the map, at a node when it is given, or a drawn process', form: '{ "place": { "diagram": "<id>", "node"?: "<id>" } }', area: 'marks', words: ['go', 'navigate', 'diagram', 'show'] },
  },
  areas: {
    diagrams: 'the nodes and arrows of the diagrams of the map: other words, a picture or a film in place of a node, a button at the words of an arrow',
    processes: 'the steps of a drawn process and its calls out of the repo: the same box, words, picture and corners as a node',
    notes: 'the note cards in the file tab and the window of a step: the colour of the bar and the corners of a card',
    marks: 'a new kind of mark at lines of code, its values and their icons, the corner where a set stands, a button in a corner and what its click does',
  },
  sets: {
    what: 'a new kind of mark: writers mark the lines of code that its rule names, and the icons of its values stand in its corner',
    form: '{ "id": "<small letters and ->", "name": "<a short name>", "rule": "<one or two plain sentences that tell a writer which lines to mark, and which value each gets>", "values": [ { "id": "<id>", "name": "<name>", "icon": "<file of an icon>" } ], "corner": { "node": "<corner>", "note": "<corner>" } }',
    area: 'marks', words: ['mark', 'marks', 'kind', 'tag', 'label', 'category', 'icon'],
  },
} as const satisfies LookPartsList;

/** What a button can do on a click. Every reader goes through these two names, so that a new name of the list changes one line. */
export const ACTIONS_KEY = 'actions';
export const ACTIONS = LOOK_PARTS[ACTIONS_KEY];

export type LookKind = keyof typeof LOOK_PARTS.components;
export const LOOK_KINDS = Object.keys(LOOK_PARTS.components) as LookKind[];
type SlotName = keyof typeof LOOK_PARTS.slots;

/** Which things a rule picks: a kind, and any of paths (folders end with "/"), node ids of one diagram, a mark ("set:value" or "set:*") and a diagram id. */
export interface Pick {
  kind: LookKind;
  paths?: string[];
  nodes?: string[];
  mark?: string;
  diagram?: string;
}

/** What a button does on a click: one of the actions of LOOK_PARTS. */
export interface Action {
  file?: string;
  line?: number;
  url?: string;
  command?: string;
  prompt?: string;
  place?: { diagram: string; node?: string };
}

export interface Button {
  icon: string; // in a draft: a file in the repo folder; stored: the name of the kept file
  name: string; // what the pointer says
  action?: Action;
}

/** A corner of a node or a note: the marks of a set, one button, or nothing (null). */
export type CornerFill = { set: string } | Button | null;

export interface LookRule {
  pick: Pick;
  box?: { color?: string; line?: string; width?: number; dashed?: boolean; shape?: string };
  content?: { words?: string; picture?: string; film?: string };
  corners?: Partial<Record<Corner, CornerFill>>;
  note?: { color?: string };
  arrow?: { color?: string; width?: number; dashed?: boolean; icon?: Button };
}

export interface Look {
  sets?: MarkSet[];
  rules: LookRule[];
}

/** The default look, as rules: the icons of the services at the upper right of a node, a step, a call out of the repo and a note. It is always the first rule. */
export const DEFAULT_RULES: LookRule[] = (['node', 'step', 'call', 'note'] as const).map((kind) => ({ pick: { kind }, corners: { 'upper-right': { set: SERVICES.id } } }));

/** The slots that give one field only (the page takes them whole). */
export const ONE_FIELD_SLOTS = Object.entries(LOOK_PARTS.slots).filter(([, slot]) => 'one' in slot && slot.one).map(([name]) => name);

/** The commands of Apostil, which a button may run. */
export function apostilCommands(): string[] {
  const file = join(__dirname, '../../package.json');
  if (!existsSync(file)) return [];
  return (JSON.parse(readFileSync(file, 'utf8')).contributes?.commands ?? []).map((one: { command: string }) => one.command);
}

/** A file that a look names, with its use: each is checked and kept by set-look. `put` writes the kept name in its place. */
export interface LookFile {
  path: string;
  use: FileUse;
  at: string; // where the look names it, for a sentence
  put: (kept: string) => void;
  value?: { set: string; id: string }; // the icon of a value of a set
}

const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const isButton = (value: unknown): value is Button => isObject(value) && 'icon' in value;

/** Every file that a look names, found by the kinds of the fields of LOOK_PARTS: the icons of the values of its sets, pictures, films and the icons of buttons. */
export function lookFiles(look: Look): LookFile[] {
  const files: LookFile[] = [];
  const add = (holder: Record<string, any>, key: string, use: FileUse, at: string, value?: LookFile['value']): void => {
    if (isText(holder[key])) files.push({ path: holder[key], use, at, put: (kept) => { holder[key] = kept; }, ...(value ? { value } : {}) });
  };
  for (const set of look.sets ?? []) for (const value of set.values ?? []) add(value, 'icon', 'icon', `The value "${value.id}" of the set "${set.id}"`, { set: set.id, id: value.id });
  look.rules.forEach((rule, index) => {
    for (const [slot, about] of Object.entries(LOOK_PARTS.slots) as [SlotName, (typeof LOOK_PARTS.slots)[SlotName]][]) {
      const given = (rule as unknown as Record<string, unknown>)[slot];
      if (!isObject(given)) continue;
      for (const [field, kind] of Object.entries(about.fields) as [string, ValueKind][]) {
        if (kind === 'picture' || kind === 'film') add(given, field, kind, `Rule ${index + 1}`);
        if ((kind === 'button' || kind === 'corner') && isButton(given[field])) add(given[field], 'icon', 'icon', `Rule ${index + 1}, the button "${given[field].name}"`);
      }
    }
  });
  return files;
}

/** What a look needs to know of the repo to check a rule. */
export interface LookContext {
  folder: string;
  map?: RepoMap;
  commands: string[];
}

/** How many letters to add, remove or change to turn one word into the other. */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, at) => at);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/**
 * The known name that is nearest to a word, when one is close: one or two letters changed, or the same first three letters (small and capital
 * letters count the same). Of several close names, the one with the fewest letters changed, then the first. Undefined when none is close.
 */
export function nearest(word: string, known: readonly string[]): string | undefined {
  const low = word.toLowerCase();
  let best: { name: string; far: number } | undefined;
  for (const name of known) {
    const far = distance(low, name.toLowerCase());
    if (far > 2 && low.slice(0, 3) !== name.toLowerCase().slice(0, 3)) continue;
    if (!best || far < best.far) best = { name, far };
  }
  return best?.name;
}

/** ` The nearest is "<name>".` for a sentence about an unknown name, or nothing when no known name is close. */
export const nearestPart = (word: unknown, known: readonly string[]): string => {
  const near = typeof word === 'string' ? nearest(word, known) : undefined;
  return near ? ` The nearest is "${near}".` : '';
};

const an = (word: string): string => `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;
const listed = (names: readonly string[]): string => names.map((one) => `"${one}"`).join(', ');
const unknownFields = (value: object, known: readonly string[], at: string): string[] =>
  Object.keys(value).filter((key) => !known.includes(key)).map((key) => `${at}: "${key}" is no field here. Use only ${listed(known)}.${nearestPart(key, known)}`);

/**
 * What is wrong with a look, as sentences that a model can act on: known components and slots, each slot fits its component, known fields with
 * values of their kind, existing paths, node ids and diagram ids, known mark sets, known actions. The files are checked by set-look, which reads them.
 */
export function lookProblems(value: unknown, context: LookContext): string[] {
  if (!isObject(value)) return ['The look must be a JSON object: { "sets"?: [ ... ], "rules": [ ... ] }.'];
  const look = value as unknown as Look;
  const problems: string[] = [];
  for (const key of Object.keys(value)) if (key !== 'sets' && key !== 'rules') problems.push(`The look: "${key}" is no field of a look. Use "sets" and "rules".`);
  if (!Array.isArray(look.rules)) problems.push('"rules" must be a list of rules. Write an empty list for the default look.');
  if (look.sets !== undefined && !Array.isArray(look.sets)) problems.push('"sets" must be a list of mark sets.');
  const sets = new Set([SERVICES.id]);
  for (const [index, set] of (Array.isArray(look.sets) ? look.sets : []).entries()) {
    const at = `Set ${index + 1} ("${(set as MarkSet)?.id ?? '?'}")`;
    if (!isObject(set)) { problems.push(`${at}: a set is an object { "id", "name", "rule", "values", "corner" }.`); continue; }
    problems.push(...unknownFields(set, ['id', 'name', 'rule', 'values', 'corner'], at));
    if (!isId(set.id)) problems.push(`${at}: "id" must use small letters, digits and "-".`);
    else if (sets.has(set.id)) problems.push(`${at}: the id "${set.id}" is ${set.id === SERVICES.id ? 'the built-in set of services' : 'used twice'}. Give the set another id.`);
    sets.add(set.id);
    if (!isText(set.name)) problems.push(`${at}: "name" is missing: a short name for the set.`);
    if (!isText(set.rule)) problems.push(`${at}: "rule" is missing: one or two sentences that tell a writer which lines to mark.`);
    if (!isObject(set.corner) || !CORNERS.includes(set.corner.node as Corner) || !CORNERS.includes(set.corner.note as Corner)) {
      problems.push(`${at}: "corner" must be { "node": <corner>, "note": <corner> }, each one of ${CORNERS.join(', ')}.`);
    }
    if (set.values !== undefined && !Array.isArray(set.values)) problems.push(`${at}: "values" must be a list of { "id", "name", "icon"? }.`);
    const ids = new Set<string>();
    for (const one of Array.isArray(set.values) ? set.values : []) {
      if (!isObject(one) || !isId(one.id) || !isText(one.name)) { problems.push(`${at}: each value is { "id", "name", "icon"? }, the id in small letters, digits and "-".`); continue; }
      problems.push(...unknownFields(one, ['id', 'name', 'icon'], `${at}, value "${one.id}"`));
      if (ids.has(one.id)) problems.push(`${at}: the value "${one.id}" is listed twice.`);
      ids.add(one.id);
    }
  }
  (Array.isArray(look.rules) ? look.rules : []).forEach((rule, index) => problems.push(...ruleProblems(rule, `Rule ${index + 1}`, context, sets)));
  return problems;
}

/** The ids of the diagrams that a rule or a place may name: the written diagrams of the map and the drawn processes. */
function diagramIds(map?: RepoMap): Set<string> {
  return new Set([...(map?.diagrams ?? []).map((diagram) => diagram.id), ...(map?.processes ?? []).map((process) => processDiagramId(process.id))]);
}

/** The problems of node ids of a written diagram of the map; none when they are all its nodes. */
function nodeProblems(map: RepoMap | undefined, diagramId: string | undefined, nodes: string[], at: string, word: string): string[] {
  const diagram = map?.diagrams.find((one) => one.id === diagramId);
  if (!diagram) return [`${at}: ${word} needs "diagram": the id of the written diagram that has the node.`];
  const known = diagramGraph(diagram).nodes;
  return nodes.filter((node) => !(node in known)).map((node) => `${at}: the diagram "${diagram.id}" has no node "${node}". Its nodes are ${Object.keys(known).join(', ')}.${nearestPart(node, Object.keys(known))}`);
}

function ruleProblems(rule: unknown, at: string, context: LookContext, sets: Set<string>): string[] {
  if (!isObject(rule)) return [`${at}: a rule is an object { "pick": { ... }, and the slots that it changes }.`];
  const problems: string[] = [];
  const pick = rule.pick as Pick | undefined;
  if (!isObject(pick) || !LOOK_KINDS.includes(pick.kind as LookKind)) return [`${at}: "pick" must name a "kind": one of ${LOOK_KINDS.join(', ')}.${nearestPart(isObject(pick) ? pick.kind : undefined, LOOK_KINDS)}`];
  problems.push(...unknownFields(pick as unknown as Record<string, unknown>, Object.keys(LOOK_PARTS.picks), `${at}, "pick"`));
  const own: readonly string[] = LOOK_PARTS.components[pick.kind].slots;
  const slots = Object.keys(rule).filter((key) => key !== 'pick');
  for (const slot of slots) {
    if (!(slot in LOOK_PARTS.slots)) problems.push(`${at}: "${slot}" is no slot. The slots are ${listed(Object.keys(LOOK_PARTS.slots))}.${nearestPart(slot, Object.keys(LOOK_PARTS.slots))}`);
    else if (!own.includes(slot)) problems.push(`${at}: ${an(pick.kind)} has no slot "${slot}". Its slots are ${listed(own)}.${nearestPart(slot, own)}`);
    else problems.push(...slotProblems(slot as SlotName, rule[slot], at, context, sets));
  }
  if (!slots.length) problems.push(`${at}: it changes nothing. Name the slot that it changes, as "box": { "color": "#2b6cb0" }.`);
  // Which things.
  if (pick.paths !== undefined) {
    if (!Array.isArray(pick.paths) || !pick.paths.length || !pick.paths.every(isText)) problems.push(`${at}: "paths" must be a list of folders (ending with "/") and files of the repo.`);
    else for (const path of pick.paths) { const bad = pathProblem(context.folder, path); if (bad) problems.push(`${at}: ${bad}`); }
  }
  const diagrams = diagramIds(context.map);
  if (pick.diagram !== undefined && !diagrams.has(pick.diagram)) problems.push(`${at}: "${pick.diagram}" is no diagram of the map. apostil map lists the ids of the diagrams; a process is "process:<id>".${nearestPart(pick.diagram, [...diagrams])}`);
  if (pick.nodes !== undefined) {
    if (!Array.isArray(pick.nodes) || !pick.nodes.length || !pick.nodes.every(isText)) problems.push(`${at}: "nodes" must be a list of node ids.`);
    else problems.push(...nodeProblems(context.map, pick.diagram, pick.nodes, at, '"nodes"'));
  }
  if (pick.mark !== undefined) {
    const [set, markValue] = isText(pick.mark) ? pick.mark.split(':') : [];
    if (!set || !markValue) problems.push(`${at}: "mark" must be "<set>:<value>" or "<set>:*".`);
    else if (!sets.has(set)) problems.push(`${at}: "${set}" is no mark set. Use "${SERVICES.id}" or a set of "sets".${nearestPart(set, [...sets])}`);
  }
  return problems;
}

/** The problems of one slot of a rule: its fields, each with a value of its kind. */
function slotProblems(slot: SlotName, given: unknown, at: string, context: LookContext, sets: Set<string>): string[] {
  const about = LOOK_PARTS.slots[slot];
  const fields = Object.keys(about.fields);
  if (!isObject(given)) return [`${at}: "${slot}" must be an object with any of ${listed(fields)}.`];
  if ('one' in about && about.one && Object.keys(given).length !== 1) return [`${at}: "${slot}" must hold one of ${listed(fields)}.`];
  const problems = unknownFields(given, fields, `${at}, "${slot}"`);
  for (const [field, kind] of Object.entries(about.fields) as [string, ValueKind][]) {
    if (field in given) problems.push(...valueProblems(kind, given[field], `${at}, "${slot}"`, field, context, sets));
  }
  return problems;
}

/** The problem of one value of a field by its kind (VALUES). A file is checked by set-look, which reads it. */
function valueProblems(kind: ValueKind, value: unknown, at: string, field: string, context: LookContext, sets: Set<string>): string[] {
  const wrong = [`${at}: "${field}" must be ${VALUES[kind]}.`];
  switch (kind) {
    case 'colour': return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? [] : [`${at}: "${field}" must be one colour as "#rrggbb", for example "#2b6cb0". Apostil makes the colour of the dark theme itself.`];
    case 'width': return typeof value === 'number' && value > 0 && value <= MAX_WIDTH ? [] : wrong;
    case 'yes': return typeof value === 'boolean' ? [] : wrong;
    case 'shape': return SHAPES.includes(value as string) ? [] : [`${at}: "${String(value)}" is no shape. Use one of ${SHAPES.join(', ')}.${nearestPart(value, SHAPES)}`];
    case 'text': case 'picture': case 'film': return isText(value) ? [] : wrong;
    case 'button': return buttonProblems(value, `${at}, the button "${field}"`, context);
    case 'corner':
      if (value === null) return [];
      if (isObject(value) && 'set' in value) return Object.keys(value).length === 1 && sets.has(value.set) ? [] : [`${at}, the corner "${field}": { "set": <id> } must name a mark set: "${SERVICES.id}" or a set of "sets".${nearestPart(value.set, [...sets])}`];
      return buttonProblems(value, `${at}, the corner "${field}"`, context);
  }
}

/** What is wrong with a button: an icon (a file), a name, and at most one action of LOOK_PARTS. */
function buttonProblems(value: unknown, at: string, context: LookContext): string[] {
  if (!isObject(value)) return [`${at}: give a button ${VALUES.button}.`];
  const problems = unknownFields(value, ['icon', 'name', 'action'], at);
  if (!isText(value.icon)) problems.push(`${at}: "icon" must be a file of an icon in the repo folder.`);
  if (!isText(value.name)) problems.push(`${at}: "name" must say in a few words what the button is, for the pointer.`);
  const action = value.action as Action | undefined;
  if (action === undefined) return problems;
  const kinds = Object.keys(ACTIONS) as (keyof typeof ACTIONS)[];
  const forms = kinds.map((kind) => ACTIONS[kind].form).join(', ');
  if (!isObject(action)) return [...problems, `${at}: "action" must be one of ${forms}.`];
  problems.push(...unknownFields(action, [...kinds, 'line'], `${at}, "action"`));
  const given = kinds.filter((key) => action[key] !== undefined);
  if (given.length !== 1) return [...problems, `${at}: "action" must hold exactly one of ${listed(kinds)}: ${forms}.`];
  if (action.line !== undefined && given[0] !== 'file') problems.push(`${at}: "line" goes with "file".`);
  switch (given[0]) {
    case 'url':
      if (!(typeof action.url === 'string' && /^https:\/\/[^\s]+$/.test(action.url))) problems.push(`${at}: "url" must be a web address that starts with https://.`);
      break;
    case 'file': {
      const known = new Set(repoFiles(context.folder) ?? []);
      if (!isText(action.file) || !known.has(action.file)) problems.push(`${at}: the file ${String(action.file)} is no file of the repo. Give a path that Git lists.`);
      else if (action.line !== undefined) {
        const lines = (fileText(context.folder, action.file) ?? '').split('\n').length;
        if (!isLine(action.line) || action.line > lines) problems.push(`${at}: line ${String(action.line)} is not inside ${action.file}, which has ${lines} lines.`);
      }
      break;
    }
    case 'command':
      if (!context.commands.includes(action.command as string)) problems.push(`${at}: "${String(action.command)}" is no command of Apostil. Use one of ${context.commands.join(', ')}.${nearestPart(action.command, context.commands)}`);
      break;
    case 'prompt':
      if (!isText(action.prompt)) problems.push(`${at}: "prompt" must be the words for the agent.`);
      break;
    case 'place': {
      const place = action.place;
      const diagrams = diagramIds(context.map);
      if (!isObject(place) || !isText(place.diagram) || !diagrams.has(place.diagram)) problems.push(`${at}: "place" must name a diagram of the map by "diagram" (a process is "process:<id>"), and a "node" of it when you want one lit.${nearestPart(isObject(place) ? place.diagram : undefined, [...diagrams])}`);
      else if (place.node !== undefined) problems.push(...nodeProblems(context.map, place.diagram, [place.node], at, '"node"'));
      break;
    }
  }
  return problems;
}
