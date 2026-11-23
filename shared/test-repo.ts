// A small Git repo in a temporary folder, for the tests of every part; made-up notebooks; and the apostil command run inside a test.

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { format } from 'node:util';
import type { ChangeFile } from './change-file';
import { git } from './git';

export interface TestRepo {
  folder: string;
  base: string; // the commit that the branch "feature" started from
  write(path: string, text: string): void;
  commit(message: string): string; // commits every edit and returns the new commit
  remove(): void;
}

/** A new empty temporary folder. */
export const tempFolder = (name = 'apostil-'): string => realpathSync(mkdtempSync(join(tmpdir(), name)));

/**
 * A made-up home folder of the agent apps, for the checks and the example (APOSTIL_AGENT_HOME), never the real one: a catalog of Claude Code in the form
 * of its own (`*-cc.json`, the section "main" and an older model), a catalog that Codex fetched (with an older and a hidden model), and records of
 * sessions: `claude` and `codex` map a session id to the model and effort of its last turn.
 */
export function madeUpAgentHome(sessions: { claude?: Record<string, [string, string?]>; codex?: Record<string, [string, string?]> } = {}, home = tempFolder('apostil-agents-')): string {
  const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
  const claude = (id: string, name: string, family: string, section = 'main') => ({ id, name, section, runtime: { family, effort_levels: efforts, default_effort: 'medium' } });
  const models = [claude('claude-opus-4-8', 'Opus 4.8', 'opus', 'overflow'), claude('claude-opus-5-5', 'Opus 5.5', 'opus'), claude('claude-fable-5-2', 'Fable 5.2', 'fable'), claude('claude-sonnet-5-5', 'Sonnet 5.5', 'sonnet'), claude('claude-haiku-5-5', 'Haiku 5.5', 'haiku')];
  mkdirSync(join(home, '.claude', 'cache', 'model-catalog'), { recursive: true });
  writeFileSync(join(home, '.claude', 'cache', 'model-catalog', 'made-up-cc.json'), JSON.stringify({ version: 2, catalog: { surface: 'cc', config: { models } } }));
  const codex = (slug: string, more: string[] = [], visibility = 'list') => ({ slug, visibility, supported_reasoning_levels: [...efforts, ...more].map((effort) => ({ effort })) });
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'models_cache.json'), JSON.stringify({ models: [codex('gpt-6.1-sol', ['ultra']), codex('gpt-6-astra', ['ultra']), codex('gpt-6.1-terra', ['ultra']), codex('gpt-6-luna'), codex('gpt-5.6-luna'), codex('gpt-made-up-hidden', [], 'hide')] }));
  mkdirSync(join(home, '.gemini', 'antigravity-cli'), { recursive: true });
  writeFileSync(join(home, '.gemini', 'antigravity-cli', 'models.txt'), [
    'gemini-4-neon-high              Gemini 4 Neon (High)',
    'gemini-4-neon-xhigh             Gemini 4 Neon (XHigh)',
    'gemini-4-neon-medium            Gemini 4 Neon (Medium)',
    'gemini-4-neon-low               Gemini 4 Neon (Low)',
    'gemini-4-argon-high             Gemini 4 Argon (High)',
    'gemini-4-argon-medium           Gemini 4 Argon (Medium)',
    'gemini-4-argon-low              Gemini 4 Argon (Low)',
    'gemini-4-hydrogen-high          Gemini 4 Hydrogen (High)',
    'gemini-4-hydrogen-xhigh         Gemini 4 Hydrogen (XHigh)',
    'gemini-4-hydrogen-medium        Gemini 4 Hydrogen (Medium)',
    'gemini-4-hydrogen-low           Gemini 4 Hydrogen (Low)',
    'gemini-pro-orchestrator-neon    Orchestrator (Neon)',
  ].join('\n'));
  for (const [session, [model, effort]] of Object.entries(sessions.claude ?? {})) {
    mkdirSync(join(home, '.claude', 'projects', 'made-up-project'), { recursive: true });
    writeFileSync(join(home, '.claude', 'projects', 'made-up-project', `${session}.jsonl`), `${JSON.stringify({ type: 'user', message: { content: 'Hi' } })}\n${JSON.stringify({ type: 'assistant', message: { model }, ...(effort ? { effort } : {}) })}\n`);
  }
  for (const [session, [model, effort]] of Object.entries(sessions.codex ?? {})) {
    mkdirSync(join(home, '.codex', 'sessions', '2026', '11', '18'), { recursive: true });
    writeFileSync(join(home, '.codex', 'sessions', '2026', '11', '18', `rollout-2026-11-18T09-00-00-${session}.jsonl`), `${JSON.stringify({ type: 'turn_context', payload: { model, ...(effort ? { effort } : {}) } })}\n`);
  }
  return home;
}

