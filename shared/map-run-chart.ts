// The chart of a map run of Claude Code: what the lead session and each writer subagent did, on one time axis. It keeps no state: it is read from
// the transcripts that Claude Code writes and from the record of the run, so the same files give the same chart.

import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { claudeTranscript, sessionName } from './agents';
import { mapRunState, QUIET_MS, sessionCalled, type MapRun } from './map-run';
import { catalogOf, pickOf, sessionPick, type RunPick } from './models';

/** A stretch of time, in milliseconds after the start of the run. */
export interface Span { from: number; to: number }

export type WriterKind = 'diagram' | 'notes' | 'process' | 'service' | 'other';

export interface ChartWriter extends Span {
  id: string;
  task: string; // the description that the lead gave it
  kind: WriterKind;
  run: RunPick;
  running: boolean;
  tokens: number;
}

export interface MapRunChart {
  kind: 'run';
  state: 'waiting' | 'writing' | 'stopped' | 'done'; // waiting: the transcript of the lead is not there yet
  session: string; // what the session is called (sessionCalled)
  start: string; // the start of the run, or of its first writer when that is earlier (mapRunChart)
  now: number; // the end of the chart; after the run ended, its end
  minutesLeft?: number;
  guessLeft?: number; // before the pace is measured: the guessed minutes left, which only set the end of the axis
  lead: { run: RunPick; thinks: Span[]; commands: Span[]; busy: number };
  writers: ChartWriter[]; // in the order of their starts
  writersRun?: RunPick;
  alone: Span[]; // no writer runs
  numbers: { running: number; done: number; tokens: number };
}

const ALONE_MS = 20_000;
const KINDS: Record<string, WriterKind> = { overview: 'diagram', area: 'diagram', notes: 'notes', process: 'process', service: 'service', mark: 'service' };
const FIRST_LINE = /^First run `apostil prompt ([\w-]+)`/;

/** One line of a transcript, with only what the chart reads. */
interface Line {
  type: string;
  at: number;
  text?: string; // a user line whose content is words
  answer?: string; // the id of the answer of an assistant line
  tokens?: number;
  model?: string;
  effort?: string;
  calls: string[]; // the tools that it calls, but a writer
  results: string[]; // the calls that it answers
}

/** The transcript of a session and the folder of its writers, which comes with the first writer. */
export function mapRunFiles(session: string, home: string): { transcript?: string; writers?: string } {
  const transcript = /^[\w-]+$/.test(session) ? claudeTranscript(session, home) : undefined;
  return transcript ? { transcript, writers: join(transcript.slice(0, -'.jsonl'.length), 'subagents') } : {};
}

function lineOf(text: string): Line | undefined {
  let record;
  try { record = JSON.parse(text); } catch { return undefined; } // the last line can be half written
  if (!['user', 'assistant', 'api-request'].includes(record?.type) || typeof record.timestamp !== 'string') return undefined;
  const message = record.message ?? {};
  const blocks: { type?: string; id?: string; name?: string; tool_use_id?: string }[] = Array.isArray(message.content) ? message.content : [];
  return {
    type: record.type, at: Date.parse(record.timestamp),
    ...(typeof message.content === 'string' ? { text: message.content } : {}),
    ...(record.type === 'assistant' ? { answer: message.id, tokens: message.usage?.output_tokens ?? 0, model: message.model, effort: record.effort } : {}),
    calls: blocks.filter((block) => block.type === 'tool_use' && block.name !== 'Agent' && block.name !== 'Task').map((block) => block.id ?? ''),
    results: blocks.filter((block) => block.type === 'tool_result').map((block) => block.tool_use_id ?? ''),
  };
}

const kept = new Map<string, { size: number; mtime: number; read: number; lines: Line[] }>();

/** The lines of a transcript. A transcript only grows, so after a change only the new lines are read; a file that got shorter is read again. */
function linesOf(path: string): Line[] {
  let stat;
  try { stat = statSync(path); } catch { return []; }
  const old = kept.get(path);
  if (old && old.size === stat.size && old.mtime === stat.mtimeMs) return old.lines;
  const from = old && stat.size >= old.read ? old.read : 0;
  const bytes = Buffer.alloc(stat.size - from);
  const file = openSync(path, 'r');
  let got;
  try { got = bytes.subarray(0, readSync(file, bytes, 0, bytes.length, from)); } finally { closeSync(file); }
  const whole = got.lastIndexOf(10) + 1; // up to the last newline: a line after it is half written, and the next read takes it
  const lines = [...(from ? old!.lines : []), ...got.toString('utf8', 0, whole).split('\n').map(lineOf).filter((line): line is Line => !!line)];
  kept.set(path, { size: stat.size, mtime: stat.mtimeMs, read: from + whole, lines });
  return lines;
}

/** The writers of a session with their lines; a writer whose file did not change since `since` is from an earlier run and is not read. */
function writerLines(folder: string | undefined, since: number): [string, Line[]][] {
  let names: string[];
  try { names = readdirSync(folder ?? ''); } catch { return []; } // no writer yet
  return names.filter((name) => /^agent-.+\.jsonl$/.test(name) && (statSync(join(folder!, name), { throwIfNoEntry: false })?.mtimeMs ?? 0) >= since)
    .map((name) => [name.slice('agent-'.length, -'.jsonl'.length), linesOf(join(folder!, name))]);
}

/** The time that some span covers, with overlaps counted once. */
function covered(spans: Span[]): number {
  let total = 0;
  let until = -Infinity;
  for (const span of [...spans].sort((a, b) => a.from - b.from)) {
    total += Math.max(0, span.to - Math.max(span.from, until));
    until = Math.max(until, span.to);
  }
  return total;
}

