#!/usr/bin/env node
// The "apostil" command: each command prints JSON, but overview, find, why and --text, which print plain text for an agent. Exit code 1 means the command did not do its work.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { agentFromEnv, definedFields } from '../shared/agents';
import type { ChangeFile } from '../shared/change-file';
import { changeRows } from '../shared/change-rows';
import { linksMark } from '../shared/diagram-code';
import { diagramAsText } from '../shared/map-read';
import { diagramGraph } from '../shared/diagram-graph';
import { changeOfFolder, diagramTitles, reviewContext, showDiagram } from '../shared/context';
import { findTests } from '../shared/find-tests';
import { repoFiles, repoId, tryGit, untrackedInRepo } from '../shared/git';
import { readScope } from '../shared/map-scope';
import { whyLine } from '../shared/note-groups';
import { Store, storeFolder, type NewOpenPoint } from '../shared/store';
import { cleanup } from './cleanup';
import { connectClaudeCode } from './connect-claude-code';
import { doctor } from './doctor';
import { hintCommand } from './hint';
import { prHookCommand } from './pr-hook';
import { runIssue } from './issue';
import { setup, thisInstall } from './setup';
import { uninstall } from './uninstall';
import { changeMaterial, forFreshCheck } from './material';
import { runHasNoPerson, sentRemarks, waitForRemarks } from './inbox';
import { LINK_USAGE, linkCommand, linksCommand } from './link-command';
import { compactJson } from '../shared/look-slots';
import { saveIcon } from './icon';
import { MAP_USAGE, runMapCommand } from './map-commands';
import { openInApp } from './open-in-app';
import { PROMPT_USAGE, promptCommand } from './prompt-command';
import { afterSave, readJson } from './read-input';
import { baseFor, checkDraft, namedBase, saveDraft } from './save';

// The launcher of an installed extension runs this file on the Node of the editor. Children (git, code, agents) must not inherit that mode.
delete process.env.ELECTRON_RUN_AS_NODE;

// Each command with its arguments. Every command also takes --folder <path>; the default is the current folder.
const USAGE: Record<string, string> = {
  uninstall: 'apostil uninstall [--dry-run] [--delete-data] (removes Apostil from this computer and keeps your data unless --delete-data; prints lines, not JSON)',
  material: 'apostil material [--base <commit>]',
  check: 'apostil check <draft.json> (or - for the JSON on standard input) [--base <commit>]',
  save: 'apostil save <draft.json> (or - for standard input) [--base <commit>] [--agent <app>] [--session <id>] [--session-name <name>] [--account <name>]',
  'for-check': 'apostil for-check [--part <id>] [--base <commit>]',
  'open-points': 'apostil open-points <points.json> (or - for standard input) [--part <id>]',
  checked: 'apostil checked <diagram id> [<diagram id> ...] [links] [--part <id>]',
  context: 'apostil context [--mark-sent]',
  answer: 'apostil answer <remark id> <text>',
  resolve: 'apostil resolve <remark id> [--agent <app>]',
  remarks: 'apostil remarks',
  diagrams: 'apostil diagrams [--path <prefix>] (the diagrams of the map, the drawings of its processes, and the diagrams of stored changes)',
  diagram: 'apostil diagram <id> [--text] (a diagram of the map or a drawing of the map first, else of a stored change; --text: plain lines, with the code of each node)',
  tests: 'apostil tests <symbol>',
  list: 'apostil list',
  usage: 'apostil usage',
  cleanup: 'apostil cleanup',
  inbox: 'apostil inbox [--wait] [--timeout <seconds>] [--session <id>]',
  open: 'apostil open [folder] (short forms: apostil . and apostil <folder>)',
  connect: 'apostil connect [--all-repos]',
  setup: 'apostil setup [--repo | --all] [--undo] (prints lines, not JSON)',
  doctor: 'apostil doctor (prints lines, not JSON)',
  issue: 'apostil issue --facts | apostil issue --kind bug|feedback --file <issue.md> [--open] (its first line "# <title>"; or --title <words> with the body on standard input)',
  version: 'apostil --version',
  ...LINK_USAGE,
  icon: 'apostil icon <service id> <https address> [--site <its site>] [--other-site] (keeps the picture of the service\'s own site as its icon; an address of a web page gives its link rel="icon")',
  ...MAP_USAGE,
  why: 'apostil why <path> [<path> ...] (plain lines: whether each file gets notes or only its path, and why: the line of .apostilignore that decides, else the rule of the code files)',
  hint: 'apostil hint [--text] (for the SessionStart hook of Claude Code: in a repo with a map, the JSON that tells the agent which commands read the map; --text: the text alone; else nothing, and never exit code 1)',
  'pr-hook': 'apostil pr-hook (for the PostToolUse hook of Claude Code, matcher Bash; reads its JSON on standard input: after a gh pr create that printed a pull request address, the JSON that tells the agent to describe the pull request; else nothing, and never exit code 1)',
  ...PROMPT_USAGE,
};
const POINT_KINDS = ['note-not-supported', 'no-note', 'thing-not-supported'];

