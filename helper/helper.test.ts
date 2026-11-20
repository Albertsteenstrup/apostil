// Tests for the helper: starts it as a child process and talks to it over standard input and output.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { after, before, test } from 'node:test';
import { checkChangeFile } from '../shared/checks';
import { headCommit, repoId } from '../shared/git';
import { Store } from '../shared/store';
import { makeTestRepo, tempFolder, testChangeFile } from '../shared/test-repo';
import { addNotesToMap, saveMapDraft } from '../store/save';

const repo = makeTestRepo();
const home = tempFolder('apostil-home-');
const child = spawn('node', ['out/helper/helper.js'], { env: { ...process.env, APOSTIL_HOME: home } });
const replies = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
let nextId = 0;

/** Sends one request and returns the reply. */
async function ask(method: string, params: object = {}): Promise<any> {
  const id = ++nextId;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  const reply = JSON.parse(String((await replies.next()).value));
  assert.equal(reply.id, id);
  return reply;
}

/** Calls a tool and returns its result. */
const call = async (name: string, args: object): Promise<any> => (await ask('tools/call', { name, arguments: args })).result;

before(() => {
  const store = new Store(home);
  const file = testChangeFile();
  const id = store.saveChange({
    repoId: repoId(repo.folder), folder: repo.folder, branch: 'feature', base: repo.base, head: headCommit(repo.folder),
    file, checks: checkChangeFile(repo.folder, repo.base, file),
  });
  store.addRemark(id, { kind: 'part', part: 'app', label: 'Part "App"' }, 'Why return 0?');
  store.close();
});

after(() => {
  child.kill();
  repo.remove();
});

test('the protocol: initialize names the server and the tools capability, tools/list gives the six tools with input schemas, an unknown method gets -32601, ping answers and a notification gets no answer', async () => {
  const { result } = await ask('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(result.protocolVersion, '2025-11-25');
  assert.deepEqual(result.capabilities, { tools: {} });
  assert.equal(result.serverInfo.name, 'apostil');

  // Tools/list gives the six tools, each with an input schema.
  {
    const { result } = await ask('tools/list');
    assert.deepEqual(result.tools.map((tool: any) => tool.name), ['review_context', 'diagram_titles', 'show_diagram', 'map_overview', 'find_in_map', 'answer_remark']);
    for (const tool of result.tools) assert.equal(tool.inputSchema.type, 'object');
  }

  // An unknown method gets error -32601.
  assert.equal((await ask('nothing/here')).error.code, -32601);

  // Ping answers and a notification gets no answer.
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  assert.deepEqual((await ask('ping')).result, {});
});

test('the tools: review_context gives a remark once, diagram_titles lists without code, show_diagram gives the code lines, answer_remark marks the remark done, and a failed call returns isError with one sentence', async () => {
  const first = await call('review_context', { folder: repo.folder, mark_sent: true });
  assert.equal(first.isError, false);
  assert.equal(JSON.parse(first.content[0].text).remarks[0].text, 'Why return 0?');
  const second = await call('review_context', { folder: repo.folder });
  assert.equal(JSON.parse(second.content[0].text).remarks.length, 0);

  // Diagram_titles lists the diagram without its code.
  const titles = JSON.parse((await call('diagram_titles', { folder: repo.folder, path: 'src/' })).content[0].text);
  assert.equal(titles[0].id, 'stop-flow');
  assert.equal(titles[0].mermaid, undefined);

  // Show_diagram gives the diagram with its code lines.
  const shown = JSON.parse((await call('show_diagram', { folder: repo.folder, id: 'stop-flow' })).content[0].text);
  assert.equal(shown.code.text, 'def stop():\n    return 0');

  // Answer_remark stores the answer and marks the remark done.
  const store = new Store(home);
  const remarkId = store.remarks(store.allChanges()[0].id)[0].id;
  store.close();
  const answered = await call('answer_remark', { folder: repo.folder, id: remarkId, text: 'Returns 0 on purpose.' });
  assert.equal(answered.isError, false);
  assert.equal(JSON.parse(answered.content[0].text).state, 'done');
  assert.equal((await call('answer_remark', { folder: repo.folder, id: 9999, text: 'x' })).isError, true);

  // A failed tool call returns isError with one sentence.
  const unknownDiagram = await call('show_diagram', { folder: repo.folder, id: 'nothing' });
  assert.equal(unknownDiagram.isError, true);
  assert.match(unknownDiagram.content[0].text, /no diagram/);
  assert.equal((await call('nothing', {})).isError, true);
  assert.equal((await call('review_context', {})).isError, true);
});

test('the tools of the map: map_overview and find_in_map give the plain text of apostil overview and apostil find, and say when the repo has no map', async () => {
  assert.equal((await call('map_overview', { folder: repo.folder })).isError, true); // no map yet
  const store = new Store(home);
  saveMapDraft(store, repo.folder, { format: 1, diagrams: [{ id: 'top', kind: 'flow', title: 'The test repo', mermaid: 'flowchart LR\n  code --> docs', nodePaths: { code: ['src/'], docs: ['README.md'] } }] });
  assert.equal(addNotesToMap(store, repo.folder, { notes: [{ file: 'src/app.py', lines: [5, 6], title: 'Stop the app', text: 'Returns zero.' }] }).saved, true);
  store.close();
  const overview = await call('map_overview', { folder: repo.folder });
  assert.equal(overview.isError, false);
  assert.match(overview.content[0].text, /^diagram top  The test repo\n/);
  assert.equal((await call('find_in_map', { folder: repo.folder, words: 'stop' })).content[0].text, 'Notes (1 of 1 that match):\nsrc/app.py:5-6  Stop the app: Returns zero.');
  assert.equal((await call('find_in_map', { folder: repo.folder })).isError, true);
});
