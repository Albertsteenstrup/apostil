// Tests for the chart of a map run, read from a made-up map session of Claude Code in a made-up agent home.

import assert from 'node:assert/strict';
import { appendFileSync, rmSync } from 'node:fs';
import { test } from 'node:test';
import { homeRun, withEnd } from './map-run';
import { mapRunChart } from './map-run-chart';
import { madeUpAgentHome, madeUpMapSession, transcriptLine } from './test-repo';

const SESSION = '0f0f0f0f-0000-4000-8000-00000000beef';
const MIN = 60_000;

test('the chart reads the lead, its commands and its writers from the transcripts, with their kinds, tokens, the running writer, the time the lead is alone and the numbers; a line added to a file shows in the next read', () => {
  const home = madeUpAgentHome();
  const start = Date.parse('2026-11-20T08:00:00.000Z');
  const files = madeUpMapSession(home, SESSION, start);
  const run = { ...homeRun('claude-code', new Date(start).toISOString(), SESSION), savedAt: new Date(start + 9 * MIN).toISOString() };
  const now = start + 10 * MIN;
  const chart = mapRunChart(run, home, now, 7)!;
  const span = (from: number, to: number) => ({ from: Math.round(from * MIN), to: Math.round(to * MIN) });
  assert.deepEqual([chart.state, chart.session, chart.now, chart.minutesLeft], ['writing', '0f0f0f0f', 10 * MIN, 7]);
  assert.deepEqual(chart.lead.run, { model: 'sonnet', name: 'Sonnet 5.5', effort: 'medium' });
  assert.deepEqual(chart.lead.thinks, [span(0.03, 0.33), span(0.37, 0.67), span(1.18, 1.5), span(6.02, 6.5), span(9, 10)]); // the last one thinks now
  assert.deepEqual(chart.lead.commands, [span(0.67, 1.17)]);
  assert.equal(chart.lead.busy, Math.round(2.9 * MIN));
  assert.deepEqual(chart.writers.map((writer) => [writer.task, writer.kind, writer.tokens, writer.running, writer.to]),
    [['Overview: made-up repo', 'diagram', 500, false, 4 * MIN], ['Notes: lending-0a1b2c', 'notes', 200, false, 5 * MIN], ['Process: lending-0a1b2c', 'process', 200, true, 10 * MIN], ['Services: lending-0a1b2c', 'service', 100, false, 3 * MIN]]);
  assert.deepEqual(chart.writersRun, { model: 'haiku', name: 'Haiku 5.5', effort: 'medium' });
  assert.deepEqual(chart.alone, [span(0, 0.35)]);
  assert.deepEqual(chart.numbers, { running: 1, done: 3, tokens: 1000 });

  appendFileSync(`${files.writers}/agent-process.jsonl`, transcriptLine(start, 9.5, 'assistant', { message: { id: 'process-late', model: 'claude-haiku-5-5', usage: { output_tokens: 999 } } }));
  appendFileSync(files.transcript, transcriptLine(start, 9.5, 'assistant', { message: { id: 'lead-late', model: 'claude-sonnet-5-5' } }));
  const next = mapRunChart(run, home, now)!;
  assert.equal(next.numbers.tokens, 1999);
  assert.deepEqual(next.lead.thinks.at(-1), span(9, 9.5));

  assert.equal(mapRunChart(homeRun('claude-code', run.startedAt, 'no-transcript-yet'), home, now)?.state, 'waiting');
  assert.equal(mapRunChart(homeRun('codex', run.startedAt, SESSION), home, now), undefined);
  rmSync(home, { recursive: true, force: true });

  const doneHome = madeUpAgentHome();
  madeUpMapSession(doneHome, SESSION, start, true);
  const done = mapRunChart(withEnd(run, new Date(start + 12 * MIN).toISOString())!, doneHome, start + 30 * MIN)!;
  assert.deepEqual([done.state, done.now, done.numbers.running, done.alone.at(-1)], ['done', 12 * MIN, 0, span(10, 12)]);
  rmSync(doneHome, { recursive: true, force: true });
});
