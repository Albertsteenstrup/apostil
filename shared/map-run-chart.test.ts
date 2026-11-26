// Tests for the chart of a map run, read from a made-up map session of Claude Code in a made-up agent home.

import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  const chart = mapRunChart(run, home, now, { minutesLeft: 7 })!;
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
  const later = transcriptLine(start, 9.7, 'assistant', { message: { id: 'lead-later', model: 'claude-sonnet-5-5' } });
  appendFileSync(files.transcript, later.slice(0, 30));
  assert.deepEqual(mapRunChart(run, home, now)!.lead.thinks.at(-1), span(9, 9.5)); // a half-written line waits for its end
  appendFileSync(files.transcript, later.slice(30));
  assert.deepEqual(mapRunChart(run, home, now)!.lead.thinks.at(-1), span(9, 9.7));

  assert.equal(mapRunChart(homeRun('claude-code', run.startedAt, 'no-transcript-yet'), home, now)?.state, 'waiting');
  assert.equal(mapRunChart(homeRun('codex', run.startedAt, SESSION), home, now), undefined);
  rmSync(home, { recursive: true, force: true });

  const doneHome = madeUpAgentHome();
  madeUpMapSession(doneHome, SESSION, start, true);
  const done = mapRunChart(withEnd(run, new Date(start + 12 * MIN).toISOString())!, doneHome, start + 30 * MIN)!;
  assert.deepEqual([done.state, done.now, done.numbers.running, done.alone.at(-1)], ['done', 12 * MIN, 0, span(10, 12)]);
  rmSync(doneHome, { recursive: true, force: true });
});

test('in a session of his own the chart starts with the writer of the first save and leaves out what the session did before and after the run', () => {
  const start = Date.parse('2026-11-20T08:00:00.000Z');
  const now = start + 10 * MIN;
  const homeOfRun = madeUpAgentHome(); // the same session as a run of Home
  madeUpMapSession(homeOfRun, SESSION, start);
  const homeChart = mapRunChart({ ...homeRun('claude-code', new Date(start).toISOString(), SESSION), savedAt: new Date(start + 9 * MIN).toISOString() }, homeOfRun, now)!;
  rmSync(homeOfRun, { recursive: true, force: true });
  const home = madeUpAgentHome();
  const files = madeUpMapSession(home, SESSION, start);
  const line = (minute: number, type: string, id = ''): string => transcriptLine(start, minute, type, type === 'assistant' ? { message: { id, model: 'claude-sonnet-5-5' } } : { message: { content: 'Other work.' } });
  writeFileSync(files.transcript, line(-130, 'user') + line(-129, 'assistant', 'before') + readFileSync(files.transcript, 'utf8') + line(40, 'user') + line(41, 'assistant', 'after'));
  writeFileSync(`${files.writers}/agent-earlier.jsonl`, line(-120, 'user') + line(-100, 'assistant', 'earlier'));
  writeFileSync(`${files.writers}/agent-later.jsonl`, line(45, 'user') + line(46, 'assistant', 'later'));
  // The service writer saved at minute 3 and so started the record; the first writer of the run started at 0.35.
  const own = { startedAt: new Date(start + 3 * MIN).toISOString(), savedAt: new Date(start + 9 * MIN).toISOString(), whole: true as const, agent: { app: 'claude-code', session: SESSION }, parts: {} };
  const shifted = (spans: { from: number; to: number }[]) => spans.map((span) => ({ from: span.from - 0.35 * MIN, to: span.to - 0.35 * MIN }));
  const chart = mapRunChart(own, home, now)!;
  assert.deepEqual([chart.state, chart.start, chart.now], ['writing', new Date(start + 0.35 * MIN).toISOString(), 9.65 * MIN]);
  assert.deepEqual(chart.writers.map((writer) => writer.id), ['overview', 'notes', 'process', 'service']);
  assert.deepEqual(chart.writers.map(({ from, to }) => ({ from, to })), shifted(homeChart.writers));
  assert.deepEqual(chart.lead.thinks, shifted(homeChart.lead.thinks.slice(1))); // the lead's think before the first writer is not in the run
  assert.deepEqual(chart.numbers, homeChart.numbers);
  const ended = mapRunChart({ ...own, endedAt: new Date(start + 12 * MIN).toISOString() }, home, start + 60 * MIN)!;
  assert.deepEqual([ended.state, ended.now, ended.writers.length, ended.lead.thinks.at(-1)?.to], ['done', 11.65 * MIN, 4, 6.15 * MIN]);
  rmSync(home, { recursive: true, force: true });
});