/** Says what is wrong with an open point at a node or an arrow of a diagram of the change, or at a link between parts (no "diagram"), or undefined when it names one. */
function thingProblem(file: ChangeFile, point: NewOpenPoint): string | undefined {
  if (point.kind !== 'thing-not-supported') return undefined;
  const [from, to] = point.edge ?? [];
  if (!point.diagram && point.edge) {
    return file.links.some((link) => link.from === from && link.to === to && (point.name === undefined || (link.label ?? '') === point.name))
      ? undefined : `The change has no link from "${from ?? ''}" to "${to ?? ''}"${point.name ? ` with the label "${point.name}"` : ''}. A link names its two parts by id: "edge": [from, to], and its label as "name".`;
  }
  const diagram = (file.diagrams ?? []).find((candidate) => candidate.id === point.diagram);
  if (!diagram) return `A point of the kind thing-not-supported needs "diagram", the id of a diagram of the change; "${point.diagram ?? ''}" is none. A point at a link between parts has "edge" and no "diagram".`;
  const graph = diagramGraph(diagram);
  if (point.node) return point.node in graph.nodes ? undefined : `The diagram "${diagram.id}" has no node "${point.node}".`;
  return graph.edges.some((edge) => edge.from === from && edge.to === to && (point.name === undefined || (edge.label ?? '') === point.name))
    ? undefined : `The diagram "${diagram.id}" has no arrow from "${from ?? ''}" to "${to ?? ''}"${point.name ? ` with the label "${point.name}"` : ''}. Give "node", or "edge": [from, to] and "name".`;
}
const NO_CHANGE = 'This branch has no saved change. Save a change file first.';

const flagText = (flag: string | true | undefined): string | undefined => (typeof flag === 'string' ? flag : undefined);

interface Done {
  output: unknown;
  ok: boolean;
  compact?: true; // printed with compactJson: an agent reads it, and pays for each character
  text?: true; // plain text, printed as it is: the reads of the map for an agent (shared/map-read.ts)
}

const done = (output: unknown, ok = true): Done => ({ output, ok });
const failed = (problem: string): Done => done({ problems: [problem] }, false);

