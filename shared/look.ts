// The look of a repo: rules that a user asks for in plain words and an agent saves with `apostil set-look` (store/marks-save.ts).
// A rule picks things and changes one or more slots of them; everything else keeps the default look. The page applies the rules when it draws (view/media/marks.js).
// LOOK_PARTS is the one list of what a look can change: the components, their slots with their fields, what a rule can pick, and every target of a click.
// The check of set-look, the files of a look and `apostil look-slots` (shared/look-slots.ts) all read it; the prompt of the look writer holds no list.
// A new part is one entry here: its `area` (a new area also gets its index line in `areas`), its `what`, its `words` (other words that a person
// may use for it, for the search) and one `example`, a whole rule that passes the check. `core: true` marks what most looks use; all else is
// found through its area. A slot may also give `gets`: what each field gives a thing, in a few words, for the changes that set-look prints.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathProblem } from './checks';
import { diagramGraph } from './diagram-graph';
import { fileText, repoFiles } from './git';
import { CORNERS, FILE_USES, isId, isLine, isText, SERVICES, type Corner, type FileUse, type MarkSet } from './marks';
import { processDiagramId } from './process-diagrams';
import { listedFiles, readRepoData, readRepoText, type ReadFault } from './repo-data';
import type { RepoMap } from './repo-map';

/** The shapes of Mermaid that a box can take. */
export const SHAPES = ['rect', 'rounded', 'stadium', 'subproc', 'cyl', 'circle', 'diam', 'hex', 'lean-r', 'lean-l', 'trap-b', 'trap-t', 'doc', 'docs', 'notch-rect', 'flag', 'tri', 'odd', 'dbl-circ'];
const MAX_WIDTH = 8;
const WINDOW_WIDTH = [240, 720]; // the narrowest and the widest window of the pointer
const SIZES = ['small', 'normal', 'large'];

/**
 * The keys that a page of Apostil uses already, so a look cannot take them: J and K (the next and the previous file), Alt with the arrows (the
 * changes, one step back), Escape, Enter, Tab and Space (the comment box and the lists), and Cmd+Shift+. and Cmd+Shift+, (a comment, the notes).
 */
export const PAGE_KEYS = ['j', 'k', 'Alt+ArrowDown', 'Alt+ArrowUp', 'Alt+ArrowLeft', 'Escape', 'Enter', 'Tab', 'Space', 'Cmd+Shift+.', 'Cmd+Shift+,'];
const FREE_KEYS = [...'0123456789abcdefghijklmnopqrstuvwxyz'].filter((key) => !PAGE_KEYS.includes(key));

/**
 * The commands of Apostil that a look may run: each opens or changes a view. The commands that set up agents, install the `apostil` command,
 * connect Claude Code, uninstall, or turn links off and on change the computer, and are not here. The extension runs only these.
 */
export const LOOK_COMMANDS = [
  'apostil.home', 'apostil.graphsOf', 'apostil.openChange', 'apostil.openBranchChange', 'apostil.openPullRequest', 'apostil.openNoteInTab',
  'apostil.toggleNotes', 'apostil.remark', 'apostil.sortAndFilter', 'apostil.refresh', 'apostil.chooseLook', 'apostil.reportIssue',
  'apostil.openLookPage',
];

/** The kinds of values that a field takes, in words: the check of a field and `apostil look-slots` both use them. */
const VALUES = {
  colour: 'one colour "#rrggbb"; Apostil makes the dark theme and the words',
  width: `pixels from 0.5 to ${MAX_WIDTH}`,
  yes: 'true or false',
  shape: `one of ${SHAPES.join(', ')}`,
  text: 'words',
  words: 'words; "{title}" puts in a field of the thing',
  fields: 'a list of the fields of the thing that show, in their order',
  picture: `a file of ${FILE_USES.picture.endings.join(', ')}, at most 2 MB`,
  film: 'an mp4 file with H.264 video, at most 20 MB; VS Code plays no other kind of film, and a film plays with no sound',
  icon: 'a file of an icon in the repo folder',
  size: `one of ${SIZES.join(', ')}`,
  button: '{ "icon": a file of an icon, "name": what it is in a few words, "action"?: one target }',
  corner: '{ "set": <id> } for the icons of a set, a button { "icon", "name", "action"? }, or null',
  target: 'one target of "targets"',
  keys: '{ "<a letter or a digit>": <target> }',
  menu: 'a list of { "name": what the entry says, "target": <target> }',
  field: 'one field of the thing',
  ids: 'a list of ids',
  pixels: `a number of pixels from ${WINDOW_WIDTH[0]} to ${WINDOW_WIDTH[1]}`,
  sections: 'a list of the ids of the sections of the window, in the order that they show, or { "title"?, "blocks" }: a section of its own',
} as const;
type ValueKind = keyof typeof VALUES;
/** The kind of a field that a rule reads of a thing: words, a count, true or false, the id of a part of the change of the branch, or one of a few fixed values. */
type FieldKind = 'text' | 'count' | 'yes' | 'part' | readonly string[];

/** The states of a thread of comments, as the comments window says them (view/media/states.js turns the state of a remark into one). */
export const THREAD_STATES = ['open', 'sent', 'working', 'answered', 'resolved'] as const;

/** A rule as an example in the list. It may hold the placeholders <folder>/, <file>, <diagram>, <node> and <set>:<value>. */
type Example = Readonly<Record<string, unknown>>;

/** The name of the list of the targets of a click. Every reader goes through it and TARGETS, so that a new name of the list changes one line. */
export const TARGETS_KEY = 'targets';

/** The form of LOOK_PARTS, which the readers of the list (shared/look-slots.ts) read it by. */
export interface LookPartsList {
  areas: Readonly<Record<string, string>>; // each area with one index line: the words of what is inside, as a person says them
  components: Readonly<Record<string, {
    what: string; area: string; slots: readonly string[]; example: Example; words?: readonly string[]; core?: boolean;
    takes?: Readonly<Record<string, readonly string[]>>; // the fields of a slot that the component takes, when it takes fewer than the slot has
    fields: Readonly<Record<string, FieldKind>>; // what a rule can read of a thing: the pick "where", words in braces, an order
    sections?: readonly string[]; // the sections of its window of the pointer
    shows?: readonly string[]; // the fields that "content.fields" can show, when they are not its fields
    why?: string; // a part of VS Code: why it takes only its own slots, for the sentence of a slot that it does not take
    targets?: readonly string[]; // the only targets that its click takes, when it takes fewer than all
    targetsWhy?: string; // the sentence of another target; <targets> stands for those it takes
    also?: string; // another area that names it: the margin stands in the file tab and in VS Code's editor
    name?: string; // one thing of it in the words of a sentence of the check, when its kind is not plain words ("file of the list")
  }>>;
  picks: Readonly<Record<string, string | { what: string; area?: string; words?: readonly string[]; example?: Example }>>;
  slots: Readonly<Record<string, {
    what: string; one?: boolean; target?: boolean; fields: Readonly<Record<string, ValueKind>>; example?: Example; area?: string; words?: readonly string[];
    core?: true | readonly string[]; // true: every field is in the core; a list: these fields
    gets?: Readonly<Record<string, string>>; // a slot that is one target gives its words as "target"
  }>>;
  values: Readonly<Record<string, string>>;
  [TARGETS_KEY]: Readonly<Record<string, { what: string; form: string; asks?: boolean; core?: boolean; area?: string; words?: readonly string[]; example?: Example }>>;
  sets: { what: string; form: string; area: string; words?: readonly string[] };
  // Build 58: what a page or a section of a window shows. Each block has its form, and `file` when its data may come from a file of the repo.
  blocks: Readonly<Record<string, { what: string; form: string; file?: string; area: string; words?: readonly string[]; example: Example }>>;
  blockTitle: string;
  sources: Readonly<Record<string, string>>; // where the data of a block comes from
  limits: Readonly<Record<string, number>>;
  pages: { what: string; form: string; area: string; words?: readonly string[]; example: Example };
  actions: { what: string; form: string; area: string; most: number; name: number; words?: readonly string[] };
  // What no look can use, each with the words that a person may use for it: `name` for "A look cannot use <name>.", `cannot` for the check.
  never: Readonly<Record<string, { name: string; cannot: string; words: readonly string[] }>>;
}

const BLUE = '#2b6cb0';
const AMBER = '#b45309';
const ONE_NODE = { kind: 'node', diagram: '<diagram>', nodes: ['<node>'] } as const;

/**
 * The one list of what a look can change. A component is a kind of thing that a rule picks, with its slots; `takes` names the fields of a slot that the
 * component takes, when it takes fewer than the slot has; `fields` is what a rule can read of a thing; `sections` are the sections of its window of the
 * pointer. A slot has fields, each of one kind of value; `one` means that a rule gives exactly one field of the slot; `target` means that the slot is one
 * target. A target is where a click, a key or a menu entry goes; `asks` means VS Code asks first. A set is a new kind of mark.
 */