/**
 * The lead thinks and writes from each request and each user line to its last answer before the next of those; with no answer it is dropped, but the last
 * one stays open to the end while the run writes. It runs a command from the call to its result.
 */
function leadSpans(lines: Line[], at: (time: number) => number, end: number, writing: boolean): { thinks: Span[]; commands: Span[] } {
  const thinks: Span[] = [];
  let from: number | undefined;
  let to: number | undefined;
  for (const line of lines) {
    if (line.type === 'api-request' || line.type === 'user') {
      if (from !== undefined && to !== undefined) thinks.push({ from, to });
      [from, to] = [at(line.at), undefined];
    }
    if (line.type === 'assistant' && from !== undefined) to = at(line.at);
  }
  if (from !== undefined && (to !== undefined || writing)) thinks.push({ from, to: to ?? end });
  const called = new Map<string, number>();
  const commands: Span[] = [];
  for (const line of lines) {
    for (const id of line.calls) called.set(id, at(line.at));
    for (const id of line.results) {
      if (called.has(id)) commands.push({ from: called.get(id)!, to: at(line.at) });
      called.delete(id);
    }
  }
  if (writing) for (const from of called.values()) commands.push({ from, to: end });
  return { thinks, commands };
}

/** A writer from the lines of its transcript and its meta file. */
function writerOf(folder: string, id: string, lines: Line[], at: (time: number) => number, end: number, writing: boolean, catalog: ReturnType<typeof catalogOf>): ChartWriter {
  let meta: { description?: string; finished?: boolean } = {};
  try { meta = JSON.parse(readFileSync(join(folder, `agent-${id}.meta.json`), 'utf8')); } catch { /* not written yet */ }
  const first = lines.find((line) => line.type === 'user')?.text?.match(FIRST_LINE)?.[1];
  const answers = new Map<string, number>();
  for (const line of lines) if (line.answer) answers.set(line.answer, Math.max(answers.get(line.answer) ?? 0, line.tokens ?? 0));
  const last = [...lines].reverse().find((line) => line.model);
  const running = writing && meta.finished !== true;
  return {
    id, task: meta.description ?? '', kind: (first && KINDS[first]) || 'other', run: pickOf(catalog, last?.model, last?.effort ?? 'high'),
    from: at(lines[0].at), to: running ? end : at(lines[lines.length - 1].at), running, tokens: [...answers.values()].reduce((sum, tokens) => sum + tokens, 0),
  };
}

/** The spans of 20 seconds or more from the start to the end in which no writer runs. */
function aloneSpans(writers: Span[], end: number): Span[] {
  const spans: Span[] = [];
  let free = 0;
  for (const writer of writers) {
    if (writer.from - free >= ALONE_MS) spans.push({ from: free, to: writer.from });
    free = Math.max(free, writer.to);
  }
  if (end - free >= ALONE_MS) spans.push({ from: free, to: end });
  return spans;
}

/**
 * The chart of a map run of Claude Code at `now`, read from the files in `home`; undefined for a run with no Claude Code session id. After the run ended,
 * the chart ends at its end (a run that stopped by a quiet time, at its last line). `minutesLeft`: the minutes that Home shows; `guessLeft`: the guess before them; `alive`: as for mapRunState.
 * A session of his own also works before and after the run, so only the lines from the start to the end of the run count, and the writers whose lines
 * reach into that time. The record of such a run starts at its first save, so the chart starts with the first of those writers.
 */
export function mapRunChart(run: MapRun, home: string, now = Date.now(), { minutesLeft, guessLeft, alive }: { minutesLeft?: number; guessLeft?: number; alive?: boolean } = {}): MapRunChart | undefined {
  const agent = run.agent;
  if (agent?.app !== 'claude-code' || !agent.session) return undefined;
  const state = mapRunState(run, now, alive);
  const writing = state === 'writing';
  const started = Date.parse(run.startedAt);
  const until = run.endedAt ? Date.parse(run.endedAt) : writing ? now : Date.parse(run.savedAt ?? run.startedAt) + QUIET_MS;
  const files = mapRunFiles(agent.session, home);
  const ran = writerLines(files.writers, started).filter(([, lines]) => lines.length && lines.at(-1)!.at >= started && lines[0].at <= until);
  const start = Math.min(started, ...ran.map(([, lines]) => lines[0].at));
  const at = (time: number): number => Math.max(0, time - start);
  const leadLines = (files.transcript ? linesOf(files.transcript) : []).filter((line) => line.at >= start && line.at <= until);
  const lastLine = Math.max(...leadLines.map((line) => line.at), ...ran.map(([, lines]) => lines.at(-1)!.at));
  const end = at(run.endedAt ? Date.parse(run.endedAt) : writing ? now : lastLine);
  const catalog = catalogOf('claude-code', home);
  const writers = ran.map(([id, lines]) => writerOf(files.writers!, id, lines, at, end, writing, catalog)).sort((a, b) => a.from - b.from);
  const { thinks, commands } = leadSpans(leadLines, at, end, writing);
  const running = writers.filter((writer) => writer.running).length;
  return {
    kind: 'run', state: files.transcript ? state : 'waiting', session: sessionCalled(agent, sessionName(agent, home)), start: new Date(start).toISOString(), now: end,
    ...(writing && minutesLeft !== undefined ? { minutesLeft } : writing && guessLeft !== undefined ? { guessLeft } : {}),
    lead: { run: sessionPick('claude-code', agent.session, undefined, home), thinks, commands, busy: covered([...thinks, ...commands]) },
    writers, ...(writers[0] ? { writersRun: writers[0].run } : {}), alone: aloneSpans(writers, end),
    numbers: { running, done: writers.length - running, tokens: writers.reduce((sum, writer) => sum + writer.tokens, 0) },
  };
}