function run(store: Store, command: string, [argument = '', ...more]: string[], folder: string, flags: Record<string, string | true>): Done {
  const part = typeof flags.part === 'string' ? flags.part : undefined;
  if (command in MAP_USAGE) {
    const find = 'find' in flags ? (flagText(flags.find) ?? '') : undefined;
    return runMapCommand(store, command, argument, folder, {
      full: flags.full === true, all: flags.all === true, set: flagText(flags.set), group: flagText(flags.group), check: flags.check === true, find, fit: flags.fit === true,
      text: flags.text === true, limit: 'limit' in flags ? (flagText(flags.limit) ?? '') : undefined, more,
    });
  }
  // --base <commit>: on a main branch, the change is every commit after that one. The save stores it, so later commands need it no more.
  const named = typeof flags.base === 'string' ? namedBase(folder, flags.base) : undefined;
  if (named && 'problem' in named) return failed(named.problem);
  const base = named?.base;
  switch (command) {
    case 'material': return done(changeMaterial(store, folder, base));
    case 'check': {
      const result = checkDraft(folder, readJson(argument), baseFor(store, folder, base), untrackedInRepo(folder, argument), store.getMap(repoId(folder))?.map);
      return done(result, result.problems.length === 0);
    }
    case 'save': {
      const fromFlags = { app: flagText(flags.agent), session: flagText(flags.session), name: flagText(flags['session-name']), account: flagText(flags.account) };
      const result = saveDraft(store, folder, readJson(argument), { ...agentFromEnv(process.env), ...definedFields(fromFlags) }, untrackedInRepo(folder, argument), base);
      cleanup(store, new Date());
      return done(result.saved ? afterSave(result, folder, argument) : result, result.saved);
    }
    case 'for-check': {
      const material = forFreshCheck(store, folder, part, base);
      if (!material) return failed(NO_CHANGE);
      return material.parts.length > 0 ? done(material) : failed(`The change has no part "${part}".`);
    }
    case 'open-points': {
      const change = changeOfFolder(store, folder);
      const points = readJson(argument) as NewOpenPoint[];
      if (!change) return failed(NO_CHANGE);
      if (part && !change.file.parts.some((candidate) => candidate.id === part)) return failed(`The change has no part "${part}".`);
      if (!Array.isArray(points) || !points.every((point) => POINT_KINDS.includes(point?.kind) && point.text)) {
        return failed('The JSON must be a list of { "kind", "text", "file"?, "cell"?, "lines"?, "diagram"?, "node"?, "edge"?, "name"? }. The kind is note-not-supported, no-note or thing-not-supported.');
      }
      const wrong = points.map((point) => thingProblem(change.file, point)).filter(Boolean);
      if (wrong.length) return done({ problems: wrong }, false);
      store.setOpenPoints(change.id, points, part);
      cleanup(store, new Date());
      return done(afterSave({ changeId: change.id, openPoints: points.length }, folder, argument));
    }
    case 'checked': {
      const change = changeOfFolder(store, folder);
      if (!change) return failed(NO_CHANGE);
      const named = [argument, ...more].filter(Boolean);
      const ofParts = (change.file.diagrams ?? []).filter((diagram) => !diagram.broad).map((diagram) => diagram.id);
      const unknown = named.filter((id) => id !== 'links' && !ofParts.includes(id));
      if (!named.length || unknown.length) {
        return failed(`Name the diagrams of a part that you read (${ofParts.join(', ') || 'this change has none'}), or "links" for the links that leave your part.${unknown.length ? ` Not one of them: ${unknown.join(', ')}.` : ''}`);
      }
      // "links": the links that leave the part of --part, or with no part every link of the change.
      const leaving = [...new Set(change.file.links.map((link) => link.from))];
      if (part && !change.file.parts.some((candidate) => candidate.id === part)) return failed(`The change has no part "${part}".`);
      const links = named.includes('links') ? (part ? [part] : leaving).map(linksMark) : [];
      store.markChecked(change.id, [...named.filter((id) => id !== 'links'), ...links]);
      return done({ changeId: change.id, checked: store.getChange(change.id)?.checked ?? [] });
    }
    case 'context': return done(reviewContext(store, folder, flags['mark-sent'] === true));
    case 'answer': {
      const id = Number(argument);
      const text = more.join(' ');
      if (!text) return failed('Usage: apostil answer <remark id> <text>');
      const remark = store.answerRemark(id, text);
      return remark ? done(remark) : failed(`No remark with the id ${argument}.`);
    }
    case 'resolve': {
      const thread = store.threadOf(Number(argument));
      if (!thread.length) return failed(`No remark with the id ${argument}.`);
      store.closeThread(thread[0].id, flagText(flags.agent) ?? agentFromEnv(process.env)?.app ?? 'agent');
      return done(store.threadOf(thread[0].id));
    }
    case 'remarks': {
      const change = changeOfFolder(store, folder);
      return change ? done(store.remarks(change.id)) : failed(NO_CHANGE);
    }
    case 'diagrams': return done(diagramTitles(store, folder, typeof flags.path === 'string' ? flags.path : ''));
    case 'diagram': {
      const shown = showDiagram(store, folder, argument);
      if (!shown) return failed(`No diagram "${argument}" in this repo.`);
      return flags.text === true ? { output: diagramAsText(shown), ok: true, text: true } : done(shown);
    }
    case 'tests': return done(findTests(folder, argument));
    case 'why': {
      const paths = [argument, ...more].filter(Boolean).map((path) => path.replace(/^\.\//, '')); // a path from the top of the repo
      if (!paths.length) return { output: `Usage: ${USAGE.why}`, ok: false, text: true };
      const known = new Set(repoFiles(folder) ?? []);
      const scope = readScope(folder) ?? [];
      return { output: paths.map((path) => whyLine(folder, path, known, scope)).join('\n'), ok: true, text: true };
    }
    case 'connect': {
      const result = connectClaudeCode(flags['all-repos'] === true ? undefined : folder);
      return done(result.problem ? result : { ...result, note: 'The hook was not yet seen working in a session with a person. A run that Apostil starts never waits for it.' }, !result.problem);
    }
    case 'list': return done(changeRows(store, folder));
    case 'usage': return done(store.usage(repoId(folder)));
    default: return done(cleanup(store, new Date()));
  }
}

const isFolder = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();

/** The hook of an agent app sends JSON with session_id and cwd on standard input. */
function hookInput(): { session_id?: string; cwd?: string } {
  if (process.stdin.isTTY) return {};
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

/** The sent remarks of a session; with --wait, waits for them and wakes the agent with exit code 2. */
/** `apostil icon`: the one command that reaches the web. It prints { saved, problem }. */
async function runIcon(store: Store, [id, address]: string[], folder: string, flags: Record<string, string | true>): Promise<Done> {
  if (!id || !address) return failed(`Usage: ${USAGE.icon}`);
  const result = await saveIcon(store, folder, id, address, { site: flagText(flags.site), otherSite: flags['other-site'] === true });
  return done({ saved: result.saved, problem: result.problem ?? null, ...(result.icon ? { icon: result.icon } : {}) }, result.saved);
}

async function runInbox(store: Store, flags: Record<string, string | true>): Promise<Done> {
  const hook = hookInput();
  const session = flagText(flags.session) ?? hook.session_id;
  const folder = resolve(flagText(flags.folder) ?? hook.cwd ?? process.cwd());
  if (flags.wait !== true) return done(sentRemarks(store, session, folder));
  if (runHasNoPerson(process.env)) return done(undefined); // nobody listens in this run, so there is nothing to wait for
  if (!session) return failed('The inbox needs a session: --session <id>, or the JSON of a hook on standard input.');
  const timeoutSeconds = Number(flagText(flags.timeout) ?? 3300);
  const { code, text } = await waitForRemarks(store, { session, folder, pid: process.pid, timeoutSeconds, now: Date.now, sleep: (ms) => new Promise((wake) => setTimeout(wake, ms)) });
  if (text) console.error(text);
  process.exitCode = code;
  return done(undefined);
}

/** setup, doctor and uninstall print lines for a person, not JSON. They use the home folder and the path of this shell. */
function runForPerson(command: string, words: string[]): void {
  const machine = { home: homedir(), path: process.env.PATH ?? '' };
  const at = words.indexOf('--folder');
  const folder = resolve(at >= 0 ? words[at + 1] : process.cwd());
  let result: { lines: string[]; ok: boolean };
  if (command === 'doctor') {
    result = doctor({ folder, machine, install: thisInstall(), cli: __filename, store: storeFolder() });
  } else if (command === 'uninstall') {
    const dryRun = words.includes('--dry-run');
    result = uninstall({ machine, install: thisInstall(), store: storeFolder(), folder, dryRun, deleteData: words.includes('--delete-data') });
    result.lines = dryRun
      ? ['Dry run: nothing changes. apostil uninstall would do this:', ...result.lines, '', 'Run apostil uninstall to do it. Add --delete-data to delete the store too.']
      : [...result.lines, '', 'Restart VS Code and your agent apps, so that none of them keeps Apostil loaded.'];
  } else {
    const repo = words.includes('--all') ? undefined : tryGit(folder, 'rev-parse', '--show-toplevel');
    result = !repo && !words.includes('--all')
      ? { lines: ['This folder is not in a Git repo. Run apostil setup in a repo, or apostil setup --all for every repo.'], ok: false }
      : setup({ install: thisInstall(), machine, repo, undo: words.includes('--undo') });
  }
  console.log(result.lines.join('\n'));
  if (!result.ok) process.exitCode = 1;
}

/** Runs one command. Only `inbox` waits for anything: every other command has done its work and printed when this returns. */
export async function main(args: string[]): Promise<void> {
  const [command, ...words] = args;
  if (command === '--version' || command === 'version') return console.log(thisInstall().version);
  if (['setup', 'doctor', 'uninstall'].includes(command) && !args.includes('--help')) return runForPerson(command, words);
  if (command === 'issue' && !args.includes('--help')) return runIssue(words, __filename);
  // Run by a hook at the start of each session: it prints the hint or nothing, reads no standard input, and never fails.
  if (command === 'hint' && !args.includes('--help')) {
    const at = words.indexOf('--folder');
    const hint = hintCommand(words, resolve((at >= 0 && words[at + 1]) || process.cwd()));
    if (hint) console.log(hint);
    return;
  }
  // Run by a hook after each Bash command: it prints the JSON or nothing, reads standard input only when a hook sends it (never a terminal), and never fails.
  if (command === 'pr-hook' && !args.includes('--help')) {
    let stdin = '';
    try {
      if (!process.stdin.isTTY) stdin = readFileSync(0, 'utf8');
    } catch {
      // no input: nothing to say
    }
    const said = prHookCommand(stdin);
    if (said) console.log(said);
    return;
  }
  // link, links and prompt print text, not JSON; a problem goes to the error output, with exit code 1.
  if (['link', 'links', 'prompt'].includes(command) && !args.includes('--help')) {
    const at = words.indexOf('--folder');
    const { line, problem } = command === 'prompt' ? promptCommand(words[0])
      : command === 'link' ? linkCommand(words, resolve(at >= 0 ? words[at + 1] : process.cwd())) : linksCommand(words[0]);
    if (line) console.log(line);
    if (problem) {
      console.error(problem);
      process.exitCode = 1;
    }
    return;
  }
  const askedForHelp = !command || command === 'help' || args.includes('--help');
  const folderShortForm = !askedForHelp && !(command in USAGE) && isFolder(resolve(command));
  if (askedForHelp || (!(command in USAGE) && !folderShortForm)) {
    const commands = Object.values(USAGE);
    console.log(JSON.stringify(askedForHelp ? { commands } : { problems: [`Unknown command "${command}".`], commands }, null, 1));
    if (!askedForHelp) process.exitCode = 1;
    return;
  }
  if (command === 'open' || folderShortForm) {
    const folder = resolve(command === 'open' ? (words[0] ?? '.') : command);
    if (!isFolder(folder)) {
      console.log(JSON.stringify({ problems: [`The folder ${folder} does not exist.`] }, null, 1));
      process.exitCode = 1;
      return;
    }
    openInApp(folder);
    console.log(JSON.stringify({ opened: folder }, null, 1));
    return;
  }
  const flags: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let index = 0; index < words.length; index++) {
    if (['--folder', '--path', '--part', '--base', '--agent', '--session', '--session-name', '--account', '--timeout', '--set', '--group', '--find', '--site', '--limit'].includes(words[index])) flags[words[index].slice(2)] = words[++index];
    else if (words[index] === '--mark-sent') flags['mark-sent'] = true;
    else if (words[index] === '--wait') flags.wait = true;
    else if (words[index] === '--full') flags.full = true;
    else if (words[index] === '--all') flags.all = true;
    else if (words[index] === '--check') flags.check = true;
    else if (words[index] === '--fit' || words[index] === '--other-site' || words[index] === '--text') flags[words[index].slice(2)] = true;
    else if (words[index] === '--all-repos') flags['all-repos'] = true;
    else if (words[index] === '--remove' || words[index] === '--no-open') flags[words[index].slice(2)] = true;
    else rest.push(words[index]);
  }

  const store = new Store();
  try {
    const { output, ok, compact, text } = command === 'inbox' ? await runInbox(store, flags) : command === 'icon' ? await runIcon(store, rest, resolve(String(flags.folder ?? process.cwd())), flags) : run(store, command, rest, resolve(String(flags.folder ?? process.cwd())), flags);
    if (output !== undefined) console.log(text ? output : compact ? compactJson(output) : JSON.stringify(output, null, 1));
    if (!ok) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ problems: [error instanceof Error ? error.message : String(error)] }, null, 1));
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

if (require.main === module) void main(process.argv.slice(2)); // the tests call main inside their own program