export const LOOK_PARTS = {
  components: {
    node: {
      what: 'a node of a diagram of the map', area: 'diagrams', core: true, slots: ['box', 'content', 'corners', 'show', 'text', 'click', 'input', 'window'], words: ['box', 'area', 'part', 'folder', 'module'],
      takes: { content: ['words', 'picture', 'film'], show: ['shown'], text: ['size', 'icon'] },
      fields: { title: 'text', files: 'count', down: 'yes' }, sections: ['files', 'changes', 'marks'],
      example: { pick: ONE_NODE, box: { color: BLUE, shape: 'cyl' } },
    },
    step: {
      what: 'a step or process of a drawn process', area: 'processes', core: true, slots: ['box', 'content', 'corners', 'show', 'text', 'click', 'input', 'window'], words: ['process', 'flow', 'job', 'stage', 'task'],
      takes: { content: ['words', 'picture', 'film'], show: ['shown'], text: ['size', 'icon'] },
      fields: { title: 'text', file: 'text', steps: 'count', is: ['step', 'process'] }, sections: ['note', 'where', 'marks'],
      example: { pick: { kind: 'step', paths: ['<folder>/'] }, box: { line: AMBER, width: 2 } },
    },
    call: {
      what: 'a call out of the repo', area: 'processes', core: true, slots: ['box', 'content', 'corners', 'show', 'text', 'click', 'input', 'window'], words: ['service', 'outside', 'external', 'api', 'request'],
      takes: { content: ['words', 'picture', 'film'], show: ['shown'], text: ['size', 'icon'] },
      fields: { name: 'text', of: 'text' }, sections: ['note', 'where', 'marks'],
      example: { pick: { kind: 'call', mark: '<set>:<value>' }, box: { dashed: true } },
    },
    arrow: {
      what: 'an arrow of a diagram', area: 'diagrams', core: true, slots: ['arrow', 'content', 'show', 'text', 'click', 'input'], words: ['edge', 'link', 'line', 'connection', 'label'],
      takes: { content: ['words'], show: ['shown'], text: ['color', 'size'] },
      fields: { words: 'text', of: 'text' },
      example: { pick: { kind: 'arrow', paths: ['<folder>/'] }, arrow: { color: BLUE, width: 2 } },
    },
    note: {
      what: 'a note card in the file tab', area: 'notes', core: true,
      slots: ['note', 'corners', 'content', 'show', 'click', 'input', 'text', 'window', 'order'], words: ['card', 'comment', 'annotation', 'explanation'],
      takes: { content: ['fields'], show: ['shown'], text: ['icon'], order: ['by', 'down', 'first'] },
      fields: { title: 'text', file: 'text', function: 'text', tests: 'count', check: 'yes' }, shows: ['title', 'function', 'tests', 'text', 'services'], sections: ['check'],
      example: { pick: { kind: 'note', paths: ['<file>'] }, note: { color: AMBER } },
    },
    // ----- the page of a change (build 60) -----
    'change-card': {
      what: 'the card of the change: its title, files and counts, whether its links were checked, the wider diagrams', area: 'change', name: 'card of the change',
      slots: ['box', 'content'], takes: { box: ['color'], content: ['fields'] }, words: ['summary', 'header', 'total', 'size'],
      fields: { title: 'text', files: 'count', added: 'count', removed: 'count', checked: 'yes', wider: 'count' },
      example: { pick: { kind: 'change-card' }, content: { fields: ['title', 'files', 'wider'] } },
    },
    part: {
      what: 'a part: a box with its name and files in the diagram of the change', area: 'change',
      slots: ['box', 'text', 'content', 'click', 'window'], takes: { box: ['color', 'shape'], text: ['icon'], content: ['fields'] }, words: ['component', 'module', 'group'],
      fields: { id: 'part', name: 'text', files: 'count', added: 'count', removed: 'count' }, shows: ['name', 'files', 'counts'], sections: ['diagram', 'files'],
      example: { pick: { kind: 'part', paths: ['<folder>/'] }, box: { color: BLUE } },
    },
    'no-part': {
      what: 'the box of the files in no part; "folded" shows its title only', area: 'change', name: 'box of the files in no part',
      slots: ['box', 'show'], takes: { box: ['color', 'line'] }, words: ['unassigned', 'rest', 'loose', 'other'], fields: { files: 'count' },
      example: { pick: { kind: 'no-part' }, show: { folded: true } },
    },
    'part-link': {
      what: 'an arrow between two parts', area: 'change', name: 'link between parts',
      slots: ['arrow', 'content'], takes: { arrow: ['color', 'width', 'dashed'], content: ['words'] }, words: ['link', 'edge', 'dependency', 'connection'],
      fields: { words: 'text', added: 'count', removed: 'count' },
      example: { pick: { kind: 'part-link' }, arrow: { dashed: true }, content: { words: '{words} (+{added})' } },
    },
    'comment-mark': {
      what: 'the small circle with the count of open comments on a thing; the comments window still counts them', area: 'comments', name: 'comment mark',
      slots: ['text', 'show'], takes: { text: ['color', 'icon'], show: ['shown'] }, words: ['bubble', 'circle', 'count'], fields: { count: 'count' },
      example: { pick: { kind: 'comment-mark' }, text: { color: AMBER } },
    },
    'diff-file': {
      what: 'a file in the list of diffs, under the name of its part; a rule that leaves out all files of a part leaves out the part', area: 'diffs', name: 'file of the list',
      slots: ['order', 'show', 'content', 'text', 'click', 'window'], takes: { show: ['shown'], content: ['fields'], text: ['icon'] }, words: ['diff', 'diffs', 'changed', 'sort'],
      fields: { path: 'text', part: 'part', type: ['code', 'data', 'generated'], added: 'count', removed: 'count' }, shows: ['path', 'added', 'removed', 'type'], sections: ['facts', 'diff'],
      example: { pick: { kind: 'diff-file' }, order: { by: 'added', down: true } },
    },
    'comments-window': {
      what: 'the window of the comments and the open points; "folded" folds it at the start', area: 'comments', name: 'comments window',
      slots: ['window', 'box', 'show'], takes: { window: ['width'], box: ['color'], show: ['folded'] }, words: ['sidebar', 'panel', 'review'], fields: {},
      example: { pick: { kind: 'comments-window' }, window: { width: 380 } },
    },
    thread: {
      what: 'a card of a thread of comments in the comments window', area: 'comments',
      slots: ['content', 'box', 'order'], takes: { content: ['fields'], box: ['color'], order: ['by', 'down'] }, words: ['conversation', 'discussion', 'reply', 'answer'],
      fields: { state: THREAD_STATES, where: 'text', author: 'text' }, shows: ['where', 'messages', 'state', 'reply'],
      example: { pick: { kind: 'thread', where: { state: 'answered' } }, box: { color: '#15803d' } },
    },
    'open-point': {
      what: 'a finding of the fresh check: its card in the comments window and its "?" on the thing', area: 'comments', name: 'open point',
      slots: ['text', 'order', 'show'], takes: { text: ['color', 'icon'], order: ['by', 'down', 'group'], show: ['shown'] }, words: ['finding', 'question', 'problem', 'issue'],
      fields: { type: ['note', 'no-note', 'thing'], file: 'text', part: 'part', diagram: 'text' },
      example: { pick: { kind: 'open-point' }, order: { group: 'file' } },
    },
    'change-view': {
      what: 'a view of the switch of the change page; "order.first" opens that view first', area: 'diffs', name: 'view',
      slots: ['show', 'order'], takes: { show: ['shown'], order: ['first'] }, words: ['switch', 'start', 'conversation', 'opens'], fields: { id: ['diagram', 'diffs', 'conversation'] },
      example: { pick: { kind: 'change-view' }, order: { first: ['diffs'] } },
    },
    'part-diagram': {
      what: 'a diagram of a part, by its name in the switch over its drawing', area: 'diffs', name: 'diagram of a part',
      slots: ['order', 'show', 'content'], takes: { order: ['first'], show: ['shown'], content: ['words'] }, words: ['flow', 'sequence', 'schema', 'state'],
      fields: { id: 'text', type: ['flow', 'sequence', 'schema', 'state'], function: 'text', title: 'text' },
      example: { pick: { kind: 'part-diagram', where: { type: 'flow' } }, content: { words: '{function}' } },
    },
    'part-step': {
      what: 'a step, state or table of the drawing of a part, with its counts; a picture can take its place', area: 'change', name: 'step of a part',
      slots: ['box', 'content'], takes: { box: ['color'], content: ['picture'] }, words: ['step', 'node', 'state', 'table'], fields: { title: 'text', added: 'count', removed: 'count' },
      example: { pick: { kind: 'part-step', paths: ['<file>'] }, box: { color: BLUE } },
    },
    // ----- the file tab (build 60) -----
    'function-line': {
      what: 'the first line of a function over its first note card: its name and its count of tests', area: 'file-tab', name: 'first line of a function',
      slots: ['content', 'show'], takes: { content: ['words'], show: ['shown'] }, words: ['function', 'tests', 'heading'], fields: { function: 'text', tests: 'count' },
      example: { pick: { kind: 'function-line' }, content: { words: '{function} ({tests} tests)' } },
    },
    'note-line': {
      what: 'the line from a note card to its code', area: 'file-tab', name: 'line to the code', slots: ['arrow'], takes: { arrow: ['color', 'width', 'dashed'] },
      words: ['join', 'connector', 'line'], fields: {}, example: { pick: { kind: 'note-line' }, arrow: { dashed: true } },
    },
    'note-order': {
      what: 'the arrow from one step of a function to the next, between their note cards', area: 'file-tab', name: 'order of the notes',
      slots: ['arrow', 'show'], takes: { arrow: ['color', 'dashed'], show: ['shown'] }, words: ['steps', 'sequence', 'arrow'], fields: {},
      example: { pick: { kind: 'note-order' }, arrow: { color: BLUE } },
    },
    'notes-column': {
      what: 'the column of the note cards beside the code; "folded" shows the notes as marks at the edge', area: 'file-tab', name: 'notes column',
      slots: ['window', 'show'], takes: { window: ['width'], show: ['folded'] }, words: ['column', 'notes', 'width'], fields: {},
      example: { pick: { kind: 'notes-column' }, window: { width: 420 } },
    },
    'code-map': {
      what: 'the small map of the whole file at the right of the code; "box.color" tints the lines that a pick of "mark" or "paths" takes', area: 'file-tab', name: 'code map',
      slots: ['show', 'box'], takes: { show: ['shown'], box: ['color'] }, words: ['minimap', 'overview', 'scroll'], fields: {},
      example: { pick: { kind: 'code-map', mark: '<set>:<value>' }, box: { color: AMBER } },
    },
    margin: {
      what: 'the margin of the code, in the file tab of Apostil and in the editor and the diff editor of VS Code: the icon of a mark at each line that has one',
      area: 'file-tab', also: 'vscode', slots: ['show'], takes: { show: ['shown'] }, words: ['gutter', 'line numbers', 'icon', 'glyph', 'editor', 'diff'], fields: {},
      why: 'VS Code draws the margin, and a look can only say which marks stand there.',
      example: { pick: { kind: 'margin', mark: '<set>:<value>' }, show: { shown: true } },
    },
    // The parts of VS Code's own editor and frame (build 62). Each is off until a rule turns it on.
    'symbol-search': {
      what: 'the search with # of VS Code (Go to Symbol in Workspace): notes, steps and processes by their titles', area: 'vscode', slots: ['show'], takes: { show: ['shown'] },
      fields: { of: ['note', 'step', 'process'] }, words: ['search', 'symbol', 'find', 'quick open', 'go to', 'workspace'],
      why: 'VS Code draws the search, and a look can only say what it finds.',
      example: { pick: { kind: 'symbol-search', where: { of: ['note', 'process'] } }, show: { shown: true } },
    },
    'menu-entry': {
      what: 'an entry of a right-click menu of VS Code: the note on Home, its process, the places of its mark, the actions',
      area: 'vscode', slots: ['show'], takes: { show: ['shown'] }, fields: { entry: ['note', 'process', 'mark', 'actions'], in: ['editor', 'file-tab', 'explorer'] },
      words: ['right click', 'context menu', 'menu', 'entry'], why: 'VS Code draws its menus with fixed words, and a look can only say which entries stand there.',
      example: { pick: { kind: 'menu-entry', where: { entry: ['mark', 'actions'] } }, show: { shown: true } },
    },
    key: {
      what: 'a key of VS Code for a right-click entry, or for one of the actions action-1 to action-9', area: 'vscode', slots: ['show'], takes: { show: ['shown'] },
      fields: { entry: ['note', 'process', 'mark', 'actions', ...Array.from({ length: 9 }, (_, at) => `action-${at + 1}`)] },
      words: ['shortcut', 'keyboard', 'hotkey', 'key'], why: 'VS Code gives each key fixed words, and a look can only say which keys work.',
      example: { pick: { kind: 'key', where: { entry: ['actions', 'action-1'] } }, show: { shown: true } },
    },
    'first-page': {
      what: 'the view of Apostil that opens by itself when a window starts on the repo, and in an empty editor area', area: 'vscode', slots: ['click'], fields: {},
      targets: ['place', 'graphs', 'page'], words: ['start', 'startup', 'welcome', 'landing', 'open first'],
      targetsWhy: 'the first page must open a view of Apostil: use <targets>. A file, a web address, a command and a prompt cannot be the first page.',
      why: 'VS Code opens it, and a look can only say which view of Apostil it is.',
      example: { pick: { kind: 'first-page' }, click: { place: { diagram: '<diagram>' } } },
    },
    'look-list': {
      what: 'the list "Look" in the side bar of Apostil: each mark set with its values and their places, and the pages of the look', area: 'vscode', slots: ['show'], takes: { show: ['shown'] },
      fields: { group: ['marks', 'pages'] }, words: ['side bar', 'sidebar', 'tree', 'list', 'view', 'panel'],
      why: 'VS Code draws the list, and a look can only say which groups stand there.',
      example: { pick: { kind: 'look-list', where: { group: 'marks' } }, show: { shown: true } },
    },
  },
  picks: {
    kind: 'the component, always given',
    paths: 'folders (ending with "/") and files: things inside; an arrow when both ends are',
    diagram: 'the id of a diagram of the map; a drawn process is "process:<id>"',
    nodes: 'node ids of the written diagram "diagram"; an arrow when both ends are',
    mark: '"<set>:<value>" or "<set>:*": things whose code holds it',
    where: {
      what: '{ "<field>": <value or [values]> }: by a field of the thing (area lists)', area: 'lists',
      words: ['only', 'whose', 'filter', 'condition', 'leaf', 'count'], example: { pick: { kind: 'node', where: { down: false } }, text: { size: 'small' } },
    },
  },
  slots: {
    box: {
      what: 'the box of a node', core: true, fields: { color: 'colour', line: 'colour', width: 'width', dashed: 'yes', shape: 'shape' },
      words: ['colour', 'fill', 'border', 'outline', 'frame', 'thick', 'dotted', 'cylinder', 'circle', 'round'],
      gets: { color: 'a colour', line: 'a line colour', width: 'a line width', dashed: 'a dashed or solid line', shape: 'a shape' },
      example: { pick: { kind: 'node', paths: ['<folder>/'] }, box: { color: BLUE, dashed: true } },
    },
    content: {
      what: 'words, the fields that show, or a picture or film in its place', one: true, core: ['words'],
      fields: { words: 'words', fields: 'fields', picture: 'picture', film: 'film' },
      words: ['text', 'label', 'name', 'rename', 'template', 'image', 'photo', 'screenshot', 'video', 'movie', 'gif'],
      gets: { words: 'other words', fields: 'other fields', picture: 'a picture', film: 'a film' },
      example: { pick: ONE_NODE, content: { picture: '<file>' } },
    },
    corners: {
      what: 'the corners of a node or note; the upper right one takes the place of the service icons', area: 'marks', core: true,
      fields: Object.fromEntries(CORNERS.map((corner) => [corner, 'corner'])), words: ['icon', 'badge', 'logo', 'button', 'corner', 'hide'],
      gets: Object.fromEntries(CORNERS.map((corner) => [corner, `a new ${corner} corner`])),
      example: { pick: { kind: 'note', paths: ['<file>'] }, corners: { 'upper-left': { set: 'services' }, 'lower-right': { icon: '<file>', name: 'Open the code', action: { file: '<file>', line: 1 } } } },
    },
    note: {
      what: 'the bar of a note', core: true, fields: { color: 'colour' }, words: ['bar', 'stripe', 'colour'], gets: { color: 'a colour of the bar' },
      example: { pick: { kind: 'note', mark: '<set>:<value>' }, note: { color: AMBER } },
    },
    arrow: {
      what: 'the line of an arrow, and a button at its words', core: ['color', 'width', 'dashed'], fields: { color: 'colour', width: 'width', dashed: 'yes', icon: 'button' },
      words: ['line', 'colour', 'thick', 'thin', 'dotted', 'label', 'button'],
      gets: { color: 'a colour', width: 'a width', dashed: 'a dashed or solid line', icon: 'a button' },
      example: { pick: { kind: 'arrow', diagram: '<diagram>' }, arrow: { color: BLUE, width: 2, dashed: true } },
    },
    show: {
      what: '"shown": false leaves it out with its arrows', area: 'lists', core: ['shown'], fields: { shown: 'yes', folded: 'yes' },
      words: ['hide', 'remove', 'leave out', 'fold', 'collapse', 'visible'], gets: { shown: 'shown or hidden', folded: 'folded or open' },
      example: { pick: ONE_NODE, show: { shown: false } },
    },
    order: {
      what: 'the order of the rows of a list: "by" a field, "down" for the largest first, "group" by a field, and the ids that come "first"', area: 'lists',
      fields: { by: 'field', down: 'yes', group: 'field', first: 'ids' }, words: ['sort', 'order', 'group', 'pin', 'first', 'top'],
      gets: { by: 'an order', down: 'an order', group: 'groups', first: 'rows that come first' },
    },
    text: {
      what: 'the words of a thing: their colour, their size, and an icon before them', area: 'diagrams', fields: { color: 'colour', size: 'size', icon: 'icon' },
      words: ['font', 'bigger', 'smaller', 'words', 'label', 'icon'], gets: { color: 'a colour of the words', size: 'a size of the words', icon: 'an icon before the words' },
      example: { pick: ONE_NODE, text: { size: 'large' } },
    },
    click: {
      what: 'a target in place of its click', area: 'clicks', core: true, target: true, fields: {},
      words: ['click', 'link', 'open', 'go to', 'jump'], gets: { target: 'a click of its own' }, example: { pick: ONE_NODE, click: { graphs: '<file>' } },
    },
    input: {
      what: 'more input, each to a target: a click with Alt or Shift held, a double click, a key while the pointer is on it or it has the keyboard, and the entries of a menu of a right click',
      area: 'clicks', fields: { alt: 'target', shift: 'target', double: 'target', key: 'keys', menu: 'menu' },
      words: ['double click', 'right click', 'context menu', 'shortcut', 'key', 'alt', 'shift'],
      gets: { alt: 'an Alt+click', shift: 'a Shift+click', double: 'a double click', key: 'keys', menu: 'a right-click menu' },
      example: { pick: ONE_NODE, input: { alt: { file: '<file>' }, menu: [{ name: 'Show the folder in Files', target: { folder: '<folder>/' } }] } },
    },
    window: {
      what: 'the window of the pointer on the thing: its width, and which of its sections show, in their order; a section that "sections" does not name is not shown',
      area: 'windows', fields: { width: 'pixels', sections: 'sections' },
      words: ['pop-up', 'popup', 'hover', 'tooltip', 'window', 'sections', 'wider'], gets: { width: 'a window width', sections: 'window sections' },
      example: { pick: ONE_NODE, window: { width: 440, sections: ['changes', 'files'] } },
    },
  },
  values: VALUES,
  targets: {
    file: { what: 'opens a file of the repo, at "line" when it is given', form: '{ "file": "<path>", "line"?: <number> }', core: true, area: 'clicks', words: ['open', 'code', 'source', 'jump'] },
    url: { what: 'opens a web address that starts with https://, after VS Code asks', form: '{ "url": "https://…" }', asks: true, core: true, area: 'clicks', words: ['link', 'website', 'web', 'page', 'browser', 'docs'] },
    command: { what: 'runs a command of Apostil that opens or changes a view, and no other command', form: '{ "command": "<a command of Apostil>" }', core: true, area: 'clicks', words: ['run', 'apostil'] },
    prompt: { what: 'sends the words to a new session of the agent of the repo, as a comment is sent, after VS Code asks with the whole words', form: '{ "prompt": "<words>" }', asks: true, core: true, area: 'clicks', words: ['agent', 'ask', 'session', 'question'] },
    place: { what: 'opens a place in Apostil: a diagram of the map, at a node when it is given, or a drawn process', form: '{ "place": { "diagram": "<id>", "node"?: "<id>" } }', core: true, area: 'clicks', words: ['go', 'navigate', 'diagram', 'show'] },
    graphs: {
      what: 'opens the graphs page of a folder or a file', form: '{ "graphs": "<folder/ or file>" }',
      area: 'clicks', words: ['graphs', 'diagrams of a file', 'where it is used'], example: { pick: ONE_NODE, click: { graphs: '<file>' } },
    },
    folder: {
      what: 'shows a folder in the tree "Files" of the side bar', form: '{ "folder": "<folder>/" }',
      area: 'clicks', words: ['folder', 'tree', 'explorer', 'reveal'], example: { pick: ONE_NODE, click: { folder: '<folder>/' } },
    },
    change: {
      what: 'opens the page of the change of a branch, at a part when it is given; with no such change, one quiet line says so', form: '{ "change": "<branch>", "part"?: "<part id>" }',
      area: 'clicks', words: ['change', 'branch', 'part', 'review'], example: { pick: ONE_NODE, click: { change: 'main' } },
    },
    pull: {
      what: 'opens the page of a pull request of the repo, as "Apostil: Open pull request…" does', form: '{ "pull": <number> }',
      area: 'clicks', words: ['pull request', 'PR', 'GitHub'], example: { pick: ONE_NODE, click: { pull: 12 } },
    },
    comment: {
      what: 'opens the comment box of Apostil on the thing', form: '{ "comment": true }',
      area: 'clicks', words: ['comment', 'remark', 'note', 'ask'], example: { pick: ONE_NODE, input: { double: { comment: true } } },
    },
    window: {
      what: 'opens a window of blocks beside the thing; Escape closes it', form: '{ "window": { "title"?: "<words>", "width"?: <pixels>, "blocks": [<block>] } }',
      area: 'windows', words: ['popup', 'pop-up', 'panel', 'details', 'card', 'blocks'], example: { pick: ONE_NODE, click: { window: { title: 'In short', blocks: [{ text: 'What it does.' }] } } },
    },
    page: {
      what: 'opens a page of the look as a tab', form: '{ "page": "<id of a page of the look>" }',
      area: 'pages', words: ['page', 'report', 'dashboard'], example: { pick: ONE_NODE, click: { page: '<page>' } },
    },
  },
  areas: {
    diagrams: 'nodes and arrows of the map: words and their size, a picture or film, a button on an arrow',
    processes: 'steps and calls out of the repo of a drawn process: as a node',
    notes: 'note cards and the window of a step: the bar colour, the corners',
    marks: 'a new kind of mark at lines of code, its values and icons, its corner, a button in a corner',
    clicks: 'where a click, Alt+click, Shift+click, double click, key or right-click menu goes; every target',
    windows: 'the window of the pointer: width, sections, their order, sections of blocks; a window as a target',
    lists: 'what is left out, a pick by a field, the order and groups of rows',
    blocks: 'text, fields, table, bars, code, state, links, button, picture, diagram, row; data from a repo file',
    pages: 'a page of the look that opens as a tab: its blocks, and the target that opens it',
    change: 'the change page: its card, its parts and the links between them, the drawing of a part',
    diffs: 'the change page: the list of diffs, the views of its switch, the names of the diagrams of a part',
    comments: 'the comments window of a page: its threads, the open points, the comment marks',
    'file-tab': 'the file tab: the first line of a function, the lines to the code, notes column, code map, margin',
    vscode: 'VS Code, off until shown: margin, # search, menus, keys, first page, side list',
  },
  sets: {
    what: 'a new kind of mark: writers mark the lines of code that its rule names, and the icons of its values stand in its corner',
    form: '{ "id": "<small letters and ->", "name": "<a short name>", "rule": "<one or two plain sentences that tell a writer which lines to mark, and which value each gets>", "values": [ { "id": "<id>", "name": "<name>", "icon": "<file of an icon>" } ], "corner": { "node": "<corner>", "note": "<corner>" } }',
    area: 'marks', words: ['mark', 'marks', 'tag', 'category', 'icon'],
  },
  blocks: {
    text: { what: 'words; an empty line starts a new paragraph; no HTML', form: '{ "text": "<words>" }', area: 'blocks', words: ['words', 'paragraph', 'description', 'summary'], example: { text: 'What this part does, in two plain sentences.' } },
    fields: {
      what: 'names with their values', form: '{ "fields": [ ["<name>", "<value>"] ] }', file: '{ "file": "<a JSON object>", "keys": [<keys>] }',
      area: 'blocks', words: ['facts', 'properties', 'key value', 'details'], example: { fields: [['Runs', 'each night'], ['Owner', 'the desk team']] },
    },
    table: {
      what: 'a small table', form: '{ "table": { "columns": [<names>], "rows": [ [<values>] ] } }', file: '{ "file", "columns": [<columns>], "rows"?: <the most rows> }',
      area: 'blocks', words: ['grid', 'rows', 'columns', 'csv', 'spreadsheet'], example: { title: 'Branches', table: { columns: ['Branch', 'Opens'], rows: [['North', '09:00']] } },
    },
    bars: {
      what: 'one bar for each row, with its number', form: '{ "bars": [ ["<name>", <number>] ] }', file: '{ "file", "label": "<column>", "value": "<column of numbers>", "rows"? }',
      area: 'blocks', words: ['chart', 'graph', 'bar chart', 'numbers', 'counts'], example: { bars: [['North', 9], ['Harbour', 8]] },
    },
    code: {
      what: 'lines of code, never cut off; from a file, its name opens those lines', form: '{ "code": "<text>" }', file: '{ "file", "lines": [<from>, <to>] }, or { "file", "key" }: a value of a JSON file',
      area: 'blocks', words: ['snippet', 'source', 'json', 'excerpt'], example: { code: 'def main():\n    run()' },
    },
    state: {
      what: 'a dot, a word, and quiet words after it', form: '{ "state": { "word": "<word>", "color"?: "#rrggbb", "text"?: "<words>" } }', file: '{ "file", "key" }: the word is its value',
      area: 'blocks', words: ['status', 'badge', 'health', 'passed', 'failed'], example: { state: { word: 'ready', color: '#2b6cb0', text: 'since the last run' } },
    },
    links: { what: 'links, each to a target', form: '{ "links": [ { "name": "<words>", "target": <target> } ] }', area: 'blocks', words: ['link', 'go to', 'open', 'see also'], example: { links: [{ name: 'The code', target: { file: '<file>' } }] } },
    button: { what: 'a button that goes to a target', form: '{ "button": { "name": "<words>", "target": <target> } }', area: 'blocks', words: ['press', 'action', 'run'], example: { button: { name: 'Open the code', target: { file: '<file>' } } } },
    picture: { what: 'a picture, kept in Apostil\'s store', form: '{ "picture": "<file>" }', area: 'blocks', words: ['image', 'figure', 'screenshot', 'photo'], example: { picture: 'apostil-look-figure.png' } },
    diagram: { what: 'a diagram of the map, small; a click opens it on Home', form: '{ "diagram": "<id>" }', area: 'blocks', words: ['map', 'flow', 'process', 'drawing'], example: { diagram: '<diagram>' } },
    row: { what: 'two or three blocks side by side, one under the other when narrow; no row in a row', form: '{ "row": [<block>, <block>] }', area: 'blocks', words: ['columns', 'side by side', 'layout'], example: { row: [{ text: 'Left' }, { text: 'Right' }] } },
  },
  blockTitle: 'any block may have "title": a quiet line above it',
  sources: {
    written: 'the value in the block, as "form" says',
    file: 'in its place, as "file" says: a CSV, TSV or JSON file that Git lists (rows, or the keys of an object), read when its window or page opens',
  },
  limits: { pageBlocks: 30, sectionBlocks: 6, ownSections: 4, rowBlocks: 3, rows: 50, rowsWhenNone: 10, columns: 12, codeLines: 100, fileBytes: 2 * 1024 * 1024, pages: 20 },
  pages: {
    what: 'pages of the look: each opens as a tab with its title; the target "page" opens one',
    form: '"pages": [ { "id": "<small letters, digits and ->", "title": "<words>", "blocks": [<block>] } ], beside "rules"',
    area: 'pages', words: ['page', 'report', 'dashboard', 'overview', 'screen'],
    example: { pages: [{ id: 'overview', title: 'Overview', blocks: [{ text: 'What the repo does.' }] }], rules: [] },
  },
  actions: {
    what: 'the actions of the look: the list of the entry "Actions of the Look…", and the keys action-1 to action-9',
    form: '"actions": [ { "id": "<small letters and ->", "name": "<at most 40 characters>", "target": <target> } ], at most 12',
    area: 'vscode', most: 12, name: 40, words: ['action', 'actions', 'command list'],
  },
  never: {
    codelens: { name: 'a line above code (CodeLens)', cannot: 'put a line above code (CodeLens)', words: ['codelens', 'code lens', 'line above code', 'above a function'] },
    'inline-words': { name: 'words inside or after a code line', cannot: 'put words inside or after a code line', words: ['inline', 'end of line', 'after the line', 'ghost text', 'virtual text', 'blame'] },
    'line-tint': { name: 'a tint of code lines', cannot: 'tint code lines', words: ['tint', 'highlight line', 'line background', 'heatmap'] },
    'code-hover': { name: 'a window of the pointer over code (a hover)', cannot: 'open a window of the pointer over code (a hover)', words: ['hover over code', 'code hover', 'editor hover'] },
    'explorer-badge': { name: 'a badge in the Explorer', cannot: 'put a badge in the Explorer', words: ['explorer badge', 'file badge', 'file decoration'] },
    'status-bar': { name: 'the status bar', cannot: 'put anything in the status bar', words: ['status bar', 'statusbar', 'status item'] },
    'scroll-bar': { name: 'marks in the scroll bar', cannot: 'put marks in the scroll bar', words: ['scroll bar', 'scrollbar', 'overview ruler', 'minimap'] },
    timeline: { name: 'the Timeline', cannot: 'put anything in the Timeline', words: ['timeline', 'history view'] },
    'terminal-links': { name: 'links in the terminal', cannot: 'put links in the terminal', words: ['terminal', 'terminal link', 'console'] },
    breadcrumbs: { name: 'notes in the path above the code', cannot: 'put notes in the path above the code', words: ['breadcrumbs', 'breadcrumb', 'path above the code'] },
    outline: { name: 'symbols in the outline', cannot: 'put symbols in the outline', words: ['outline', 'document symbols', 'symbols of a file'] },
    'inlay-hints': { name: 'words that VS Code lays into code (inlay hints)', cannot: 'lay words into code (inlay hints)', words: ['inlay hints', 'inlay', 'parameter names'] },
    problems: { name: 'problems with lines under code', cannot: 'put problems with lines under code', words: ['problems', 'squiggle', 'underline', 'diagnostics'] },
    'scm-badges': { name: 'badges in Source Control', cannot: 'put badges in Source Control', words: ['source control', 'scm'] },
    'icon-count': { name: 'a count on the icon of Apostil', cannot: 'put a count on the icon of Apostil', words: ['activity bar', 'icon count', 'number on the icon'] },
    'comment-threads': { name: 'comment threads inside code', cannot: 'put comment threads inside code', words: ['comment thread', 'review thread', 'inline comment'] },
    'notebook-status': { name: 'status items on notebook cells', cannot: 'put status items on notebook cells', words: ['cell status', 'notebook status'] },
    testing: { name: 'the Testing view', cannot: 'put anything in the Testing view', words: ['testing', 'testing view'] },
  },
} as const satisfies LookPartsList;

