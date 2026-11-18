// Tests for the newest models of each agent app, their order of size, what a session last used, and the words of a run with a lead and its writers.
// Every catalog and record here is made up, in a temporary home: the real home is never read.

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { mapPrompt } from '../view/agent-run';
import { newRunCommand, resumeCommand, WRITER_AGENT } from './agents';
import { catalogOf, claudeCatalog, codexCatalog, menuOf, nearestEffort, secondSmallest, sessionPick, smallest, teamFrom, teamOf, teamRun, teamSentence } from './models';
import { madeUpAgentHome, tempFolder } from './test-repo';

const ids = (catalog: { models: { id: string }[] }): string[] => catalog.models.map((model) => model.id);

test('the newest models of each app in the order of size, read only from its own catalog: Claude Code its section "main", Codex the newest of each family from the bundled catalog and the one it fetched, hidden ones left out; the smallest and the second smallest, a missing family skipped; the fallbacks with no catalog', () => {
  const home = madeUpAgentHome();
  const claude = claudeCatalog(home);
  assert.deepEqual(claude.models.map((model) => `${model.id} ${model.name} ${model.efforts.join(',')}`), [
    'haiku Haiku 5.5 low,medium,high,xhigh,max', 'sonnet Sonnet 5.5 low,medium,high,xhigh,max', 'opus Opus 5.5 low,medium,high,xhigh,max', 'fable Fable 5.2 low,medium,high,xhigh,max',
  ]); // the catalog lists the older Opus 4.8 (not in "main"), then Opus, Fable, Sonnet, Haiku: the families stand in the order of size, smallest first, and Opus 4.8 is not offered
  assert.deepEqual([claude.names['claude-opus-4-8'], claude.ids['claude-haiku-5-5'], smallest('claude-code', claude)?.id, secondSmallest('claude-code', claude)?.id], ['Opus 4.8', 'haiku', 'haiku', 'sonnet']);

  // Codex: the fetched catalog has Terra 6.1, Sol 6.1, Astra 6, Luna 6 and 5.6 and a hidden one; the bundled one adds a newer Sol and a hidden newer Luna.
  const bundled = JSON.stringify({ models: [{ slug: 'gpt-6.2-sol', visibility: 'list', supported_reasoning_levels: [{ effort: 'high' }, { effort: 'ultra' }] }, { slug: 'gpt-7-luna', visibility: 'hide' }, { slug: 'gpt-5.5', visibility: 'list' }] });
  const codex = codexCatalog(home, bundled);
  assert.deepEqual(codex.models.map((model) => `${model.id} ${model.name}`), ['gpt-6-luna Luna 6', 'gpt-6.1-terra Terra 6.1', 'gpt-6.2-sol Sol 6.2', 'gpt-6-astra Astra 6']);
  assert.deepEqual([codex.models[0].efforts.includes('ultra'), codex.models[2].efforts], [false, ['high', 'ultra']]);
  assert.deepEqual([smallest('codex', codex)?.id, secondSmallest('codex', codex)?.id], ['gpt-6-luna', 'gpt-6.1-terra']);

  // A family that the catalog lacks is skipped: no Sonnet makes Opus the second smallest; no Terra makes Sol the second smallest.
  const lean = tempFolder('apostil-agents-');
  mkdirSync(join(lean, '.claude', 'cache', 'model-catalog'), { recursive: true });
  const model = (id: string, name: string, family: string) => ({ id, name, section: 'main', runtime: { family, effort_levels: ['low', 'high', 'max'] } });
  writeFileSync(join(lean, '.claude', 'cache', 'model-catalog', 'made-up-cc.json'), JSON.stringify({ catalog: { config: { models: [model('claude-opus-5-5', 'Opus 5.5', 'opus'), model('claude-haiku-5-5', 'Haiku 5.5', 'haiku')] } } }));
  assert.deepEqual([smallest('claude-code', claudeCatalog(lean))?.id, secondSmallest('claude-code', claudeCatalog(lean))?.id], ['haiku', 'opus']);
  const noTerra = codexCatalog(lean, JSON.stringify({ models: [{ slug: 'gpt-6-sol', visibility: 'list' }, { slug: 'gpt-6-luna', visibility: 'list' }] }));
  assert.deepEqual([smallest('codex', noTerra)?.id, secondSmallest('codex', noTerra)?.id], ['gpt-6-luna', 'gpt-6-sol']);

  // With no catalog: Claude Code the four aliases with their family names and low to max, not read; Codex its small model only.
  const empty = tempFolder('apostil-agents-');
  const fallback = claudeCatalog(empty);
  assert.deepEqual([fallback.read, fallback.models.map((one) => `${one.id} ${one.name}`).join(', '), fallback.models[0].efforts.join()], [false, 'haiku Haiku, sonnet Sonnet, opus Opus, fable Fable', 'low,medium,high,xhigh,max']);
  assert.deepEqual(ids(codexCatalog(empty, undefined)), ['gpt-6-luna']);
  assert.equal(catalogOf('opencode', empty), undefined); // OpenCode keeps its own models
});