/** A made-up line of a Claude Code transcript, `minute` minutes after `start`. */
export const transcriptLine = (start: number, minute: number, type: string, more: object = {}): string =>
  `${JSON.stringify({ type, timestamp: new Date(start + Math.round(minute * 60_000)).toISOString(), ...more })}\n`;

/**
 * A made-up map session of Claude Code in an agent home, as its transcripts stand `start` + 10 minutes: the lead (Sonnet 5.5) thinks, runs one
 * command and starts four writers (Haiku 5.5): an overview, notes, a process writer that still runs, and a service writer. With `ended` the process
 * writer ended at minute 10. Returns the transcript of the lead and the folder of the writers.
 */
export function madeUpMapSession(home: string, session: string, start: number, ended = false): { transcript: string; writers: string } {
  const folder = join(home, '.claude', 'projects', 'made-up-project');
  const writers = join(folder, session, 'subagents');
  mkdirSync(writers, { recursive: true });
  const line = (minute: number, type: string, more: object = {}): string => transcriptLine(start, minute, type, more);
  const answer = (minute: number, id: string, tokens: number, model: string, content: object[] = []): string =>
    line(minute, 'assistant', { effort: 'medium', message: { id, model, content, usage: { output_tokens: tokens } } });
  const result = (minute: number, id: string): string => line(minute, 'user', { message: { content: [{ type: 'tool_result', tool_use_id: id }] } });
  const lead = (minute: number, id: string, content: object[] = []): string => answer(minute, id, 50, 'claude-sonnet-5-5', content);
  const transcript = join(folder, `${session}.jsonl`);
  writeFileSync(transcript, [
    line(0, 'user', { message: { content: 'Write the map of this made-up repo.' } }),
    line(0.03, 'api-request'), lead(0.33, 'lead-1', [{ type: 'tool_use', id: 'agent-1', name: 'Agent', input: {} }]), result(0.35, 'agent-1'),
    line(0.37, 'api-request'), lead(0.67, 'lead-2', [{ type: 'tool_use', id: 'command-1', name: 'Bash', input: {} }]), result(1.17, 'command-1'),
    line(1.18, 'api-request'), lead(1.5, 'lead-3', [{ type: 'tool_use', id: 'agent-2', name: 'Agent', input: {} }]), result(1.52, 'agent-2'),
    line(6, 'user', { message: { content: '<task-notification>A writer ended.</task-notification>' } }),
    line(6.02, 'api-request'), lead(6.5, 'lead-4'),
    line(9, 'api-request'),
    ...(ended ? [lead(10.5, 'lead-5')] : []),
  ].join(''));
  const writer = (id: string, kind: string, task: string, minutes: number[], finished: boolean): void => {
    writeFileSync(join(writers, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'apostil-writer', description: task, model: 'claude-haiku-5-5', ...(finished ? { finished: true } : {}) }));
    writeFileSync(join(writers, `agent-${id}.jsonl`), [
      line(minutes[0], 'user', { message: { content: `First run \`apostil prompt ${kind}\` and follow what it prints.` } }),
      ...minutes.slice(1).map((minute, at) => answer(minute, `${id}-${Math.floor(at / 2)}`, 100 * (at + 1), 'claude-haiku-5-5')),
    ].join(''));
  };
  writer('overview', 'overview', 'Overview: made-up repo', [0.35, 1, 2, 4], true); // tokens 200 + 300
  writer('notes', 'notes', 'Notes: lending-0a1b2c', [1.52, 3, 5], true); // 200
  writer('process', 'process', 'Process: lending-0a1b2c', [1.6, 4, 8, ...(ended ? [10] : [])], ended); // 200 (+ 300)
  writer('service', 'service', 'Services: lending-0a1b2c', [2, 3], true); // 100
  return { transcript, writers };
}