/** Where a click, a key or a menu entry can go. */
export const TARGETS = LOOK_PARTS[TARGETS_KEY];

export type LookKind = keyof typeof LOOK_PARTS.components;
export const LOOK_KINDS = Object.keys(LOOK_PARTS.components) as LookKind[];
type SlotName = keyof typeof LOOK_PARTS.slots;
type TargetName = keyof typeof TARGETS;
export const TARGET_NAMES = Object.keys(TARGETS) as TargetName[];
export type Component = {
  slots: readonly string[]; takes?: Readonly<Record<string, readonly string[]>>; fields: Readonly<Record<string, FieldKind>>; sections?: readonly string[]; shows?: readonly string[];
  name?: string; why?: string; targets?: readonly string[]; targetsWhy?: string;
};
const componentOf = (kind: LookKind): Component => LOOK_PARTS.components[kind];
/** One thing of a kind in the words of a sentence: its name, else the kind. */
export const nameOf = (kind: string): string => (LOOK_PARTS.components as Readonly<Record<string, Component>>)[kind]?.name ?? kind;

/** A value of a field of a thing, as a rule names it. */
type FieldValue = string | number | boolean;

/** Which things a rule picks: a kind, and any of paths (folders end with "/"), node ids of one diagram, a mark ("set:value" or "set:*"), a diagram id, and fields. */
export interface Pick {
  kind: LookKind;
  paths?: string[];
  nodes?: string[];
  mark?: string;
  diagram?: string;
  where?: Record<string, FieldValue | FieldValue[]>;
}