test('a known session starts with the model and the effort that its own record says it last used, named from the catalog; one whose model is unknown, and a new session, take the setting at high; an effort that a model does not take falls to the nearest lower one', () => {
  const home = madeUpAgentHome({ claude: { 'made-up-s1': ['claude-opus-5-5', 'xhigh'], 'made-up-s2': ['claude-opus-4-8'] }, codex: { 'made-up-t1': ['gpt-6.1-sol', 'ultra'] } });
  assert.deepEqual(sessionPick('claude-code', 'made-up-s1', 'haiku', home), { model: 'opus', name: 'Opus 5.5', effort: 'xhigh' });
  assert.deepEqual(sessionPick('claude-code', 'made-up-s2', 'haiku', home), { model: 'claude-opus-4-8', name: 'Opus 4.8', effort: 'high' }); // an older model: no effort in its record
  assert.deepEqual(sessionPick('claude-code', 'made-up-none', 'haiku', home), { model: 'haiku', name: 'Haiku 5.5', effort: 'high' });
  assert.deepEqual(sessionPick('codex', 'made-up-t1', 'gpt-6-luna', home), { model: 'gpt-6.1-sol', name: 'Sol 6.1', effort: 'ultra' });
  assert.deepEqual(menuOf('codex', 'gpt-6-luna', home).fresh, { model: 'gpt-6-luna', name: 'Luna 6', effort: 'high' });
  assert.deepEqual(menuOf('opencode', 'made-up/small', home), { list: [], fresh: { model: 'made-up/small', name: 'made-up/small', effort: 'high' } });
  assert.deepEqual([nearestEffort(['low', 'high', 'max'], 'ultra'), nearestEffort(['low', 'high', 'max'], 'medium'), nearestEffort(['high'], 'low')], ['max', 'low', 'high']);
});