/** A repo in a folder: its files, and a commit of every edit. */
function repoIn(folder: string, base: string): TestRepo {
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  };
  const commit = (message: string): string => {
    git(folder, 'add', '-A');
    git(folder, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message);
    return git(folder, 'rev-parse', 'HEAD');
  };
  return { folder, base, write, commit, remove: () => rmSync(folder, { recursive: true, force: true }) };
}

/**
 * A repo with one commit on "main" and a branch "feature" that is checked out.
 * The branch changes src/app.py, adds src/new_tool.py and adds generated/api.json.
 */
export function makeTestRepo(): TestRepo {
  const made = repoIn(tempFolder('apostil-repo-'), '');
  git(made.folder, 'init', '-q', '-b', 'main');
  made.write('src/app.py', 'def start():\n    return 1\n');
  made.write('README.md', '# Test\n');
  const base = made.commit('base');
  git(made.folder, 'checkout', '-q', '-b', 'feature');
  made.write('src/app.py', 'def start():\n    return 2\n\n\ndef stop():\n    return 0\n');
  made.write('src/new_tool.py', 'def tool():\n    return "tool"\n');
  made.write('generated/api.json', '{}\n');
  made.commit('change');
  return { ...made, base };
}

/** A change file that fits the test repo: two parts, one note, one diagram of new code, one generated folder. */
export const testChangeFile = (): ChangeFile => ({
  format: 1,
  title: 'Adds a stop function and a tool',
  reason: 'The app needs a way to stop.',
  parts: [
    { id: 'app', name: 'App', files: ['src/app.py'], notes: [{ file: 'src/app.py', lines: [5, 6], title: 'Stop the app', symbol: 'stop' }] },
    { id: 'tool', name: 'Tool', files: ['src/new_tool.py'] },
  ],
  links: [{ from: 'app', to: 'tool', lines: 'order' }],
  diagrams: [{
    id: 'stop-flow', kind: 'flow', title: 'How the app stops', part: 'app', file: 'src/app.py', symbol: 'stop',
    mermaid: 'flowchart TD\n  ask["Ask to stop"] --> done(["Return 0"])', nodeLines: { ask: [5, 5], done: [6, 6] }, covers: [5, 6], new: true, // stop() is all new
  }],
  generated: ['generated/'],
});

/** A home folder and a path with stand-ins for the apps: "claude" as a command, "codex" as ~/.codex, "agy" as ~/.gemini/antigravity-cli. */
export function testMachine(apps: { claude?: 'command' | 'folder'; codex?: 'command' | 'folder'; agy?: 'command' | 'folder' } = {}): { home: string; path: string } {
  const home = tempFolder('apostil-home-');
  const bin = tempFolder('apostil-bin-');
  for (const [program, how] of Object.entries(apps)) {
    if (how === 'folder') mkdirSync(join(home, program === 'agy' ? join('.gemini', 'antigravity-cli') : `.${program}`), { recursive: true });
    if (how === 'command') {
      writeFileSync(join(bin, program), '#!/bin/sh\nexit 0\n');
      chmodSync(join(bin, program), 0o755);
    }
  }
  return { home, path: bin };
}

// ----- made-up notebooks: Apostil reads them only, nothing runs them -----

/** One made-up cell: its kind, its lines, and for a newer notebook its id; `out` gives a code cell an output and a run count. */
export interface MadeUpCell { kind: 'code' | 'markdown'; lines: string[]; id?: string; out?: string }

/** A notebook as Jupyter writes it. With `asList` each `source` is a list of lines, as Jupyter writes it; else one string, as some tools write it. */
export function notebookJson(cells: MadeUpCell[], asList = true): string {
  const source = (lines: string[]) => (asList ? lines.map((line, at) => (at < lines.length - 1 ? `${line}\n` : line)) : lines.join('\n'));
  return `${JSON.stringify({
    cells: cells.map((cell, at) => ({
      cell_type: cell.kind, ...(cell.id ? { id: cell.id } : {}), metadata: {}, source: source(cell.lines),
      ...(cell.kind === 'code' ? { execution_count: cell.out ? at + 1 : null, outputs: cell.out ? [{ name: 'stdout', output_type: 'stream', text: [cell.out] }] : [] } : {}),
    })),
    metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } },
    nbformat: 4, nbformat_minor: cells.some((cell) => cell.id) ? 5 : 4,
  }, null, 1)}\n`;
}