/** Where a click, a key or a menu entry goes: one of the targets of LOOK_PARTS. */
export interface Target {
  file?: string;
  line?: number;
  url?: string;
  command?: string;
  prompt?: string;
  place?: { diagram: string; node?: string };
  graphs?: string;
  folder?: string;
  change?: string;
  part?: string;
  pull?: number;
  comment?: true;
  window?: { title?: string; width?: number; blocks?: Block[]; ref?: string }; // a page gets `ref` in place of the blocks, and asks for them when it opens
  page?: string;
}
/** What a button does on a click: a target (build 51 named it an action). */
export type Action = Target;

export interface Button {
  icon: string; // in a draft: a file in the repo folder; stored: the name of the kept file
  name: string; // what the pointer says
  action?: Target;
}

/** A corner of a node or a note: the marks of a set, one button, or nothing (null). */
export type CornerFill = { set: string } | Button | null;

export interface LookRule {
  pick: Pick;
  box?: { color?: string; line?: string; width?: number; dashed?: boolean; shape?: string };
  content?: { words?: string; fields?: string[]; picture?: string; film?: string };
  corners?: Partial<Record<Corner, CornerFill>>;
  note?: { color?: string };
  arrow?: { color?: string; width?: number; dashed?: boolean; icon?: Button };
  show?: { shown?: boolean; folded?: boolean };
  order?: { by?: string; down?: boolean; group?: string; first?: string[] };
  text?: { color?: string; size?: string; icon?: string };
  click?: Target;
  input?: { alt?: Target; shift?: Target; double?: Target; key?: Record<string, Target>; menu?: { name: string; target: Target }[] };
  window?: { width?: number; sections?: (string | OwnSection)[] };
}

