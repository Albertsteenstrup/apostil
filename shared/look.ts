// The look of a repo: rules that a user asks for in plain words and an agent saves with `apostil set-look` (store/marks-save.ts).
// A rule picks things and changes one or more slots of them; everything else keeps the default look. The page applies the rules when it draws (view/media/marks.js).
// LOOK_PARTS is the one list of what a look can change: the components, their slots with their fields, what a rule can pick, and every target of a click.
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
import { STATE_LOOKS } from './pull-requests';
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
  sections: 'a list of the ids of the sections of the window, in the order that they show',
} as const;
type ValueKind = keyof typeof VALUES;
/** The kind of a field that a rule reads of a thing: words, a count, true or false, or one of a few fixed values. */
type FieldKind = 'text' | 'count' | 'yes' | readonly string[];

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
    called?: string; // what the sentences of the check call it, when "a <kind>" does not say it ("a row of a change")
    note?: string; // a sentence after "has no slot", when the component cannot have more slots
    names?: Readonly<Record<string, string>>; // what a field with fixed values names, for the sentence of a wrong value ("state of a check")
    id?: string; // the field that names a row, which "order.first" lists
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
}

const BLUE = '#2b6cb0';
const AMBER = '#b45309';
const GREY = '#6b7280';
const ONE_NODE = { kind: 'node', diagram: '<diagram>', nodes: ['<node>'] } as const;