const INTRO: MadeUpCell = { kind: 'markdown', id: 'intro', lines: ['# Late fees', 'The fee of each loan that came back late.'] };
const LOAD: MadeUpCell = { kind: 'code', id: 'load', lines: ['import csv', '', "rows = list(csv.reader(open('loans.csv')))"], out: '12 rows' };
const TOTAL: MadeUpCell = { kind: 'code', id: 'total', lines: ['total = sum(fee(int(row[1])) for row in rows)', 'print(total)'], out: '84' };
const SUMMARY: MadeUpCell = { kind: 'markdown', id: 'summary', lines: ['The total is the sum of the fees.'] };

/** The notebooks of the made-up repo at the base, and on its branch. */
export const NOTEBOOKS = {
  before: {
    'notebooks/fees.ipynb': notebookJson([INTRO, LOAD, { kind: 'code', id: 'fee', lines: ['def fee(days):', '    return days * 2'] }, TOTAL,
      { kind: 'code', id: 'old', lines: ['def old_report():', '    print(total)'] }, SUMMARY]),
    'notebooks/older.ipynb': notebookJson([{ kind: 'markdown', lines: ['Loans by month'] }, { kind: 'code', lines: ['months = {}', 'for row in rows:', '    months[row[0]] = 1'] }], false),
    'notebooks/outputs.ipynb': notebookJson([{ kind: 'code', id: 'run', lines: ['print(1 + 1)'], out: '2' }]),
    'notebooks/broken.ipynb': '{ "cells": [ this is not JSON\n',
  },
  now: {
    'notebooks/fees.ipynb': notebookJson([INTRO, SUMMARY, { kind: 'markdown', id: 'rule', lines: ['## The rule', 'A fee is **2** for each day late, and none before the due day.'] }, LOAD,
      { kind: 'code', id: 'fee', lines: ['def fee(days, rate=2):', '    if days <= 0:', '        return 0', '    return days * rate'] }, { ...TOTAL, out: '96' }]),
    'notebooks/older.ipynb': notebookJson([{ kind: 'markdown', lines: ['Loans by month'] }, { kind: 'code', lines: ['months = {}', 'for row in rows:', '    months[row[0]] = months.get(row[0], 0) + 1'] }], false),
    'notebooks/outputs.ipynb': notebookJson([{ kind: 'code', id: 'run', lines: ['print(1 + 1)'], out: '2\n' }]).replace('"execution_count": 1', '"execution_count": 7'),
    'notebooks/broken.ipynb': '{ "cells": [ this is still not JSON\n',
  },
};

/** A repo with the made-up notebooks: the base on "main", and the branch "feature" that changes them. */
export function makeNotebookRepo(): TestRepo {
  const repo = makeTestRepo();
  git(repo.folder, 'checkout', '-q', 'main');
  for (const [path, text] of Object.entries(NOTEBOOKS.before)) repo.write(path, text);
  const base = repo.commit('notebooks');
  git(repo.folder, 'branch', '-q', '-D', 'feature');
  git(repo.folder, 'checkout', '-q', '-b', 'feature');
  for (const [path, text] of Object.entries(NOTEBOOKS.now)) repo.write(path, text);
  repo.commit('the notebooks change');
  return { ...repo, base };
}

/**
 * A clone on "main" whose remote, a bare repo beside it, holds pull request #35 of the branch "made-up/reminders" at refs/pull/35/head, as GitHub keeps one.
 * As over the network, the clone got only the branches of the remote, so it lacks the commits of the pull request. `base`: the commit of main that the pull
 * request starts from; `head`: its last commit. Only local Git: no network.
 */
