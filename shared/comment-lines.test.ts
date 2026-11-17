// Tests for what a comment carries to the agent: its diagram as text, a step of a drawn process, what it kept of its thing, the rights of its run and the files that the run changed.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { newRunCommand, resumeCommand } from './agents';
import { diagramText, keptOnMap, MAX_DRAWN_LINES, withKept } from './comment-lines';
import { aboutMapTarget } from './context';
import { changedBetween, workingFiles } from './git';
import type { RepoMap } from './repo-map';
import { makeTestRepo } from './test-repo';

const map: RepoMap = JSON.parse(readFileSync(join(__dirname, '../../view/example-map.json'), 'utf8'));
const process = 'process:list-requests';

test('a comment on a step of a drawn process gets its note, its code and the whole drawing as text; an arrow gets its line', () => {
  const step = aboutMapTarget(map, { kind: 'node', diagram: process, node: 's0' });
  assert.ok(step.includes('Its note: Returns the requests of one member as plain dicts for the purchase team.'), step.join('\n'));
  assert.ok(step.includes('Its code: src/library/web/requests_router.py, lines 23–27'));
  assert.ok(step.includes('- Send the requests of a member → Read the requests of a member: fetch the rows (src/library/web/requests_router.py:26)'));
  const arrow = aboutMapTarget(map, { kind: 'edge', diagram: process, edge: ['s0', 's1'], name: 'make the service' });
  assert.ok(arrow.includes('Its code: src/library/web/requests_router.py, line 25'), arrow.join('\n'));
  // A node of a written diagram of the map gets the drawing as text too, with the folders that its boxes stand for.
  const top = map.diagrams.find((diagram) => !diagram.parent)!;
  const node = Object.keys(top.nodePaths!)[0];
  assert.ok(aboutMapTarget(map, { kind: 'node', diagram: top.id, node }).includes('The diagram as text:'));
});

test('the drawing as text stops after 80 lines and says how many were left out', () => {
  const nodes = Array.from({ length: 70 }, (_, index) => `  n${index}["Box ${index}"]`);
  const edges = Array.from({ length: 30 }, (_, index) => `  n${index} --> n${index + 1}`);
  const lines = diagramText({ id: 'big', kind: 'flow', title: 'Big', mermaid: ['flowchart LR', ...nodes, ...edges].join('\n') });
  assert.equal(lines.length, MAX_DRAWN_LINES + 1);
  assert.equal(lines.at(-1), '(20 more lines left out)');
});

test('a comment whose id is gone, or names another step now, tells the agent what it kept in one line', () => {
  const kept = keptOnMap(map, { kind: 'node', diagram: process, node: 's0' })!;
  assert.deepEqual(kept, { title: 'Send the requests of a member', diagram: 'List the requests of a member', file: 'src/library/web/requests_router.py', lines: [23, 27] });
  const target = withKept({ kind: 'node', diagram: process, node: 's21' }, kept);
  const gone = aboutMapTarget(map, target);
  assert.equal(gone[1], 'The map was written again since this comment. The comment was put on "Send the requests of a member", in the diagram "List the requests of a member", at src/library/web/requests_router.py lines 23-27.');
  // The id names another step now: the line comes too, and the lines of the step that holds the id follow.
  const other = aboutMapTarget(map, { ...target, node: 's1' });
  assert.match(other[1], /^The map was written again since this comment/);
  assert.ok(other.includes('Node "Build the request service"'));
  // A comment that finds its thing as it was gets no such line.
  assert.equal(aboutMapTarget(map, withKept({ kind: 'node', diagram: process, node: 's0' }, kept)).some((line) => line.includes('written again')), false);
});

test('a run that a comment starts may read and edit, or only read, by the setting; the map run keeps its rights', () => {
  const agent = { app: 'claude-code', session: 's1' };
  const rights = (words: string[] = []) => words.slice(words.indexOf('--permission-mode'));
  assert.deepEqual(rights(resumeCommand(agent, 'p', { commentRuns: 'read and edit' })).slice(2),
    ['--allowedTools', 'Bash(apostil *)', 'Read', 'Grep', 'Glob', 'Edit', 'Write']);
  assert.deepEqual(rights(resumeCommand(agent, 'p', { commentRuns: 'read only' })).slice(2),
    ['--allowedTools', 'Bash(apostil *)', 'Read', 'Grep', 'Glob', '--disallowedTools', 'Edit', 'Write', 'NotebookEdit']);
  assert.deepEqual(rights(newRunCommand('claude-code', 'p', {})).slice(2), ['--allowedTools', 'Bash(apostil *)']);
});

test('the files that a run changed come from Git before and after: an edit of a file that was already changed, a new file and a deleted file count; the rest does not', () => {
  const repo = makeTestRepo();
  try {
    repo.write('src/app.py', '# already changed\n');
    const before = workingFiles(repo.folder)!;
    repo.write('src/app.py', '# changed again\n');
    repo.write('src/brand_new.py', 'x = 1\n');
    const after = workingFiles(repo.folder)!;
    assert.deepEqual(changedBetween(before, after), ['src/app.py', 'src/brand_new.py']);
    assert.deepEqual(changedBetween(after, workingFiles(repo.folder)!), []);
  } finally {
    repo.remove();
  }
});