// The fixed values of the fields of the side bar and of the page of a pull request. The pages work them out of their data (view/media/part-look.js).
/** The state of a row of a change: the agent works, answers to read, comments waiting, or what the row says. */
export const ROW_STATES = ['working', 'answers', 'waiting', 'out of date', 'in no part', 'open folder', 'no change file', 'none'] as const;
const PULL_STATES = Object.keys(STATE_LOOKS);
const CHECK_STATES = ['failed', 'running', 'waiting', 'passed', 'skipped'];
/** The kinds of the events and commits of a conversation. */
export const EVENT_KINDS = ['commit', 'push', 'branch', 'deployment', 'label', 'milestone', 'assignee', 'review', 'merge', 'state', 'title', 'mention', 'lock', 'comment', 'other'] as const;
const SIDE_SECTIONS = ['reviewers', 'assignees', 'labels', 'milestone', 'closes', 'tasks'];
const CHANGE_FIELDS = { branch: 'text', state: ROW_STATES, age: 'count', commits: 'count', files: 'count', added: 'count', removed: 'count', app: 'text', author: 'text' } as const;
const TREE_NOTE = 'VS Code draws the rows of the tree "Files", and a look can change only their icon, the quiet words after the name, the click and the order.';

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
      what: 'a note card in the file tab', area: 'notes', core: true, slots: ['note', 'corners', 'content', 'show', 'click', 'input'], words: ['card', 'comment', 'annotation', 'explanation'],
      takes: { content: ['fields'], show: ['shown'] },
      fields: { title: 'text', file: 'text', function: 'text', tests: 'count' }, shows: ['title', 'function', 'tests', 'text', 'services'],
      example: { pick: { kind: 'note', paths: ['<file>'] }, note: { color: AMBER } },
    },
    // Build 61: the list "Repo" and the tree "Files" of the side bar, and the page of a pull request (view/media/part-look.js draws them).
    'home-row': {
      what: 'the Home row of "Repo"', area: 'side-bar', slots: ['text', 'content', 'click'], takes: { text: ['icon'], content: ['words'] },
      fields: { repo: 'text' }, called: 'the Home row', words: ['home', 'header', 'top'], example: { pick: { kind: 'home-row' }, content: { words: 'Home · {repo}' } },
    },
    'list-search': {
      what: 'the words that the search of "Repo" starts with while the user keeps none', area: 'side-bar', slots: ['content'], takes: { content: ['words'] },
      fields: {}, called: 'the search field', words: ['search', 'filter', 'start'], example: { pick: { kind: 'list-search' }, content: { words: 'state:"checks failing"' } },
    },
    'session-head': {
      what: 'the head of the rows of an agent session', area: 'side-bar', slots: ['text', 'content'], takes: { text: ['icon'], content: ['words'] },
      fields: { app: 'text', name: 'text' }, called: 'the head of a session', words: ['session', 'agent', 'group'], example: { pick: { kind: 'session-head' }, content: { words: '{name} · {app}' } },
    },
    'change-row': {
      what: 'a row of a change; its order orders the rows while the user picked no sort', area: 'side-bar', slots: ['box', 'content', 'click', 'order'],
      takes: { box: ['color'], content: ['fields'] }, fields: CHANGE_FIELDS, id: 'branch', called: 'a row of a change', words: ['row', 'change', 'branch', 'sort', 'pin'],
      example: { pick: { kind: 'change-row' }, order: { by: 'added', down: true, first: ['<branch>'] } },
    },
    'row-state': {
      what: 'the state words of a row of a change', area: 'side-bar', slots: ['content', 'text'], takes: { content: ['words'], text: ['icon'] },
      fields: { state: ROW_STATES }, names: { state: 'state of a row' }, called: 'the state words of a row', words: ['state', 'status'],
      example: { pick: { kind: 'row-state', where: { state: 'working' } }, content: { words: 'busy' } },
    },
    'row-facts': {
      what: 'the facts line of a row of a change', area: 'side-bar', slots: ['content'], takes: { content: ['fields'] }, fields: {},
      shows: ['age', 'commits', 'files', 'added', 'removed', 'author'], called: 'the facts line of a row', words: ['facts', 'age', 'commits', 'size'],
      example: { pick: { kind: 'row-facts' }, content: { fields: ['age', 'added', 'removed'] } },
    },
    'pull-line': {
      what: 'the line of a pull request under a row', area: 'pull-lines', slots: ['text', 'content', 'click'], takes: { text: ['icon', 'color'], content: ['fields'] },
      fields: { number: 'count', state: PULL_STATES, checks: ['failed', 'running', 'passed', 'none'] }, shows: ['author', 'number', 'state', 'checks', 'stack', 'reviewers'],
      names: { state: 'state of a pull request', checks: 'state of the checks' }, called: 'a pull request line', words: ['pull request', 'PR', 'colour'],
      example: { pick: { kind: 'pull-line', where: { state: 'checks failing' } }, text: { color: AMBER } },
    },
    avatars: {
      what: 'the avatars of a pull request line', area: 'pull-lines', slots: ['text', 'show'], takes: { text: ['size'], show: ['shown'] },
      fields: {}, called: 'the avatars', words: ['avatar', 'people', 'faces'], example: { pick: { kind: 'avatars' }, show: { shown: false } },
    },
    'more-pulls': {
      what: 'the older pull requests of a row; "folded": false opens them', area: 'pull-lines', slots: ['show'],
      fields: {}, called: 'the older pull requests', words: ['older', 'merged', 'closed'], example: { pick: { kind: 'more-pulls' }, show: { folded: false } },
    },
    'tree-folder': {
      what: 'a folder row of "Files"; its order orders the folders in it', area: 'files', slots: ['show', 'order'], takes: { show: ['shown'], order: ['by', 'down'] },
      fields: { name: 'text', path: 'text', files: 'count' }, note: TREE_NOTE, called: 'a folder row', words: ['folder', 'tree', 'hide', 'sort'],
      example: { pick: { kind: 'tree-folder', paths: ['<folder>/'] }, show: { shown: false } },
    },
    'tree-file': {
      what: 'a file row of "Files": its icon, quiet words after its name, its click', area: 'files', slots: ['text', 'content', 'click'], takes: { text: ['icon'], content: ['words'] },
      fields: { name: 'text', path: 'text', marks: 'count' }, note: TREE_NOTE, called: 'a file row', words: ['file', 'tree', 'description'],
      example: { pick: { kind: 'tree-file', mark: '<set>:<value>' }, content: { words: '{marks} marks' } },
    },
    'graphs-icon': {
      what: 'the graphs icon of a row of "Files": only its click', area: 'files', slots: ['click'], fields: { path: 'text' }, called: 'the graphs icon',
      note: 'VS Code draws the graphs icon and decides when it shows, so a look can change only its click.', words: ['graphs', 'icon'],
      example: { pick: { kind: 'graphs-icon', paths: ['<file>'] }, click: { file: '<file>', line: 1 } },
    },
    'status-strip': {
      what: 'the status strip of a pull request: its bits in their order, the icon of its state', area: 'pull-request', slots: ['content', 'text'],
      takes: { content: ['fields'], text: ['icon', 'color'] }, fields: { state: PULL_STATES }, shows: ['reviewers', 'review', 'checks', 'blocker'],
      names: { state: 'state of a pull request' }, called: 'the status strip', words: ['status', 'strip', 'blocker'],
      example: { pick: { kind: 'status-strip' }, content: { fields: ['checks', 'blocker', 'reviewers'] } },
    },
    reviewers: {
      what: 'the reviewers on the strip: their size, the avatar or the name', area: 'pull-request', slots: ['text', 'content'], takes: { text: ['size'], content: ['fields'] },
      fields: {}, shows: ['avatar', 'name'], called: 'the reviewers', words: ['reviewer', 'names'], example: { pick: { kind: 'reviewers' }, content: { fields: ['name'] } },
    },
    check: {
      what: 'a check in the list under the strip; the strip counts every check', area: 'pull-request', slots: ['order', 'show', 'text'],
      takes: { order: ['by', 'down', 'group'], show: ['shown'], text: ['icon'] }, fields: { name: 'text', workflow: 'text', state: CHECK_STATES, time: 'count' },
      names: { state: 'state of a check' }, called: 'a check', words: ['checks', 'CI', 'workflow'],
      example: { pick: { kind: 'check', where: { state: ['passed', 'skipped'] } }, show: { shown: false } },
    },
    'pull-facts': {
      what: 'the facts under the title of a pull request', area: 'pull-request', slots: ['content'], takes: { content: ['fields'] }, fields: {},
      shows: ['author', 'branches', 'size', 'github'], called: 'the facts of a pull request', words: ['title', 'branches'],
      example: { pick: { kind: 'pull-facts' }, content: { fields: ['branches', 'size'] } },
    },
    label: {
      what: 'a label of a pull request', area: 'pull-request', slots: ['box', 'text', 'show'], takes: { box: ['color'], text: ['icon'], show: ['shown'] },
      fields: { name: 'text' }, called: 'a label', words: ['tag', 'chip'], example: { pick: { kind: 'label', where: { name: 'bug' } }, box: { color: BLUE } },
    },
    description: {
      what: 'the description of a pull request; "folded": false opens it', area: 'pull-request', slots: ['show', 'window'], takes: { show: ['shown', 'folded'], window: ['width'] },
      fields: {}, called: 'the description', words: ['description', 'body'], example: { pick: { kind: 'description' }, show: { folded: false } },
    },
    'side-section': {
      what: 'a section of the side column of "Classic" and of "Details"', area: 'pull-request', slots: ['order', 'show'], takes: { order: ['first'], show: ['shown'] },
      fields: { id: SIDE_SECTIONS }, id: 'id', names: { id: 'section of the side column' }, called: 'a section of the side column', words: ['side', 'column', 'details'],
      example: { pick: { kind: 'side-section' }, order: { first: ['labels', 'reviewers'] } },
    },
    'conversation-look': {
      what: '"Messages" or "Classic": the one that opens while the user picked none', area: 'conversation', slots: ['order'], takes: { order: ['first'] },
      fields: { look: ['messages', 'classic'] }, id: 'look', names: { look: 'look of the conversation' }, called: 'the look of the conversation', words: ['messages', 'classic', 'mode'],
      example: { pick: { kind: 'conversation-look' }, order: { first: ['classic'] } },
    },
    message: {
      what: 'a message of "Messages": its colour, the parts that show', area: 'conversation', slots: ['box', 'content'], takes: { box: ['color'], content: ['fields'] },
      fields: { author: 'text', type: ['comment', 'review', 'bot'] }, shows: ['avatar', 'name', 'time', 'text', 'reactions'], names: { type: 'kind of message' },
      called: 'a message', words: ['comment', 'bot', 'author'], example: { pick: { kind: 'message', where: { type: 'bot' } }, box: { color: GREY } },
    },
    event: {
      what: 'an event or a commit of the conversation', area: 'conversation', slots: ['text', 'show'], takes: { text: ['icon', 'color'], show: ['shown'] },
      fields: { of: EVENT_KINDS }, names: { of: 'kind of event' }, called: 'an event', words: ['commit', 'push', 'deployment', 'timeline'],
      example: { pick: { kind: 'event', where: { of: 'commit' } }, show: { shown: false } },
    },
    fold: {
      what: 'a fold: the earlier messages, a run of events or of commits', area: 'conversation', slots: ['show'], takes: { show: ['folded'] },
      fields: { of: ['earlier', 'events', 'commits'] }, names: { of: 'fold' }, called: 'a fold', words: ['collapse', 'earlier', 'expand'],
      example: { pick: { kind: 'fold', where: { of: 'events' } }, show: { folded: false } },
    },
    'day-line': {
      what: 'the line of the day between messages', area: 'conversation', slots: ['content', 'show'], takes: { content: ['words'], show: ['shown'] },
      fields: { day: 'text', date: 'text' }, called: 'the day line', words: ['day', 'date'], example: { pick: { kind: 'day-line' }, content: { words: '{day} · {date}' } },
    },
    reaction: {
      what: 'the reactions under a message', area: 'conversation', slots: ['show'], takes: { show: ['shown'] }, fields: {},
      called: 'the reactions', words: ['emoji'], example: { pick: { kind: 'reaction' }, show: { shown: false } },
    },
    'classic-box': {
      what: 'a box of "Classic": its colour and line', area: 'conversation', slots: ['box'], takes: { box: ['color', 'line'] },
      fields: { type: ['comment', 'review', 'bot', 'description'] }, names: { type: 'kind of box' }, called: 'a box of "Classic"', words: ['border'],
      example: { pick: { kind: 'classic-box', where: { type: 'review' } }, box: { line: BLUE } },
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
  },
  areas: {
    diagrams: 'nodes and arrows of the map: words and their size, a picture or film, a button on an arrow',
    processes: 'steps and calls out of the repo of a drawn process: as a node',
    notes: 'note cards and the window of a step: the bar colour, the corners',
    marks: 'a new kind of mark at lines of code, its values and icons, its corner, a button in a corner',
    clicks: 'where a click, Alt+click, Shift+click, double click, key or right-click menu goes; every target',
    windows: 'the window of the pointer: its width, its sections, their order',
    lists: 'what is left out, a pick by a field, the order and groups of rows',
    'side-bar': 'the list "Repo": the Home row, the search at the start, the rows of changes, their order',
    'pull-lines': 'the pull requests under a row of "Repo": a colour by state, fields, avatars, older ones',
    files: 'the tree "Files": folders left out or ordered, a file icon, words after a name, a click',
    'pull-request': 'a pull request: status strip, reviewers, checks, facts, labels, description, side column',
    conversation: 'the conversation of a pull request: Messages or Classic, messages, events, folds, day lines',
  },
  sets: {
    what: 'a new kind of mark: writers mark the lines of code that its rule names, and the icons of its values stand in its corner',
    form: '{ "id": "<small letters and ->", "name": "<a short name>", "rule": "<one or two plain sentences that tell a writer which lines to mark, and which value each gets>", "values": [ { "id": "<id>", "name": "<name>", "icon": "<file of an icon>" } ], "corner": { "node": "<corner>", "note": "<corner>" } }',
    area: 'marks', words: ['mark', 'marks', 'tag', 'category', 'icon'],
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
  called?: string; note?: string; names?: Readonly<Record<string, string>>; id?: string;
};
const componentOf = (kind: LookKind): Component => LOOK_PARTS.components[kind];