export function makePullRepo(): TestRepo & { head: string; branch: string; number: number } {
  const root = tempFolder('apostil-pull-');
  git(root, 'init', '-q', '-b', 'main', 'work');
  const work = repoIn(join(root, 'work'), '');
  work.write('src/app.py', 'def start():\n    return 1\n');
  const base = work.commit('base');
  git(root, 'clone', '-q', '--bare', 'work', 'remote.git');
  const branch = 'made-up/reminders';
  git(work.folder, 'checkout', '-q', '-b', branch);
  work.write('src/reminders.py', 'def remind():\n    return "due soon"\n');
  const head = work.commit('reminders');
  git(work.folder, 'push', '-q', join(root, 'remote.git'), 'HEAD:refs/pull/35/head');
  git(root, 'clone', '-q', '--no-local', 'remote.git', 'clone');
  return { ...repoIn(join(root, 'clone'), base), head, branch, number: 35, remove: () => rmSync(root, { recursive: true, force: true }) };
}

/** A change file that fits the notebook repo: notes in cells, by id and by number, a note on removed lines of a cell, and a diagram with places in a cell. */
export const notebookChangeFile = (): ChangeFile => ({
  format: 1,
  title: 'No fee before the due day',
  reason: 'A loan that came back early got a negative fee.',
  parts: [
    {
      id: 'fees', name: 'Fees', files: ['notebooks/fees.ipynb'],
      notes: [
        { file: 'notebooks/fees.ipynb', cell: 'fee', lines: [2, 3], title: 'No fee before the due day', text: 'A loan that comes back early pays nothing.', symbol: 'fee' },
        { file: 'notebooks/fees.ipynb', cell: 'rule', lines: [2, 2], title: 'The rule in words' },
        { file: 'notebooks/fees.ipynb', cell: 'old', lines: [1, 2], removed: true, title: 'The old report is gone' },
      ],
    },
    { id: 'older', name: 'Older notebooks', files: ['notebooks/older.ipynb', 'notebooks/outputs.ipynb', 'notebooks/broken.ipynb'], notes: [{ file: 'notebooks/older.ipynb', cell: 2, lines: [3, 3], title: 'Count each month' }] },
  ],
  links: [{ from: 'older', to: 'fees', label: 'reads rows', lines: 'order' }],
  diagrams: [{
    id: 'fee-flow', kind: 'flow', title: 'How a fee is worked out', part: 'fees', file: 'notebooks/fees.ipynb', symbol: 'fee',
    mermaid: 'flowchart TD\n  early{"Back before the due day?"} -->|yes| none(["No fee"])\n  early -->|no| fee(["Days times the rate"])',
    nodeLines: { early: { cell: 'fee', lines: [2, 2] }, none: { cell: 'fee', lines: [3, 3] }, fee: { cell: 'fee', lines: [4, 4] } },
  }],
});

// ----- the apostil command, run inside the test program -----

/** What a run of the apostil command gives back, as spawnSync gives it. */
export interface CommandRun { status: number; stdout: string; stderr: string }

/**
 * Runs the apostil command inside the test program: no new program starts. `env` sets variables (undefined clears one); the variables of a
 * Claude Code session are cleared unless `env` gives them. `cwd` is the folder it runs in. The output, the exit code, the folder and the
 * variables are put back after. Not for `inbox` and `-`: they read standard input, so their tests start the real program.
 */
export function runApostil(args: string[], { env = {}, cwd }: { env?: Record<string, string | undefined>; cwd?: string } = {}): CommandRun {
  // Loaded here, not at the top: the checks in VS Code use this file too and never run the command.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { main } = require('../store/cli') as typeof import('../store/cli');
  const before = { env: { ...process.env }, cwd: process.cwd(), log: console.log, error: console.error, exitCode: process.exitCode };
  const out: string[] = [];
  const err: string[] = [];
  for (const name of Object.keys(process.env)) if (name === 'CLAUDECODE' || name.startsWith('CLAUDE_CODE_')) delete process.env[name];
  for (const [name, value] of Object.entries(env)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  console.log = (...items: unknown[]) => { out.push(`${format(...items)}\n`); };
  console.error = (...items: unknown[]) => { err.push(`${format(...items)}\n`); };
  process.exitCode = undefined;
  try {
    if (cwd) process.chdir(cwd);
    void main(args); // every command but inbox is done when main returns
    return { status: Number(process.exitCode ?? 0), stdout: out.join(''), stderr: err.join('') };
  } finally {
    process.chdir(before.cwd);
    [console.log, console.error, process.exitCode] = [before.log, before.error, before.exitCode];
    for (const name of Object.keys(process.env)) if (!(name in before.env)) delete process.env[name];
    Object.assign(process.env, before.env);
  }
}
