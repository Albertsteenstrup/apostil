// Tests for "apostil hint": what the SessionStart hook of Claude Code prints at the start of a session, on the made-up example and its map.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { setLinks } from '../shared/apostil-link';
import { git, repoId } from '../shared/git';
import { FILE_NOTES_PART, type RepoMap } from '../shared/repo-map';
import { noteKey } from '../shared/notes-beside-code';
import { Store } from '../shared/store';
import { makeTestRepo, runApostil, tempFolder } from '../shared/test-repo';
import { makeCheckExample } from '../view/check-example';
import { READ_MAP_RULES } from './connect-claude-code';
import { hintFor, hintText } from './hint';
import { saveMapDraft } from './save';

const exampleMap = (): RepoMap => JSON.parse(readFileSync(join(__dirname, '../../view/example-map.json'), 'utf8'));
const FIRST_LINE = 'This repo has an Apostil map: notes on the code of 4 files, 3 processes and 5 diagrams. Use it before Grep, Glob or reading files:';

test('apostil hint: in a repo with a map, the JSON of the SessionStart hook with the counts of the map, and --text the text alone; nothing with no map, with the links off, outside a repo or with no store, and it writes nothing', () => {
  const example = makeCheckExample();
  const home = tempFolder('apostil-store-');
  const store = new Store(home);
  assert.deepEqual(saveMapDraft(store, example.folder, exampleMap()).problems, []);
  store.close();
  const hint = (args: string[] = [], cwd = example.folder, env: Record<string, string> = {}) => runApostil(['hint', ...args], { cwd, env: { APOSTIL_HOME: home, ...env } });
  const files = readdirSync(home).sort();

  const json = hint();
  assert.equal(json.status, 0);
  const said = JSON.parse(json.stdout);
  assert.deepEqual(Object.keys(said.hookSpecificOutput), ['hookEventName', 'additionalContext']);
  assert.equal(said.hookSpecificOutput.hookEventName, 'SessionStart');
  const text: string = said.hookSpecificOutput.additionalContext;
  assert.equal(text.split('\n')[0], FIRST_LINE);
  for (const command of ['`apostil overview`', '`apostil find "<words of the task>"`', '`apostil notes <path> --text`', '`apostil process <id> --text`']) assert.ok(text.includes(command), command);
  assert.equal(hint(['--text']).stdout, `${text}\n`);
  assert.equal(hint(['--text'], join(example.folder, 'src')).stdout, `${text}\n`); // from a folder inside the repo too
  assert.deepEqual(readdirSync(home).sort(), files); // it made no file in the store

  // A count of 0 is left out with its words.
  assert.equal(hintText({ ...exampleMap(), processes: [] }).split('\n')[0], FIRST_LINE.replace(', 3 processes and', ' and'));

  const nothing = { status: 0, stdout: '', stderr: '' };
  setLinks(false, home);
  assert.deepEqual(hint(), nothing); // the links and nudges are off
  setLinks(true, home);
  assert.deepEqual(hint([], example.folder, { APOSTIL_NO_LINKS: '1' }), nothing);
  const other = makeTestRepo();
  assert.deepEqual(hint([], other.folder), nothing); // a repo with no map
  assert.deepEqual(hint([], tempFolder('apostil-no-repo-')), nothing); // no Git repo
  const noStore = join(tempFolder('apostil-home-'), 'store');
  assert.deepEqual(hint([], example.folder, { APOSTIL_HOME: noStore }), nothing);
  assert.deepEqual(readdirSync(join(noStore, '..')), []); // no store is made
  other.remove();
  example.remove();
});

test('apostil hint takes well under half a second on a map of 2,000 notes: its own work, Git and the store, in less than 250 ms', () => {
  const example = makeCheckExample();
  const home = tempFolder('apostil-store-');
  const store = new Store(home);
  // 2,000 made-up notes in 200 files, each with five lines of its code, as a writer saves them.
  const fileNotes = Array.from({ length: 2000 }, (_, index) => ({ file: `src/library/part${index % 200}.py`, lines: [index, index + 4] as [number, number], title: `Step ${index} of a loan`, text: 'Checks the member and the copy, then writes the loan with its last day.' }));
  const noteCode = Object.fromEntries(fileNotes.map((_, index) => [noteKey(FILE_NOTES_PART, index), Array.from({ length: 5 }, (__, line) => `    loan_${index}_${line} = check(member, copy, day)`)]));
  store.saveMap(repoId(example.folder), git(example.folder, 'rev-parse', 'HEAD'), { ...exampleMap(), fileNotes, noteCode });
  store.close();
  // The best of three: a busy machine slows one run, not the work. Node itself starts in about 50 ms more.
  const runs = Array.from({ length: 3 }, () => {
    const started = performance.now();
    const text = hintFor(example.folder, home, {});
    return { text, ms: performance.now() - started };
  });
  assert.match(runs[0].text ?? '', /^This repo has an Apostil map: notes on the code of 201 files,/);
  const best = Math.min(...runs.map((run) => run.ms));
  assert.ok(best < 250, `${Math.round(best)} ms`);
  example.remove();
});

test('each command that the hint names, and each that the rules of setup allow, is a command of apostil help', () => {
  const help: string[] = JSON.parse(runApostil(['help']).stdout).commands;
  const named = [...hintText(exampleMap()).matchAll(/`apostil (\w+)/g), ...READ_MAP_RULES.map((rule) => /^Bash\(apostil (\w+)/.exec(rule)!)].map((found) => found[1]);
  assert.deepEqual([...new Set(named)], ['overview', 'find', 'notes', 'process', 'diagram', 'diagrams', 'tests', 'why']);
  for (const name of named) assert.ok(help.some((line) => line.startsWith(`apostil ${name} `)), name);
});