/**
 * Kinds that a person may ask for and that a look cannot have, each with the sentence that says why. A badge on a row of "Files" is the same kind
 * as the badge of VS Code's Explorer, which the owner took out.
 */
const NO_KINDS: Readonly<Record<string, string>> = { badge: 'A look cannot put a badge on a row of "Files". Tell the owner so.' };

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
  window?: { width?: number; sections?: string[] };
}

export interface Look {
  sets?: MarkSet[];
  rules: LookRule[];
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
 * The known name that is nearest to a word, when one is close: one or two letters changed, the same first three letters, or a name of several words
 * that holds the word whole ("failing" in "checks failing"); small and capital letters count the same. Of several close names, the one with the
 * fewest letters changed, then the first. Undefined when none is close.
 */
export function nearest(word: string, known: readonly string[]): string | undefined {
  const low = word.toLowerCase();
  let best: { name: string; far: number } | undefined;
  for (const name of known) {
    const far = distance(low, name.toLowerCase());
    const holds = /\s/.test(name) && name.toLowerCase().split(/\s+/).includes(low);
    if (far > 2 && low.slice(0, 3) !== name.toLowerCase().slice(0, 3) && !holds) continue;
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
/** What the sentences of the check call a component: "a node", "a row of a change". */
export const calledOf = (kind: LookKind): string => componentOf(kind).called ?? an(kind);
const Called = (kind: LookKind): string => calledOf(kind).replace(/^./, (first) => first.toUpperCase());
const listed = (names: readonly string[]): string => names.map((one) => `"${one}"`).join(', ');
/** The sentence of a value that a field with fixed values does not have, when the component names the field: "pass" is no state of a check. */
const noValue = (at: string, value: unknown, noun: string, known: readonly string[]): string =>
  `${at}: "${String(value)}" is no ${noun}. The ${noun.split(' ')[0]}s are ${known.join(', ')}.${nearestPart(value, known)}`;
const unknownFields = (value: object, known: readonly string[], at: string): string[] =>
  Object.keys(value).filter((key) => !known.includes(key)).map((key) => `${at}: "${key}" is no field here. Use only ${listed(known)}.${nearestPart(key, known)}`);

/**
 * What is wrong with a look, as sentences that a model can act on: known components and slots, each slot fits its component, known fields with
 * values of their kind, existing paths, node ids and diagram ids, known mark sets, known targets. The files are checked by set-look, which reads them.
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
  if (isObject(pick) && typeof pick.kind === 'string' && Object.hasOwn(NO_KINDS, pick.kind)) return [`${at}: "${pick.kind}" is no kind. ${NO_KINDS[pick.kind]}`];
  if (!isObject(pick) || !LOOK_KINDS.includes(pick.kind as LookKind)) return [`${at}: "pick" must name a "kind": one of ${LOOK_KINDS.join(', ')}.${nearestPart(isObject(pick) ? pick.kind : undefined, LOOK_KINDS)}`];
  const ctx: RuleContext = { kind: pick.kind, component: componentOf(pick.kind), context, sets };
  problems.push(...unknownFields(pick as unknown as Record<string, unknown>, Object.keys(LOOK_PARTS.picks), `${at}, "pick"`));
  const own = ctx.component.slots;
  const slots = Object.keys(rule).filter((key) => key !== 'pick');
  for (const slot of slots) {
    if (!(slot in LOOK_PARTS.slots)) problems.push(`${at}: "${slot}" is no slot. The slots are ${listed(Object.keys(LOOK_PARTS.slots))}.${nearestPart(slot, Object.keys(LOOK_PARTS.slots))}`);
    else if (!own.includes(slot)) problems.push(`${at}: ${calledOf(pick.kind)} has no slot "${slot}". Its slots are ${listed(own)}.${nearestPart(slot, own)}${ctx.component.note ? ` ${ctx.component.note}` : ''}`);
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
  `${at}: ${calledOf(kind)} has no field "${field}". Its fields are ${listed(known)}.${nearestPart(field, known)}`;

/** The problems of the pick "where": known fields of the component, each with a value of its kind or a list of them. */
function whereProblems(where: unknown, at: string, ctx: RuleContext): string[] {
  const fields = ctx.component.fields;
  const names = Object.keys(fields);
  if (!isObject(where) || !Object.keys(where).length) return [`${at}: "where" must be { "<field>": <value> } or { "<field>": [<values>] }, with fields of ${calledOf(ctx.kind)}: ${listed(names)}.`];
  return Object.entries(where).flatMap(([field, value]) => {
    if (!(field in fields)) return [noField(at, ctx.kind, field, names)];
    const kind = fields[field];
    const values = Array.isArray(value) ? value : [value];
    const fits = (one: unknown): boolean => (Array.isArray(kind) ? kind.includes(one as string) : kind === 'count' ? Number.isInteger(one) && (one as number) >= 0 : kind === 'yes' ? typeof one === 'boolean' : isText(one));
    if (values.length && values.every(fits)) return [];
    const noun = ctx.component.names?.[field];
    if (Array.isArray(kind) && noun && values.length) return values.filter((one) => !fits(one)).map((one) => noValue(at, one, noun, kind));
    const wanted = Array.isArray(kind) ? `one of ${listed(kind)}` : kind === 'count' ? 'a whole number' : kind === 'yes' ? 'true or false' : 'words';
    return [`${at}: "${field}" of ${calledOf(ctx.kind)} is ${wanted}, or a list of them.`];
  });
}

/** The problems of one slot of a rule: the fields that its component takes, each with a value of its kind. */
function slotProblems(slot: SlotName, given: unknown, at: string, ctx: RuleContext): string[] {
  const about = LOOK_PARTS.slots[slot] as { one?: boolean; target?: boolean; fields: Record<string, ValueKind> };
  const where = `${at}, "${slot}"`;
  if (about.target) return targetProblems(given, where, ctx.context);
  const fields = Object.keys(about.fields);
  const takes = ctx.component.takes?.[slot] ?? fields;
  if (!isObject(given)) return [`${at}: "${slot}" must be an object with any of ${listed(takes)}.`];
  if (about.one && Object.keys(given).length !== 1) return [`${at}: "${slot}" must hold one of ${listed(takes)}.`];
  const problems = unknownFields(given, fields, where);
  for (const [field, kind] of Object.entries(about.fields)) {
    if (!(field in given)) continue;
    if (!takes.includes(field)) {
      problems.push(`${where}: ${calledOf(ctx.kind)} ${kind === 'yes' ? `cannot be ${field}` : `takes no "${field}" here`}. ${Called(ctx.kind)} takes only ${listed(takes)}.`);
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
        .map((name) => `${at}: the words name the field {${name}}, which ${calledOf(ctx.kind)} does not have. Its fields are ${listed(known)}.${nearestPart(name, known)}`);
    case 'fields': {
      const shows = component.shows ?? known;
      if (!Array.isArray(value) || !value.length || !value.every(isText)) return [`${at}: "${field}" must be a list of the fields of ${calledOf(ctx.kind)} that show, in their order: any of ${listed(shows)}.`];
      // A component that shows its own fields says so as a pick does; one that shows others names what it shows.
      return value.filter((name) => !shows.includes(name)).map((name) => (component.shows
        ? `${at}: ${calledOf(ctx.kind)} shows no field "${name}". It shows ${listed(shows)}.${nearestPart(name, shows)}` : noField(at, ctx.kind, name, known)));
    }
    case 'field': return isText(value) && known.includes(value) ? [] : [noField(at, ctx.kind, String(value), known)];
    case 'ids': {
      if (!(Array.isArray(value) && value.length && value.every(isText))) return wrong;
      // The rows of a component whose rows have fixed names ("order.first" of the sections of the side column) are named by one of them.
      const names = component.id ? component.fields[component.id] : undefined;
      const noun = component.id && component.names?.[component.id];
      return Array.isArray(names) && noun ? value.filter((one) => !names.includes(one)).map((one) => noValue(at, one, noun, names)) : [];
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
      return value.flatMap((one) => {
        if (isObject(one)) return [`${at}: a section of its own comes with a later build. Give the ids of the sections of today: ${listed(own)}.`];
        return own.includes(one) ? [] : [`${at}: "${String(one)}" is no section of the window of ${an(ctx.kind)}. Its sections are ${listed(own)}.${nearestPart(String(one), own)}`];
      });
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
  }
  return problems;
}