/** A block of a page or a window: one kind of LOOK_PARTS.blocks with its value, and any "title". */
export type Block = Record<string, unknown> & { title?: string };
/** A section of its own in the window of the pointer: a quiet title and blocks. A page gets `ref` in place of the blocks. */
export interface OwnSection { title?: string; blocks?: Block[]; ref?: string }
/** A page of the look: it opens as a tab named by its title. */
export interface LookPage { id: string; title: string; blocks: Block[] }
/** An action of the look: a row of "Actions of the Look…", and the target of a key action-1 to action-9 (build 62). */
export interface LookAction {
  id: string;
  name: string;
  target: Target;
}

export interface Look {
  sets?: MarkSet[];
  pages?: LookPage[];
  rules: LookRule[];
  actions?: LookAction[];
}

/** The default look, as rules: the icons of the services at the upper right of a node, a step, a call out of the repo and a note. It is always the first rule. */
export const DEFAULT_RULES: LookRule[] = (['node', 'step', 'call', 'note'] as const).map((kind) => ({ pick: { kind }, corners: { 'upper-right': { set: SERVICES.id } } }));

/** The slots that the page takes whole: one field only, or one target. */
export const ONE_FIELD_SLOTS = Object.entries(LOOK_PARTS.slots).filter(([, slot]) => ('one' in slot && slot.one) || ('target' in slot && slot.target)).map(([name]) => name);

/** The commands of Apostil, from its package.json. */
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