test('a map run is led by the second smallest model at the most effort and every writer runs on the smallest at the most effort: the lead in the run words, the writers in the prompt and, for Claude Code, in --agents; a description run has the same lead and writers, also when it continues a session; a choice of a page changes only the lead and its effort, and counts only with models of the catalog', () => {
  const home = madeUpAgentHome();
  const claude = teamOf('claude-code', home);
  assert.deepEqual([claude.lead, claude.writer, claude.effort], ['sonnet', 'haiku', 'max']);
  const map = newRunCommand('claude-code', mapPrompt(false, claude), { claudeModel: 'haiku', diagrams: true, ...teamRun(claude) })!;
  assert.deepEqual(map.slice(map.indexOf('--model'), map.indexOf('--model') + 4), ['--model', 'sonnet', '--effort', 'max']);
  assert.deepEqual(JSON.parse(map[map.indexOf('--agents') + 1])[WRITER_AGENT], {
    description: 'A writer or checker of Apostil: it writes or checks one part of a map or a description, as the prompt of its task says.',
    prompt: 'Do the task that the lead gives you, as its prompt says, and nothing more.', model: 'haiku', effort: 'max',
  });
  assert.match(map[2], /You lead on Sonnet 5\.5 at max effort: you start, check and correct the writers, and you write no part yourself\. Start every writer and checker subagent on Haiku 5\.5 at max effort: start each one as the agent apostil-writer/);

  // Codex: Terra leads at max, Luna writes at max; its spawn_agent takes the model and the effort of a subagent.
  const codex = teamOf('codex', home);
  const codexMap = newRunCommand('codex', mapPrompt(false, codex), { codexModel: 'gpt-6-luna', diagrams: true, ...teamRun(codex) })!;
  assert.deepEqual(codexMap.slice(-8), ['-c', 'agents.max_threads=16', '-c', 'agents.max_concurrent_threads_per_session=16', '-c', 'model="gpt-6.1-terra"', '-c', 'model_reasoning_effort="max"']); // 16 writers at once, for this run alone
  assert.match(codexMap[2], /Start every writer and checker subagent on Luna 6 at max effort: start each one with spawn_agent, with model "gpt-6-luna" and reasoning_effort "max"\./);
  // OpenCode keeps its own model and small model: no model, and the words of the skill.
  const opencode = teamOf('opencode', home);
  assert.deepEqual([newRunCommand('opencode', 'Map', Object.assign({ opencodeModel: 'made-up/small', diagrams: true as const }, teamRun(opencode)))?.slice(-2), teamSentence(opencode, WRITER_AGENT)], [['--format', 'json'], '']);

  // A description: the same lead and writers; a session that it continues takes the lead's model.
  const described = resumeCommand({ app: 'claude-code', session: 's1' }, 'Describe pull request #35 for Apostil', { claudeModel: 'haiku', describe: true, ...teamRun(claude) })!;
  assert.deepEqual(described.slice(7, 11), ['--model', 'sonnet', '--effort', 'max']);
  assert.equal(JSON.parse(described[described.indexOf('--agents') + 1])[WRITER_AGENT].model, 'haiku');
  assert.deepEqual(resumeCommand({ app: 'codex', session: 't1' }, 'Describe', { describe: true, ...teamRun(codex) })?.slice(-4), ['-c', 'model="gpt-6.1-terra"', '-c', 'model_reasoning_effort="max"']);

  // A choice from the control: Opus leads at Extra, and the writers stay on Haiku at Max; a model that the catalog does not have, or another app, gives the default.
  assert.deepEqual(teamRun(teamFrom('claude-code', { app: 'claude-code', lead: 'opus', effort: 'xhigh' }, home)), { model: 'opus', effort: 'xhigh', writers: { model: 'haiku', effort: 'max' }, opencodeModel: undefined });
  assert.deepEqual([teamFrom('claude-code', { app: 'claude-code', lead: '--danger', effort: 'ultra' }, home).lead, teamFrom('claude-code', { app: 'codex', lead: 'opus' }, home).lead], ['sonnet', 'sonnet']);
  // A writer that a page sends is ignored, and the writers keep Max when the lead runs at Low.
  assert.deepEqual(teamRun(teamFrom('claude-code', { app: 'claude-code', lead: 'opus', writer: 'sonnet', effort: 'low' }, home)), { model: 'opus', effort: 'low', writers: { model: 'haiku', effort: 'max' }, opencodeModel: undefined });
  // Codex: Sol may lead at Ultra, and Luna, which has no Ultra, writes at Max. A smallest model with no Max writes at the most that it takes.
  assert.deepEqual(teamRun(teamFrom('codex', { app: 'codex', lead: 'gpt-6.1-sol', effort: 'ultra' }, home)).writers, { model: 'gpt-6-luna', effort: 'max' });
  const noMax = [{ id: 'gpt-6-luna', name: 'Luna 6', efforts: ['low', 'high'] }, { id: 'gpt-6.1-terra', name: 'Terra 6.1', efforts: ['low', 'max'] }];
  assert.deepEqual(teamRun({ app: 'codex', lead: 'gpt-6.1-terra', writer: 'gpt-6-luna', effort: 'low', list: noMax }).writers, { model: 'gpt-6-luna', effort: 'high' });
});

test('a comment run that continues a session gives no model when he did not change it, and the effort; with a model that he chose, both; a new session the chosen model', () => {
  const same = resumeCommand({ app: 'claude-code', session: 's1' }, 'Do it', { claudeModel: 'haiku', effort: 'max' })!;
  assert.deepEqual([same.includes('--model'), same[same.indexOf('--effort') + 1], same.includes('--agents')], [false, 'max', false]);
  assert.deepEqual(resumeCommand({ app: 'claude-code', session: 's1' }, 'Do it', { claudeModel: 'haiku', model: 'opus', effort: 'max' })?.slice(2, 4).concat(resumeCommand({ app: 'claude-code', session: 's1' }, 'Do it', { model: 'opus', effort: 'max' })!.slice(7, 11)), ['--resume', 's1', '--model', 'opus', '--effort', 'max']);
  assert.deepEqual(resumeCommand({ app: 'codex', session: 't1' }, 'Do it', { codexModel: 'gpt-6-luna', effort: 'xhigh' })?.slice(-2), ['-c', 'model_reasoning_effort="xhigh"']);
  assert.deepEqual(resumeCommand({ app: 'codex', session: 't1' }, 'Do it', { model: 'gpt-6.1-sol', effort: 'ultra' })?.slice(0, 4).concat(resumeCommand({ app: 'codex', session: 't1' }, 'Do it', { model: 'gpt-6.1-sol', effort: 'ultra' })!.slice(-4)),
    ['codex', 'exec', 'resume', 't1', '-c', 'model="gpt-6.1-sol"', '-c', 'model_reasoning_effort="ultra"']);
  assert.deepEqual(resumeCommand({ app: 'opencode', session: 'o1' }, 'Do it', { model: 'made-up/large', effort: 'high' })?.slice(-2), ['--model', 'made-up/large#high']);
  assert.deepEqual(newRunCommand('claude-code', 'Do it', { claudeModel: 'haiku', model: 'fable', effort: 'low' })?.slice(5, 9), ['--model', 'fable', '--effort', 'low']);
});