/** Every file that a look names, found by the kinds of the fields of LOOK_PARTS: the icons of the values of its sets, pictures, films and icons. */
export function lookFiles(look: Look): LookFile[] {
  const files: LookFile[] = [];
  const add = (holder: Record<string, any>, key: string, use: FileUse, at: string, value?: LookFile['value']): void => {
    if (isText(holder[key])) files.push({ path: holder[key], use, at, put: (kept) => { holder[key] = kept; }, ...(value ? { value } : {}) });
  };
  for (const set of look.sets ?? []) for (const value of set.values ?? []) add(value, 'icon', 'icon', `The value "${value.id}" of the set "${set.id}"`, { set: set.id, id: value.id });
  eachBlock(look, (block, at) => add(block, 'picture', 'picture', at)); // the pictures of blocks, kept as the picture of a node is
  look.rules.forEach((rule, index) => {
    for (const [slot, about] of Object.entries(LOOK_PARTS.slots) as [SlotName, (typeof LOOK_PARTS.slots)[SlotName]][]) {
      const given = (rule as unknown as Record<string, unknown>)[slot];
      if (!isObject(given)) continue;
      for (const [field, kind] of Object.entries(about.fields) as [string, ValueKind][]) {
        if (kind === 'picture' || kind === 'film') add(given, field, kind, `Rule ${index + 1}`);
        if (kind === 'icon') add(given, field, 'icon', `Rule ${index + 1}, "${slot}"`);
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
  pages?: string[]; // the ids of the pages of the look, which the target "page" may name
  listed?: Set<string>; // the files that Git lists, read once for a look
  parts?: string[]; // the ids of the parts of the saved change of the branch; with no saved change a part id is not checked
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

const an = (kind: string): string => { const word = nameOf(kind); return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`; };
const An = (word: string): string => an(word).replace(/^a/, 'A');
const listed = (names: readonly string[]): string => names.map((one) => `"${one}"`).join(', ');
const unknownFields = (value: object, known: readonly string[], at: string): string[] =>
  Object.keys(value).filter((key) => !known.includes(key)).map((key) => `${at}: "${key}" is no field here. Use only ${listed(known)}.${nearestPart(key, known)}`);

/**
 * What is wrong with a look, as sentences that a model can act on: known components and slots, each slot fits its component, known fields with
 * values of their kind, existing paths, node ids and diagram ids, known mark sets, known targets. The files are checked by set-look, which reads them.
 */
export function lookProblems(value: unknown, given: LookContext): string[] {
  if (!isObject(value)) return ['The look must be a JSON object: { "sets"?: [ ... ], "rules": [ ... ] }.'];
  const look = value as unknown as Look;
  const problems: string[] = [];
  const fields = ['sets', 'rules', 'pages', 'actions'];
  for (const key of Object.keys(value)) if (!fields.includes(key)) problems.push(`The look: "${key}" is no field of a look. Use ${listed(fields)}.${nearestPart(key, fields)}`);
  // The pages first, so that a target "page" anywhere knows their ids.
  const context: LookContext = { ...given, pages: Array.isArray(look.pages) ? look.pages.map((page) => page?.id).filter(isId) : [] };
  if (look.pages !== undefined) problems.push(...pageProblems(look.pages, context));
  problems.push(...actionProblems(value.actions, context));
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

/** The actions of a look: at most 12, each { "id", "name", "target" } with an id once, a name of at most 40 characters and one target of the list. */
function actionProblems(actions: unknown, context: LookContext): string[] {
  if (actions === undefined) return [];
  const { most, name: longest, form } = LOOK_PARTS.actions;
  if (!Array.isArray(actions)) return [`"actions" must be a list: ${form}.`];
  const problems = actions.length > most ? [`The look: it has ${actions.length} actions. The list holds at most ${most}.`] : [];
  const ids = new Set<string>();
  actions.forEach((action, index) => {
    const at = `Action ${isObject(action) && isText(action.id) ? `"${action.id}"` : index + 1}`;
    if (!isObject(action)) return void problems.push(`${at}: an action is { "id", "name", "target" }.`);
    problems.push(...unknownFields(action, ['id', 'name', 'target'], at));
    if (!isId(action.id)) problems.push(`${at}: "id" must use small letters, digits and "-".`);
    else if (ids.has(action.id)) problems.push(`${at}: the id is used twice. Give each action its own id.`);
    ids.add(action.id);
    if (!isText(action.name)) problems.push(`${at}: "name" is missing: what the row of the list says.`);
    else if (action.name.length > longest) problems.push(`${at}: the name has ${action.name.length} characters. A name holds at most ${longest}.`);
    problems.push(...targetProblems(action.target, at, context));
  });
  return problems;
}

/** The entry of the "never" list that a word names (as "status-bar" or "status bar"), or undefined. */
export function neverPart(word: unknown): (typeof LOOK_PARTS.never)[keyof typeof LOOK_PARTS.never] | undefined {
  if (typeof word !== 'string') return undefined;
  const plain = (text: string): string => text.toLowerCase().replace(/[-_\s]+/g, ' ').trim();
  return Object.entries(LOOK_PARTS.never).find(([id, part]) => [id, ...part.words].some((one) => plain(one) === plain(word)))?.[1];
}

/** The ids of the diagrams that a rule or a place may name: the written diagrams of the map and the drawn processes. */
function diagramIds(map?: RepoMap): Set<string> {
  return new Set([...(map?.diagrams ?? []).map((diagram) => diagram.id), ...(map?.processes ?? []).map((process) => processDiagramId(process.id))]);
}

/** The problems of node ids of a written diagram of the map; none when they are all its nodes. */
function nodeProblems(map: RepoMap | undefined, diagramId: string | undefined, nodes: string[], at: string, word: string): string[] {
  const diagram = map?.diagrams.find((one) => one.id === diagramId);
  if (!diagram) return [`${at}: ${word} needs "diagram": the id of the written diagram that has the node.`];
  const known = Object.keys(diagramGraph(diagram).nodes);
  return nodes.filter((node) => !known.includes(node)).map((node) => `${at}: the diagram "${diagram.id}" has no node "${node}". Its nodes are ${known.join(', ')}.${nearestPart(node, known)}`);
}

/** What a rule checks against: the component that it picks, the repo, and the mark sets of the look. */
export interface RuleContext {
  kind: LookKind;
  component: Component;
  context: LookContext;
  sets: Set<string>;
}

function ruleProblems(rule: unknown, at: string, context: LookContext, sets: Set<string>): string[] {
  if (!isObject(rule)) return [`${at}: a rule is an object { "pick": { ... }, and the slots that it changes }.`];
  const problems: string[] = [];
  const pick = rule.pick as Pick | undefined;
  const never = neverPart(isObject(pick) ? pick.kind : undefined);
  if (never) return [`${at}: "${String(pick!.kind)}" is no kind. A look cannot ${never.cannot}. Tell the owner so.`];
  if (!isObject(pick) || !LOOK_KINDS.includes(pick.kind as LookKind)) return [`${at}: "pick" must name a "kind": one of ${LOOK_KINDS.join(', ')}.${nearestPart(isObject(pick) ? pick.kind : undefined, LOOK_KINDS)}`];
  const ctx: RuleContext = { kind: pick.kind, component: componentOf(pick.kind), context, sets };
  problems.push(...unknownFields(pick as unknown as Record<string, unknown>, Object.keys(LOOK_PARTS.picks), `${at}, "pick"`));
  const own = ctx.component.slots;
  const slots = Object.keys(rule).filter((key) => key !== 'pick');
  for (const slot of slots) {
    if (!(slot in LOOK_PARTS.slots)) problems.push(`${at}: "${slot}" is no slot. The slots are ${listed(Object.keys(LOOK_PARTS.slots))}.${nearestPart(slot, Object.keys(LOOK_PARTS.slots))}`);
    else if (!own.includes(slot) && ctx.component.why) problems.push(`${at}, "${slot}": the ${pick.kind} takes only ${listed(own)}. ${ctx.component.why}`);
    else if (!own.includes(slot)) problems.push(`${at}: ${an(pick.kind)} has no slot "${slot}". Its slots are ${listed(own)}.${nearestPart(slot, own)}`);
    else problems.push(...slotProblems(slot as SlotName, rule[slot], at, ctx));
  }
  if (!slots.length) problems.push(`${at}: it changes nothing. Name the slot that it changes, as "box": { "color": "#2b6cb0" }.`);
  // Which things.
  if (pick.paths !== undefined) {
    if (!Array.isArray(pick.paths) || !pick.paths.length || !pick.paths.every(isText)) problems.push(`${at}: "paths" must be a list of folders (ending with "/") and files of the repo.`);
    else for (const path of pick.paths) { const bad = pathProblem(context.folder, path); if (bad) problems.push(`${at}: ${bad}`); }
  }
  if (pick.diagram !== undefined && !diagramIds(context.map).has(pick.diagram)) {
    problems.push(`${at}: "${pick.diagram}" is no diagram of the map. apostil map lists the ids of the diagrams; a process is "process:<id>".${nearestPart(String(pick.diagram), [...diagramIds(context.map)])}`);
  }
  if (pick.nodes !== undefined) {
    if (!Array.isArray(pick.nodes) || !pick.nodes.length || !pick.nodes.every(isText)) problems.push(`${at}: "nodes" must be a list of node ids.`);
    else problems.push(...nodeProblems(context.map, pick.diagram, pick.nodes, at, '"nodes"'));
  }
  if (pick.mark !== undefined) {
    const [set, markValue] = isText(pick.mark) ? pick.mark.split(':') : [];
    if (!set || !markValue) problems.push(`${at}: "mark" must be "<set>:<value>" or "<set>:*".`);
    else if (!sets.has(set)) problems.push(`${at}: "${set}" is no mark set. Use "${SERVICES.id}" or a set of "sets".${nearestPart(set, [...sets])}`);
  }
  if (pick.where !== undefined) problems.push(...whereProblems(pick.where, `${at}, "pick"`, ctx));
  return problems;
}

/** The sentence of a field that a component does not have, with its fields and the nearest one. */
const noField = (at: string, kind: LookKind, field: string, known: readonly string[]): string =>
  `${at}: ${an(kind)} has no field "${field}". Its fields are ${listed(known)}.${nearestPart(field, known)}`;

/** The ids of parts that the saved change of the branch does not have; none when the branch has no saved change: then they are not checked. */
const partProblems = (ids: string[], at: string, { parts }: LookContext): string[] => (parts
  ? ids.filter((id) => !parts.includes(id)).map((id) => `${at}: the change of this branch has no part "${id}". Its parts are ${parts.join(', ')}.${nearestPart(id, parts)}`)
  : []);

/** True when a rule reads a part id: then a branch with no saved change cannot check it, and set-look --check says so in a note. */
export const namesPart = (rule: LookRule): boolean => {
  const fields = (LOOK_PARTS.components as Readonly<Record<string, Component>>)[rule.pick?.kind]?.fields ?? {};
  return Object.keys(rule.pick?.where ?? {}).some((field) => fields[field] === 'part');
};

/** The problems of the pick "where": known fields of the component, each with a value of its kind or a list of them. */
function whereProblems(where: unknown, at: string, ctx: RuleContext): string[] {
  const fields = ctx.component.fields;
  const names = Object.keys(fields);
  if (!isObject(where) || !Object.keys(where).length) return [`${at}: "where" must be { "<field>": <value> } or { "<field>": [<values>] }, with fields of ${an(ctx.kind)}: ${listed(names)}.`];
  return Object.entries(where).flatMap(([field, value]) => {
    if (!(field in fields)) return [noField(at, ctx.kind, field, names)];
    const kind = fields[field];
    const values = Array.isArray(value) ? value : [value];
    const fits = (one: unknown): boolean => (Array.isArray(kind) ? kind.includes(one as string) : kind === 'count' ? Number.isInteger(one) && (one as number) >= 0 : kind === 'yes' ? typeof one === 'boolean' : isText(one));
    if (values.length && values.every(fits)) return kind === 'part' ? partProblems(values as string[], at, ctx.context) : [];
    // A word that is no value of a field with fixed values: the values, and the nearest one. A key goes to the first nine actions only.
    const wrongWord = Array.isArray(kind) ? values.find((one) => typeof one === 'string' && !fits(one)) as string | undefined : undefined;
    if (wrongWord !== undefined) {
      const nine = /^action-\d+$/.test(wrongWord) && kind.includes('action-1') ? ' A key goes to the first nine actions: action-1 to action-9.' : '';
      return [`${at}: "${wrongWord}" is no value of "${field}".${nine || ` The values are ${(kind as readonly string[]).join(', ')}.${nearestPart(wrongWord, kind as readonly string[])}`}`];
    }
    const wanted = Array.isArray(kind) ? `one of ${listed(kind)}` : kind === 'count' ? 'a whole number' : kind === 'yes' ? 'true or false' : 'words';
    return [`${at}: "${field}" of ${an(ctx.kind)} is ${wanted}, or a list of them.`];
  });
}

/** The problems of one slot of a rule: the fields that its component takes, each with a value of its kind. */
function slotProblems(slot: SlotName, given: unknown, at: string, ctx: RuleContext): string[] {
  const about = LOOK_PARTS.slots[slot] as { one?: boolean; target?: boolean; fields: Record<string, ValueKind> };
  const where = `${at}, "${slot}"`;
  const only = ctx.component.targets;
  if (about.target && only && isObject(given) && !Object.keys(given).some((key) => only.includes(key))) {
    const names = only.map((one) => `"${one}"`);
    return [`${where}: ${ctx.component.targetsWhy?.replace('<targets>', `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`)}`];
  }
  if (about.target) return targetProblems(given, where, ctx.context);
  const fields = Object.keys(about.fields);
  const takes = ctx.component.takes?.[slot] ?? fields;
  if (!isObject(given)) return [`${at}: "${slot}" must be an object with any of ${listed(takes)}.`];
  if (about.one && Object.keys(given).length !== 1) return [`${at}: "${slot}" must hold one of ${listed(takes)}.`];
  const problems = unknownFields(given, fields, where);
  for (const [field, kind] of Object.entries(about.fields)) {
    if (!(field in given)) continue;
    if (!takes.includes(field)) {
      problems.push(`${where}: ${an(ctx.kind)} ${kind === 'yes' ? `cannot be ${field}` : `takes no "${field}" here`}. ${An(ctx.kind)} takes only ${listed(takes)}.`);
      continue;
    }
    problems.push(...valueProblem(kind, given[field], where, field, ctx));
  }
  return problems;
}

/** The fields of a thing in braces in words: "{title} · {files} files" names title and files. */
export const fieldsInWords = (words: string): string[] => [...words.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1].trim());

/** The problem of one value of a field by its kind (VALUES). A file is checked by set-look, which reads it. */
export function valueProblem(kind: ValueKind, value: unknown, at: string, field: string, ctx: RuleContext): string[] {
  const wrong = [`${at}: "${field}" must be ${VALUES[kind]}.`];
  const { context, sets, component } = ctx;
  const known = Object.keys(component.fields);
  switch (kind) {
    case 'colour': return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? [] : [`${at}: "${field}" must be one colour as "#rrggbb", for example "#2b6cb0". Apostil makes the colour of the dark theme itself.`];
    case 'width': return typeof value === 'number' && value > 0 && value <= MAX_WIDTH ? [] : wrong;
    case 'pixels': return typeof value === 'number' && value >= WINDOW_WIDTH[0] && value <= WINDOW_WIDTH[1] ? [] : wrong;
    case 'yes': return typeof value === 'boolean' ? [] : wrong;
    case 'shape': return SHAPES.includes(value as string) ? [] : [`${at}: "${String(value)}" is no shape. Use one of ${SHAPES.join(', ')}.${nearestPart(String(value), SHAPES)}`];
    case 'size': return SIZES.includes(value as string) ? [] : [`${at}: "${String(value)}" is no size. Use one of ${listed(SIZES)}.`];
    case 'text': case 'picture': case 'film': case 'icon': return isText(value) ? [] : wrong;
    case 'words':
      if (!isText(value)) return wrong;
      return fieldsInWords(value).filter((name) => !known.includes(name))
        .map((name) => `${at}: the words name the field {${name}}, which ${an(ctx.kind)} does not have. Its fields are ${listed(known)}.${nearestPart(name, known)}`);
    case 'fields': {
      const shows = component.shows ?? known;
      if (!Array.isArray(value) || !value.length || !value.every(isText)) return [`${at}: "${field}" must be a list of the fields of ${an(ctx.kind)} that show, in their order: any of ${listed(shows)}.`];
      return value.filter((name) => !shows.includes(name)).map((name) => `${at}: ${an(ctx.kind)} shows no field "${name}". It shows ${listed(shows)}.${nearestPart(name, shows)}`);
    }
    case 'field': return isText(value) && known.includes(value) ? [] : [noField(at, ctx.kind, String(value), known)];
    case 'ids': {
      if (!(Array.isArray(value) && value.length && value.every(isText))) return wrong;
      // A component whose ids are a few fixed values (the views) names the ones that it has.
      const ids = component.fields.id;
      const name = component.name ?? nameOf(ctx.kind);
      return Array.isArray(ids) ? value.filter((id) => !ids.includes(id)).map((id) => `${at}: "${id}" is no ${name}. The ${name}s are ${listed(ids)}.${nearestPart(id, ids)}`) : [];
    }
    case 'target': return targetProblems(value, at, context);
    case 'keys': return keyProblems(value, at, context);
    case 'menu':
      if (!Array.isArray(value) || !value.length) return [`${at}: "menu" must be a list of { "name", "target" }: one entry for each row of the menu.`];
      return value.flatMap((entry, index) => (isObject(entry) && isText(entry.name)
        ? [...unknownFields(entry, ['name', 'target'], `${at}, entry ${index + 1}`), ...targetProblems(entry.target, `${at}, entry ${index + 1}`, context)]
        : [`${at}: entry ${index + 1} of "menu" must be { "name": what the row says, "target": <target> }.`]));
    case 'sections': {
      const own = component.sections ?? [];
      if (!Array.isArray(value) || !value.length) return [`${at}: "sections" must be a list of the sections of the window of ${an(ctx.kind)}: any of ${listed(own)}.`];
      const mine = value.filter(isObject).length;
      const most = LIMITS.ownSections;
      return [
        ...(mine > most ? [`${at}: it has ${mine} sections of its own. A window holds at most ${most}. Make a page, or fewer sections.`] : []),
        ...value.flatMap((one, index) => {
          if (isObject(one)) return ownSectionProblems(one, `${at}, section ${index + 1}`, context);
          return own.includes(one) ? [] : [`${at}: "${String(one)}" is no section of the window of ${an(ctx.kind)}. Its sections are ${listed(own)}.${nearestPart(String(one), own)}`];
        }),
      ];
    }
    case 'button': return buttonProblems(value, `${at}, the button "${field}"`, context);
    case 'corner':
      if (value === null) return [];
      if (isObject(value) && 'set' in value) return Object.keys(value).length === 1 && sets.has(value.set) ? [] : [`${at}, the corner "${field}": { "set": <id> } must name a mark set: "${SERVICES.id}" or a set of "sets".${nearestPart(value.set, [...sets])}`];
      return buttonProblems(value, `${at}, the corner "${field}"`, context);
  }
}

/** The keys of the input "key": each one letter or a digit that no page of Apostil uses, to a target. */
function keyProblems(value: unknown, at: string, context: LookContext): string[] {
  if (!isObject(value) || !Object.keys(value).length) return [`${at}: "key" must be ${VALUES.keys}.`];
  return Object.entries(value).flatMap(([key, target]) => {
    const one = key.toLowerCase();
    if (!/^[a-z0-9]$/.test(one)) return [`${at}: the key "${key}" is no letter or digit. A key of a look is one letter or one digit.`];
    if (PAGE_KEYS.includes(one)) return [`${at}: the key "${key}" is a key of the page already. Free keys are the digits and the letters ${FREE_KEYS.filter((free) => /[a-z]/.test(free)).join(', ')}.`];
    return targetProblems(target, `${at}, the key "${key}"`, context);
  });
}

/** What is wrong with a button: an icon (a file), a name, and at most one target. */
function buttonProblems(value: unknown, at: string, context: LookContext): string[] {
  if (!isObject(value)) return [`${at}: give a button ${VALUES.button}.`];
  const problems = unknownFields(value, ['icon', 'name', 'action'], at);
  if (!isText(value.icon)) problems.push(`${at}: "icon" must be a file of an icon in the repo folder.`);
  if (!isText(value.name)) problems.push(`${at}: "name" must say in a few words what the button is, for the pointer.`);
  return value.action === undefined ? problems : [...problems, ...targetProblems(value.action, `${at}, "action"`, context)];
}

/** What is wrong with a target: exactly one target of LOOK_PARTS, with its own fields, each of the right kind. */
export function targetProblems(value: unknown, at: string, context: LookContext): string[] {
  const forms = TARGET_NAMES.map((kind) => TARGETS[kind].form).join(', ');
  if (!isObject(value)) return [`${at}: a target is one of ${forms}.`];
  const target = value as Target;
  const given = TARGET_NAMES.filter((key) => target[key] !== undefined);
  const strange = Object.keys(value).filter((key) => !(TARGET_NAMES as string[]).includes(key) && key !== 'line' && key !== 'part');
  const problems = strange.map((key) => `${at}: "${key}" is no target. The targets are ${listed(TARGET_NAMES)}.${nearestPart(key, TARGET_NAMES)}`);
  if (given.length !== 1) return strange.length && !given.length ? problems : [...problems, `${at}: a target holds exactly one of ${listed(TARGET_NAMES)}: ${forms}.`];
  if (target.line !== undefined && given[0] !== 'file') problems.push(`${at}: "line" goes with "file".`);
  if (target.part !== undefined && given[0] !== 'change') problems.push(`${at}: "part" goes with "change".`);
  switch (given[0]) {
    case 'url':
      if (!(typeof target.url === 'string' && /^https:\/\/[^\s]+$/.test(target.url))) problems.push(`${at}: "url" must be a web address that starts with https://.`);
      break;
    case 'file': {
      const known = new Set(repoFiles(context.folder) ?? []);
      if (!isText(target.file) || !known.has(target.file)) problems.push(`${at}: the file ${String(target.file)} is no file of the repo. Give a path that Git lists.`);
      else if (target.line !== undefined) {
        const lines = (fileText(context.folder, target.file) ?? '').split('\n').length;
        if (!isLine(target.line) || target.line > lines) problems.push(`${at}: line ${String(target.line)} is not inside ${target.file}, which has ${lines} lines.`);
      }
      break;
    }
    case 'command': {
      const command = String(target.command);
      if (LOOK_COMMANDS.includes(command)) break;
      if (context.commands.includes(command)) problems.push(`${at}: the command "${command}" changes the computer, so a look cannot run it. A look can run: ${LOOK_COMMANDS.join(', ')}.`);
      else problems.push(`${at}: "${command}" is no command of Apostil. A look can run: ${LOOK_COMMANDS.join(', ')}.${nearestPart(command, LOOK_COMMANDS)}`);
      break;
    }
    case 'prompt':
      if (!isText(target.prompt)) problems.push(`${at}: "prompt" must be the words for the agent.`);
      break;
    case 'place': {
      const place = target.place;
      if (!isObject(place) || !isText(place.diagram) || !diagramIds(context.map).has(place.diagram)) problems.push(`${at}: "place" must name a diagram of the map by "diagram" (a process is "process:<id>"), and a "node" of it when you want one lit.${nearestPart(isObject(place) ? place.diagram : undefined, [...diagramIds(context.map)])}`);
      else if (place.node !== undefined) problems.push(...nodeProblems(context.map, place.diagram, [place.node], at, '"node"'));
      break;
    }
    case 'graphs': {
      const bad = isText(target.graphs) ? pathProblem(context.folder, target.graphs) : '"graphs" must be a folder (ending with "/") or a file of the repo.';
      if (bad) problems.push(`${at}: ${bad}`);
      break;
    }
    case 'folder': {
      const bad = isText(target.folder) && target.folder.endsWith('/') ? pathProblem(context.folder, target.folder) : '"folder" must be a folder of the repo, ending with "/".';
      if (bad) problems.push(`${at}: ${bad}`);
      break;
    }
    case 'change':
      if (!isText(target.change)) problems.push(`${at}: "change" must be the name of a branch.`);
      if (target.part !== undefined && !isText(target.part)) problems.push(`${at}: "part" must be the id of a part of that change.`);
      break;
    case 'pull':
      if (!Number.isInteger(target.pull) || (target.pull as number) < 1) problems.push(`${at}: "pull" must be the number of a pull request, as 12.`);
      break;
    case 'comment':
      if (target.comment !== true) problems.push(`${at}: "comment" must be true.`);
      break;
    case 'window': {
      const win = target.window as unknown;
      if (!isObject(win)) { problems.push(`${at}: "window" must be ${TARGETS.window.form.slice('{ "window": '.length, -2)}.`); break; }
      problems.push(...unknownFields(win, ['title', 'width', 'blocks'], `${at}, "window"`));
      if (win.title !== undefined && !isText(win.title)) problems.push(`${at}: the "title" of a window must be words.`);
      if (win.width !== undefined && !(typeof win.width === 'number' && win.width >= WINDOW_WIDTH[0] && win.width <= WINDOW_WIDTH[1])) problems.push(`${at}: the "width" of a window must be ${VALUES.pixels}.`);
      problems.push(...blockProblems(win.blocks, at, context, { most: LIMITS.sectionBlocks, holder: 'A window', instead: 'Make a page, or fewer blocks.' }));
      break;
    }
    case 'page': {
      const pages = context.pages ?? [];
      if (isText(target.page) && pages.includes(target.page)) break;
      problems.push(pages.length ? `${at}: the look has no page "${String(target.page)}". Its pages are ${listed(pages)}.${nearestPart(target.page, pages)}`
        : `${at}: the look has no page "${String(target.page)}". It has no pages yet: add one to "pages".`);
      break;
    }
  }
  return problems;
}

// ----- blocks: what a page or a section of a window shows (build 58) -----

const LIMITS = LOOK_PARTS.limits;
export const BLOCK_KINDS = Object.keys(LOOK_PARTS.blocks);
/** The fields of a file source of each block that takes one: a table, bars, fields, a state, and code (its lines, or a key of a JSON file). */
const SOURCE_FIELDS: Record<string, string[]> = { table: ['file', 'columns', 'rows'], bars: ['file', 'label', 'value', 'rows'], fields: ['file', 'keys'], state: ['file', 'key'], code: ['file', 'lines', 'key'] };

/** The kind of a block: its one field besides "title"; undefined when it has none or several. */
export function blockKind(block: unknown): string | undefined {
  if (!isObject(block)) return undefined;
  const kinds = Object.keys(block).filter((key) => key !== 'title');
  return kinds.length === 1 ? kinds[0] : undefined;
}

/** How many blocks a list may hold, and the words of its sentence: "A page holds at most 30. Make two pages, or fewer blocks." */
interface BlockRoom { most: number; holder: string; instead: string }

/** The problems of the pages of a look: at most 20, each { "id", "title", "blocks" }, its id once. */
function pageProblems(pages: unknown, context: LookContext): string[] {
  if (!Array.isArray(pages)) return ['"pages" must be a list of pages: { "id", "title", "blocks" }.'];
  const problems = pages.length > LIMITS.pages ? [`The look: it has ${pages.length} pages. A look holds at most ${LIMITS.pages}. Put more blocks on one page, or fewer pages.`] : [];
  const ids = new Set<string>();
  pages.forEach((page, index) => {
    if (!isObject(page)) return void problems.push(`Page ${index + 1}: a page is { "id", "title", "blocks" }.`);
    const at = isText(page.id) ? `Page "${page.id}"` : `Page ${index + 1}`;
    problems.push(...unknownFields(page, ['id', 'title', 'blocks'], at));
    if (!isId(page.id)) problems.push(`${at}: "id" must use small letters, digits and "-".`);
    else if (ids.has(page.id)) problems.push(`The look: the page id "${page.id}" is used twice. Give each page its own id.`);
    else ids.add(page.id);
    if (!isText(page.title)) problems.push(`${at}: "title" is missing: the name of its tab.`);
    problems.push(...blockProblems(page.blocks, at, context, { most: LIMITS.pageBlocks, holder: 'A page', instead: 'Make two pages, or fewer blocks.' }));
  });
  return problems;
}

/** The problems of a section of its own in a window: a quiet title, and at most 6 blocks. */
function ownSectionProblems(section: Record<string, unknown>, at: string, context: LookContext): string[] {
  return [
    ...unknownFields(section, ['title', 'blocks'], at),
    ...(section.title !== undefined && !isText(section.title) ? [`${at}: "title" must be words.`] : []),
    ...blockProblems(section.blocks, at, context, { most: LIMITS.sectionBlocks, holder: 'A section', instead: 'Make two sections, or fewer blocks.' }),
  ];
}

/** The problems of a list of blocks, wherever it stands: at most `room.most`, each one block of LOOK_PARTS.blocks in its form. */
export function blockProblems(blocks: unknown, at: string, context: LookContext, room: BlockRoom): string[] {
  if (!Array.isArray(blocks) || !blocks.length) return [`${at}: "blocks" must be a list of blocks, as [ { "text": "<words>" } ]; apostil look-slots blocks gives every block.`];
  const problems = blocks.length > room.most ? [`${at}: it has ${blocks.length} blocks. ${room.holder} holds at most ${room.most}. ${room.instead}`] : [];
  blocks.forEach((block, index) => problems.push(...oneBlockProblems(block, `${at}, block ${index + 1}`, context)));
  return problems;
}

/** The problems of one block: one kind with its value, or a file source in its place. */
function oneBlockProblems(block: unknown, at: string, context: LookContext): string[] {
  if (!isObject(block)) return [`${at}: a block is an object of one kind, as { "text": "<words>" }.`];
  const keys = Object.keys(block).filter((key) => key !== 'title');
  const problems = keys.filter((key) => !BLOCK_KINDS.includes(key)).map((key) => `${at}: "${key}" is no block. The blocks are ${listed(BLOCK_KINDS)}.${nearestPart(key, BLOCK_KINDS)}`);
  if (block.title !== undefined && !isText(block.title)) problems.push(`${at}: "title" must be words.`);
  const kinds = keys.filter((key) => BLOCK_KINDS.includes(key));
  if (kinds.length !== 1) return problems.length && !kinds.length ? problems : [...problems, `${at}: a block holds exactly one of ${listed(BLOCK_KINDS)}.`];
  const kind = kinds[0];
  const value = block[kind];
  const about = (LOOK_PARTS.blocks as LookPartsList['blocks'])[kind];
  const form = `${at}: the block "${kind}" is ${about.form}${about.file ? `, or a file in its place: ${about.file}` : ''}.`;
  if (SOURCE_FIELDS[kind] && isObject(value) && 'file' in value) return [...problems, ...sourceProblems(kind, value, at, context)];
  const pairs = (most: number, fits: (one: unknown) => boolean): string[] => {
    if (!Array.isArray(value) || !value.length || !value.every((one) => Array.isArray(one) && one.length === 2 && isText(one[0]) && fits(one[1]))) return [form];
    return value.length > most ? [`${at}: it has ${value.length} rows. ${kind === 'bars' ? 'Bars show' : 'Fields show'} at most ${most}.`] : [];
  };
  switch (kind) {
    case 'text': return isText(value) ? problems : [...problems, form];
    case 'fields': return [...problems, ...pairs(LIMITS.rows, (one) => ['string', 'number', 'boolean'].includes(typeof one))];
    case 'bars': return [...problems, ...pairs(LIMITS.rows, (one) => typeof one === 'number' && Number.isFinite(one))];
    case 'code': return typeof value === 'string' && value.length ? problems : [...problems, form];
    case 'table': {
      if (!isObject(value) || !Array.isArray(value.columns) || !value.columns.length || !value.columns.every(isText) || !Array.isArray(value.rows) || !value.rows.every((row) => Array.isArray(row))) return [...problems, form];
      if (value.columns.length > LIMITS.columns) problems.push(`${at}: a table shows at most ${LIMITS.columns} columns. Give fewer "columns".`);
      if (value.rows.length > LIMITS.rows) problems.push(`${at}: it has ${value.rows.length} rows. A table shows at most ${LIMITS.rows}.`);
      if (value.rows.some((row: unknown[]) => row.length > value.columns.length)) problems.push(`${at}: a row of the table has more values than "columns" has names.`);
      return problems;
    }
    case 'state':
      if (!isObject(value) || !isText(value.word)) return [...problems, form];
      problems.push(...unknownFields(value, ['word', 'color', 'text'], `${at}, "state"`));
      if (value.color !== undefined) problems.push(...valueProblem('colour', value.color, `${at}, "state"`, 'color', { kind: 'node', component: componentOf('node'), context, sets: new Set() }));
      if (value.text !== undefined && !isText(value.text)) problems.push(`${at}: the "text" of a state must be words.`);
      return problems;
    case 'links':
      if (!Array.isArray(value) || !value.length) return [...problems, form];
      return [...problems, ...value.flatMap((link, index) => (isObject(link) && isText(link.name)
        ? [...unknownFields(link, ['name', 'target'], `${at}, link ${index + 1}`), ...targetProblems(link.target, `${at}, link ${index + 1}`, context)]
        : [`${at}: link ${index + 1} must be { "name": what it says, "target": <target> }.`]))];
    case 'button':
      if (!isObject(value) || !isText(value.name)) return [...problems, form];
      return [...problems, ...unknownFields(value, ['name', 'target'], `${at}, "button"`), ...targetProblems(value.target, `${at}, "button"`, context)];
    case 'picture': return isText(value) ? problems : [...problems, form]; // set-look reads the file and keeps it
    case 'diagram':
      if (isText(value) && diagramIds(context.map).has(value)) return problems;
      return [...problems, `${at}: "${String(value)}" is no diagram of the map. apostil map lists the ids of the diagrams; a process is "process:<id>".${nearestPart(value, [...diagramIds(context.map)])}`];
    case 'row':
      if (!Array.isArray(value) || value.length < 2 || value.length > LIMITS.rowBlocks) return [...problems, `${at}: a row holds two or three blocks side by side: { "row": [<block>, <block>] }.`];
      if (value.some((one) => blockKind(one) === 'row')) return [...problems, `${at}: a row cannot hold a row. Put the blocks of the inner row into this row, or into a second row.`];
      return [...problems, ...value.flatMap((one, index) => oneBlockProblems(one, `${at}.${index + 1}`, context))];
  }
  return problems;
}

/** The sentence of a file that a block cannot read, by why. */
function readProblem(fault: ReadFault, path: string, at: string, kind: string): string {
  const ending = (/\.([a-z]+)$/i.exec(path)?.[1] ?? '').toUpperCase();
  return {
    unlisted: `${at}: the file ${path} is no file of the repo. Give a path that Git lists.`,
    outside: `${at}: the file ${path} lies outside the repo. Give a path inside it that Git lists.`,
    large: `${at}: the file ${path} is larger than ${LIMITS.fileBytes / 1024 / 1024} MB. A block reads a file of at most ${LIMITS.fileBytes / 1024 / 1024} MB.`,
    kind: `${at}: the file ${path} is no CSV, TSV or JSON file. A block reads its data from one of them${kind === 'code' ? ', or code from "lines" of any file' : ''}.`,
    unread: `${at}: the file ${path} does not read as ${ending}. Correct it, or give another file.`,
  }[fault];
}

/** The fields of a file source that are missing in the file now: a column or a key. Undefined when all are there. The check and the page both use it. */
export function missingIn(kind: string, source: Record<string, unknown>, data: { rows?: { columns: string[] }; keys?: Record<string, unknown> }): { name: string; of: 'column' | 'key'; have: string[] } | undefined {
  const names = kind === 'table' ? source.columns : kind === 'bars' ? [source.label, source.value] : kind === 'fields' ? source.keys : [source.key];
  const have = data.rows ? data.rows.columns : Object.keys(data.keys ?? {});
  const name = (Array.isArray(names) ? names : []).find((one) => !have.includes(String(one)));
  return name === undefined ? undefined : { name: String(name), of: data.rows ? 'column' : 'key', have };
}

/** The problems of a file source in place of the value of a block: its fields, a file that Git lists and that reads as its kind, and its columns or keys. */
function sourceProblems(kind: string, source: Record<string, unknown>, at: string, context: LookContext): string[] {
  const problems = unknownFields(source, SOURCE_FIELDS[kind], at);
  const path = String(source.file);
  context.listed ??= listedFiles(context.folder);
  if (kind === 'code' && source.lines === undefined && source.key === undefined) return [...problems, `${at}: code from a file needs "lines": [<from>, <to>], or "key" for a value of a JSON file.`];
  if (kind === 'code' && source.lines !== undefined) {
    const read = readRepoText(context.folder, path, LIMITS.fileBytes, context.listed);
    if ('fault' in read) return [...problems, readProblem(read.fault, path, at, kind)];
    const [from, to] = Array.isArray(source.lines) ? source.lines : [];
    const count = read.text.split('\n').length;
    if (!isLine(from) || !isLine(to) || from > to) return [...problems, `${at}: "lines" must be [<from>, <to>]: two line numbers, the first one first.`];
    if (to > count) return [...problems, `${at}: line ${to} is not inside ${path}, which has ${count} lines.`];
    return to - from + 1 > LIMITS.codeLines ? [...problems, `${at}: it shows ${to - from + 1} lines. A code block shows at most ${LIMITS.codeLines}.`] : problems;
  }
  if (source.rows !== undefined && !(Number.isInteger(source.rows) && (source.rows as number) >= 1 && (source.rows as number) <= LIMITS.rows)) problems.push(`${at}: "rows" must be a whole number from 1 to ${LIMITS.rows}.`);
  const read = readRepoData(context.folder, path, LIMITS.fileBytes, context.listed);
  if ('fault' in read) return [...problems, readProblem(read.fault, path, at, kind)];
  const { rows, keys } = read.data;
  const wantsRows = kind === 'table' || kind === 'bars';
  if (wantsRows && !rows) return [...problems, `${at}: the file ${path} holds one object, not rows. ${kind === 'bars' ? 'Bars read' : 'A table reads'} a CSV or TSV file, or a JSON list of objects.`];
  if (!wantsRows && !keys) return [...problems, `${at}: the file ${path} holds rows, not one object. ${kind === 'fields' ? 'Fields read keys' : kind === 'state' ? 'A state reads a key' : 'Code reads a key'} of a JSON object.`];
  const have = rows ? rows.columns : Object.keys(keys!);
  const needs = { table: ['columns', 'a table from a file needs "columns"'], bars: ['label', 'bars from a file need "label" and "value"'], fields: ['keys', 'fields from a file need "keys"'], state: ['key', 'a state from a file needs "key"'], code: ['key', 'code from a JSON file needs "key"'] }[kind]!;
  const given = kind === 'bars' ? isText(source.label) && isText(source.value) : kind === 'state' || kind === 'code' ? isText(source.key) : Array.isArray(source[needs[0]]) && (source[needs[0]] as unknown[]).length && (source[needs[0]] as unknown[]).every(isText);
  if (!given) return [...problems, `${at}: ${needs[1]}. The file ${path} has: ${have.join(', ')}.`];
  if (kind === 'table' && (source.columns as string[]).length > LIMITS.columns) problems.push(`${at}: a table shows at most ${LIMITS.columns} columns. Give fewer "columns".`);
  const missing = missingIn(kind, source, read.data);
  if (missing) return [...problems, `${at}: the file ${path} has no ${missing.of} "${missing.name}". Its ${missing.of}s are ${missing.have.join(', ')}.${nearestPart(missing.name, missing.have)}`];
  const odd = kind === 'bars' && rows!.rows.find((row) => !Number.isFinite(Number(row[source.value as string])));
  if (odd) problems.push(`${at}: the column "${String(source.value)}" of ${path} holds "${String(odd[source.value as string])}", which is no number.`);
  return problems;
}

/** Each block of a look with where it stands: in its pages, in the sections of windows, in the windows of targets, and inside rows. */
export function eachBlock(look: Partial<Look>, visit: (block: Block, at: string) => void): void {
  const walk = (value: unknown, at: string): void => {
    if (Array.isArray(value)) return value.forEach((one) => walk(one, at));
    if (!isObject(value)) return;
    if (Array.isArray(value.blocks)) value.blocks.forEach((block: unknown, index: number) => one(block, `${at}, block ${index + 1}`));
    for (const [key, inner] of Object.entries(value)) if (key !== 'blocks') walk(inner, at);
  };
  const one = (block: unknown, at: string): void => {
    if (!isObject(block)) return;
    visit(block, at);
    if (Array.isArray(block.row)) block.row.forEach((inner: unknown, index: number) => one(inner, `${at}.${index + 1}`));
    for (const [key, inner] of Object.entries(block)) if (key !== 'row') walk(inner, at); // a window of a link or a button
  };
  for (const page of Array.isArray(look.pages) ? look.pages : []) walk(page, `Page "${page?.id}"`);
  (Array.isArray(look.rules) ? look.rules : []).forEach((rule, index) => walk(rule, `Rule ${index + 1}`));
}

/** The name of a list of blocks for a page that asks for it: the same blocks give the same name. */
export const blockRef = (blocks: unknown): string => createHash('sha1').update(JSON.stringify(blocks)).digest('hex').slice(0, 12);

/** A copy of a value of the look with each list of blocks (a section of its own, the window of a target) in the form { ref }: Home carries no blocks. */
export function withBlockRefs<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withBlockRefs) as T;
  if (!isObject(value)) return value;
  const { blocks, ...rest } = value as Record<string, unknown>;
  const copy = Object.fromEntries(Object.entries(rest).map(([key, inner]) => [key, withBlockRefs(inner)]));
  return (Array.isArray(blocks) ? { ...copy, ref: blockRef(blocks) } : blocks === undefined ? copy : { ...copy, blocks }) as T;
}

/** The list of blocks of a look that has a ref, or undefined when the look has none such now. */
export function blocksOfRef(look: Partial<Look>, ref: string): Block[] | undefined {
  let found: Block[] | undefined;
  const walk = (value: unknown): void => {
    if (found || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(walk);
    const blocks = (value as Record<string, unknown>).blocks;
    if (Array.isArray(blocks) && blockRef(blocks) === ref) found = blocks;
    Object.values(value).forEach(walk);
  };
  walk(look);
  return found;
}
