// The newest models of each agent app, read only from the app's own catalog, in the order of their size; the model and the effort that a session last
// used; and the choice of a run (a model and an effort; for a map and a description those of the lead, whose writers are fixed). Every run takes its model and effort from
// here, and `modelWords()` in agents.ts turns them into the words of the app.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { claudeTranscript, newestLine } from './agents';

/** One model of a menu: what a run passes (an alias of Claude Code, the slug of a Codex model), its name for a person, and the efforts that it takes. */
export interface ModelInfo { id: string; name: string; efforts: string[] }

/** What a catalog gives: the newest model of each family in the order of size, the names of all its models (older ones too), and the full ids of the newest. */
export interface Catalog {
  models: ModelInfo[];
  names: Record<string, string>; // by id and by full id: "haiku" and "claude-haiku-5-5" are "Haiku 5.5", "claude-opus-4-8" is "Opus 4.8"
  ids: Record<string, string>; // a full id of a newest model to its id in the menu: "claude-haiku-5-5" is "haiku"
  read: boolean; // false: the catalog could not be read, and this is the fallback
}

/** A choice of a run: the model (missing: the session keeps its own, or the app takes its own settings) and the effort. */
export interface RunPick { model?: string; name?: string; effort?: string }

/** The choice of a map run or a description run: the lead and its effort, which a page may change, and the model of its writer subagents, which it may not. */
export interface Team { app: string; lead?: string; writer?: string; effort: string; list: ModelInfo[] }

/** The order of the families, smallest first. The catalogs name each model's family, not its size, so the order is fixed here. */
export const SIZES: Record<string, string[]> = {
  'claude-code': ['haiku', 'sonnet', 'opus', 'fable'],
  codex: ['luna', 'terra', 'sol', 'astra'],
  antigravity: ['gemini-4-hydrogen', 'gemini-4-argon', 'gemini-4-neon', 'gemini-3.8-flash', 'claude-sonnet-5-5', 'claude-opus-5-5'],
};

/** Every effort that an app knows, lowest first. A model that does not take an effort takes the nearest lower one. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** The folder whose catalogs and session records are read: the home folder, or APOSTIL_AGENT_HOME for the checks (never the real one there). */
export const agentHome = (): string => process.env.APOSTIL_AGENT_HOME || homedir();

/** The effort that a model takes for a wanted one: the same, else the nearest lower one, else its lowest. */
export function nearestEffort(efforts: string[], wanted: string): string {
  if (!efforts.length || efforts.includes(wanted)) return wanted;
  const at = EFFORTS.indexOf(wanted);
  return [...efforts].reverse().find((one) => EFFORTS.indexOf(one) <= at) ?? efforts[0];
}

/** The models of a catalog in the order of size: the known families smallest first, then any other family in the order of the catalog. */
const bySize = (app: string, models: (ModelInfo & { family: string })[]): ModelInfo[] => {
  const order = SIZES[app] ?? [];
  const rank = (family: string): number => (order.includes(family) ? order.indexOf(family) : order.length);
  return models.map((model, at) => ({ model, at })).sort((a, b) => rank(a.model.family) - rank(b.model.family) || a.at - b.at)
    .map(({ model: { id, name, efforts } }) => ({ id, name, efforts }));
};

/** The smallest model of a catalog: the newest of the first family of the order that it has; with none of them, its first model. */
export const smallest = (app: string, catalog: Catalog): ModelInfo | undefined => sized(app, catalog)[0] ?? catalog.models[0];
/** The second smallest: the newest of the next family that the catalog has; with only one family, the smallest. */
export const secondSmallest = (app: string, catalog: Catalog): ModelInfo | undefined => sized(app, catalog)[1] ?? smallest(app, catalog);
const sized = (app: string, catalog: Catalog): ModelInfo[] => catalog.models.filter((model) => (SIZES[app] ?? []).includes(familyOf(app, model.id)));
const familyOf = (app: string, id: string): string => (app === 'codex' ? codexFamily(id)?.family ?? '' : id);

// ----- Claude Code -----

const CLAUDE_FALLBACK: Catalog = {
  models: SIZES['claude-code'].map((family) => ({ id: family, name: family.charAt(0).toUpperCase() + family.slice(1), efforts: CLAUDE_EFFORTS })),
  names: Object.fromEntries(SIZES['claude-code'].map((family) => [family, family.charAt(0).toUpperCase() + family.slice(1)])), ids: {}, read: false,
};

type ClaudeModel = { id?: string; name?: string; section?: string; runtime?: { family?: string; effort_levels?: string[] } };

/**
 * The catalog that Claude Code's own model picker uses: the newest file `*-cc.json` (surface "cc") in ~/.claude/cache/model-catalog, read only. Its models
 * in the section "main" are the newest of each family; a run passes the family alias, which Claude Code takes as the latest model of that family.
 * The names of the files hold an account id: they are read, never kept or shown.
 */
export function claudeCatalog(home = agentHome()): Catalog {
  const folder = join(home, '.claude', 'cache', 'model-catalog');
  try {
    const newest = readdirSync(folder).filter((name) => name.endsWith('-cc.json'))
      .map((name) => ({ path: join(folder, name), at: statSync(join(folder, name)).mtimeMs })).sort((a, b) => b.at - a.at)[0];
    const all = (JSON.parse(readFileSync(newest.path, 'utf8'))?.catalog?.config?.models ?? []) as ClaudeModel[];
    const names: Record<string, string> = {};
    const ids: Record<string, string> = {};
    const main: (ModelInfo & { family: string })[] = [];
    for (const model of all) {
      if (typeof model.id !== 'string' || typeof model.name !== 'string') continue;
      names[model.id] = model.name;
      const family = model.runtime?.family ?? '';
      if (model.section !== 'main' || !family || main.some((one) => one.family === family)) continue;
      const id = SIZES['claude-code'].includes(family) ? family : model.id; // the alias of a known family; any other by its full id
      names[id] = model.name;
      ids[model.id] = id;
      main.push({ id, name: model.name, efforts: model.runtime?.effort_levels?.length ? model.runtime.effort_levels : CLAUDE_EFFORTS, family });
    }
    return main.length ? { models: bySize('claude-code', main), names, ids, read: true } : CLAUDE_FALLBACK;
  } catch {
    return CLAUDE_FALLBACK;
  }
}

// ----- Codex -----

/** The family and the version of a Codex slug, "gpt-<version>-<family>": gpt-6.1-terra is terra 6.1. */
const codexFamily = (slug: string): { family: string; version: number[] } | undefined => {
  const parts = /^gpt-(\d+(?:\.\d+)*)-([a-z]+)$/.exec(slug);
  return parts ? { family: parts[2], version: parts[1].split('.').map(Number) } : undefined;
};
const newer = (a: number[], b: number[]): boolean => {
  for (let at = 0; at < Math.max(a.length, b.length); at++) if ((a[at] ?? 0) !== (b[at] ?? 0)) return (a[at] ?? 0) > (b[at] ?? 0);
  return false;
};
/** The name of a Codex model for a person: "Terra 6.1" for gpt-6.1-terra; a slug of another form stays as it is. */
export const codexName = (slug: string): string => {
  const parts = codexFamily(slug);
  return parts ? `${parts.family.charAt(0).toUpperCase()}${parts.family.slice(1)} ${parts.version.join('.')}` : slug;
};

const CODEX_SMALL = 'gpt-6-luna';
const codexFallback = (): Catalog => ({ models: [{ id: CODEX_SMALL, name: codexName(CODEX_SMALL), efforts: CLAUDE_EFFORTS }], names: { [CODEX_SMALL]: codexName(CODEX_SMALL) }, ids: {}, read: false });

type CodexModel = { slug?: string; visibility?: string; supported_reasoning_levels?: { effort?: string }[] };
const codexModelsOf = (text: string | undefined): CodexModel[] => {
  try {
    const models = text ? JSON.parse(text)?.models : undefined;
    return Array.isArray(models) ? models : [];
  } catch {
    return [];
  }
};

/** The catalog that ships with Codex: `codex debug models --bundled` prints it with no refresh, no network and no write. Never without `--bundled`. */
export function codexBundled(): string | undefined {
  const run = spawnSync('codex', ['debug', 'models', '--bundled'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  return run.status === 0 ? run.stdout : undefined;
}

/**
 * The newest Codex model of each family: the models with visibility "list" from the bundled catalog and from the catalog that Codex fetched
 * (models_cache.json in ~/.codex, or in CODEX_HOME for the real home; read only), and of each family the newest version. A hidden model never shows.
 */
export function codexCatalog(home: string, bundled: string | undefined): Catalog {
  let cache: string | undefined;
  const folder = (home === homedir() && process.env.CODEX_HOME) || join(home, '.codex');
  try { cache = readFileSync(join(folder, 'models_cache.json'), 'utf8'); } catch { /* none yet */ }
  const newest = new Map<string, { model: ModelInfo & { family: string }; version: number[] }>();
  const names: Record<string, string> = {};
  for (const model of [...codexModelsOf(cache), ...codexModelsOf(bundled)]) { // the fetched catalog first: it wins for a slug that both have
    const parts = typeof model.slug === 'string' && model.visibility === 'list' ? codexFamily(model.slug) : undefined;
    if (!parts) continue;
    names[model.slug!] = codexName(model.slug!);
    const efforts = (model.supported_reasoning_levels ?? []).map((level) => level.effort).filter((one): one is string => typeof one === 'string');
    const kept = newest.get(parts.family);
    if (kept && !newer(parts.version, kept.version)) continue;
    newest.set(parts.family, { model: { id: model.slug!, name: codexName(model.slug!), efforts: efforts.length ? efforts : CLAUDE_EFFORTS, family: parts.family }, version: parts.version });
  }
  if (!newest.size) return codexFallback();
  return { models: bySize('codex', [...newest.values()].map((one) => one.model)), names, ids: {}, read: true };
}

// ----- Antigravity -----

const ANTIGRAVITY_SMALL = 'gemini-4-hydrogen';
const ANTIGRAVITY_EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const antigravityFallback = (): Catalog => ({
  models: [{ id: ANTIGRAVITY_SMALL, name: 'Gemini 4 Hydrogen', efforts: ANTIGRAVITY_EFFORTS }],
  names: { [ANTIGRAVITY_SMALL]: 'Gemini 4 Hydrogen' }, ids: {}, read: false,
});

/** The models that Antigravity lists: `agy models` prints `<slug>  <name>` lines. */
export function antigravityBundled(): string | undefined {
  const run = spawnSync('agy', ['models'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  return run.status === 0 ? run.stdout : undefined;
}

/**
 * The models of Antigravity, grouped by base id from `agy models` (or a test fixture in `~/.gemini/antigravity-cli/models.txt`):
 * slugs `gemini-4-hydrogen-low`..`gemini-4-hydrogen-xhigh` become one menu item `gemini-4-hydrogen` ("Gemini 4 Hydrogen") with its efforts.
 */
export function antigravityCatalog(home: string, listed: string | undefined): Catalog {
  let text = listed;
  try { text = readFileSync(join(home, '.gemini', 'antigravity-cli', 'models.txt'), 'utf8'); } catch { /* use listed */ }
  if (!text) return antigravityFallback();
  const grouped = new Map<string, { name: string; efforts: Set<string> }>();
  const names: Record<string, string> = {};
  const ids: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const clean = raw.slice(raw.lastIndexOf('\r') + 1).trim();
    const pair = /^([a-z0-9._-]+)\s+(.+)$/.exec(clean);
    if (!pair) continue;
    const [, slug, rawName] = pair;
    const split = /^(.+)-(low|medium|high|xhigh|max)$/.exec(slug);
    if (!split) continue;
    const [, id, effort] = split;
    const name = rawName.replace(/\s*\((?:Low|Medium|High|XHigh|Max)\)\s*$/i, '').trim();
    names[slug] = name;
    names[id] = name;
    ids[slug] = id;
    const entry = grouped.get(id) ?? { name, efforts: new Set<string>() };
    entry.efforts.add(effort);
    grouped.set(id, entry);
  }
  if (!grouped.size) return antigravityFallback();
  const models = [...grouped.entries()].map(([id, { name, efforts }]) => ({
    id, name, family: id, efforts: EFFORTS.filter((one) => efforts.has(one)),
  }));
  return { models: bySize('antigravity', models), names, ids, read: true };
}

// ----- the lists, once for each start of VS Code or after a day -----

const DAY = 24 * 60 * 60 * 1000;
const kept = new Map<string, { at: number; catalog: Catalog }>();

/** The catalog of an app, read at most once a day; undefined for an app with no catalog (OpenCode keeps its own models). */
export function catalogOf(app: string, home = agentHome()): Catalog | undefined {
  if (app !== 'claude-code' && app !== 'codex' && app !== 'antigravity') return undefined;
  const key = `${app}\n${home}`;
  const now = Date.now();
  const old = kept.get(key);
  if (old && now - old.at < DAY) return old.catalog;
  // The bundled catalog belongs to the program on the path; a made-up home of the checks has its own catalogs only.
  const catalog = app === 'claude-code' ? claudeCatalog(home)
    : app === 'codex' ? codexCatalog(home, home === homedir() ? codexBundled() : undefined)
      : antigravityCatalog(home, home === homedir() ? antigravityBundled() : undefined);
  kept.set(key, { at: now, catalog });
  return catalog;
}

/** The id of a model in the menu of a catalog: "claude-haiku-5-5" is "haiku" when it is the newest Haiku; any other stays as it is. */
export const menuId = (catalog: Catalog | undefined, model: string): string => catalog?.ids[model] ?? model;

/** The choice of a run with this model and effort, the effort that the model takes, and the name of the model from the catalog. */
export function pickOf(catalog: Catalog | undefined, model: string | undefined, effort: string): RunPick {
  if (!model) return { effort };
  const id = menuId(catalog, model);
  const efforts = catalog?.models.find((one) => one.id === id)?.efforts ?? [];
  return { model: id, name: catalog?.names[id] ?? catalog?.names[model] ?? id, effort: nearestEffort(efforts, effort) };
}

/** The default effort of a map or description run: medium, or the nearest effort that the model takes. */
const defaultTeamEffort = (model: ModelInfo | undefined): string => nearestEffort(model?.efforts ?? [], 'medium');

/**
 * The choice of a map run or a description run: for Claude Code and Codex, the second smallest model leads and every writer runs on the smallest;
 * for Antigravity, Gemini 4 Hydrogen leads and writes. All run at medium effort by default. OpenCode has no order: it keeps its own model and small model.
 */
export function teamOf(app: string, home = agentHome()): Team {
  const catalog = catalogOf(app, home);
  if (!catalog) return { app, effort: 'medium', list: [] };
  if (app === 'antigravity') {
    const hydrogen = catalog.models.find((one) => one.id === ANTIGRAVITY_SMALL) ?? smallest(app, catalog);
    return { app, lead: hydrogen?.id, writer: hydrogen?.id, effort: defaultTeamEffort(hydrogen), list: catalog.models };
  }
  const lead = secondSmallest(app, catalog);
  return { app, lead: lead?.id, writer: smallest(app, catalog)?.id, effort: defaultTeamEffort(lead), list: catalog.models };
}

// ----- what a session last used, from its own record -----

const records = new Map<string, { size: number; mtime: number; pick?: RunPick }>();

/** The newest value of a file that `pick` takes, kept while the file keeps its size and time. */
function keptPick(path: string, read: (path: string) => RunPick | undefined): RunPick | undefined {
  let stat;
  try { stat = statSync(path); } catch { return undefined; }
  const old = records.get(path);
  if (old && old.size === stat.size && old.mtime === stat.mtimeMs) return old.pick;
  const pick = read(path);
  records.set(path, { size: stat.size, mtime: stat.mtimeMs, pick });
  return pick;
}

const rollouts = new Map<string, { path?: string; at: number }>(); // the rollout of a Codex session, by its id; a missing one is looked for again after a minute

/** The rollout of a Codex session: ~/.codex/sessions/<year>/<month>/<day>/rollout-<time>-<id>.jsonl. */
function codexRollout(session: string, home: string): string | undefined {
  const key = `${home}\n${session}`;
  const old = rollouts.get(key);
  if (old && (old.path || Date.now() - old.at < 60_000)) return old.path;
  const root = join(home, '.codex', 'sessions');
  const list = (folder: string): string[] => { try { return readdirSync(folder).sort().reverse(); } catch { return []; } };
  let path: string | undefined;
  search: for (const year of list(root)) for (const month of list(join(root, year))) for (const day of list(join(root, year, month))) {
    const name = list(join(root, year, month, day)).find((file) => file.startsWith('rollout-') && file.endsWith(`${session}.jsonl`));
    if (name) { path = join(root, year, month, day, name); break search; }
  }
  rollouts.set(key, { path, at: Date.now() });
  return path;
}

/**
 * The model and the effort that a session last used, from its own record, read only: Claude Code the `model` of the last assistant message of its
 * transcript and its `effort`; Codex the `model` and `effort` of the last `turn_context` of its rollout. Undefined when the record says nothing.
 * Each file is read from its end (newestLine), never whole.
 */
export function sessionRecord(app: string, session: string | undefined, home = agentHome()): RunPick | undefined {
  if (!session || !/^[\w-]+$/.test(session)) return undefined;
  const parse = (line: string, mark: string): Record<string, any> | undefined => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!line.includes(mark)) return undefined;
    try { return JSON.parse(line); } catch { return undefined; }
  };
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value && !value.startsWith('<') ? value : undefined);
  if (app === 'claude-code') {
    const path = claudeTranscript(session, home);
    return path ? keptPick(path, (file) => newestLine(file, (line) => {
      const record = parse(line, '"assistant"');
      const model = record?.type === 'assistant' ? text(record.message?.model) : undefined;
      return model ? { model, ...(text(record!.effort) ? { effort: record!.effort } : {}) } : undefined;
    })) : undefined;
  }
  if (app === 'codex') {
    const path = codexRollout(session, home);
    return path ? keptPick(path, (file) => newestLine(file, (line) => {
      const record = parse(line, '"turn_context"');
      const model = record?.type === 'turn_context' ? text(record.payload?.model) : undefined;
      return model ? { model, ...(text(record!.payload.effort) ? { effort: record!.payload.effort } : {}) } : undefined;
    })) : undefined;
  }
  return undefined;
}

/**
 * The choice that a session starts with in a picker: the model and the effort that it last used (its name from the catalog: "claude-opus-5-5" is
 * "Opus 5.5"); a session whose model is unknown the model of the setting. The effort: the session's last one, else high.
 */
export function sessionPick(app: string, session: string | undefined, setting: string | undefined, home = agentHome()): RunPick {
  const record = sessionRecord(app, session, home);
  return pickOf(catalogOf(app, home), record?.model ?? setting, record?.effort ?? 'high');
}

/** What the picker of a comment offers for each app: the newest models of its catalog, and the model of a new session (its setting). */
export interface ModelMenu { list: ModelInfo[]; fresh?: RunPick }

/** The menu of an app: the setting as the model of a new session ("haiku" is the newest Haiku); OpenCode its small model with no choice, or its own model. */
export function menuOf(app: string, setting: string | undefined, home = agentHome()): ModelMenu {
  if (app === 'opencode') return { list: [], fresh: setting ? { model: setting, name: setting, effort: 'high' } : {} };
  const catalog = catalogOf(app, home);
  return { list: catalog?.models ?? [], fresh: pickOf(catalog, setting, 'high') };
}

// ----- a choice from a page, and what a run takes from it -----

/** A model or an effort from a page goes into the words of a run only when it is one word of the forms that the apps take. */
const SAFE = /^[A-Za-z0-9][\w.:/[\]#-]{0,80}$/;
export const safeWord = (word: unknown): string | undefined => (typeof word === 'string' && SAFE.test(word) ? word : undefined);

/** The choice of a run that a page sent, checked: a model and an effort of safe words; none when it sent nothing. */
export function pickFrom(sent: unknown): RunPick | undefined {
  const pick = sent && typeof sent === 'object' ? sent as Record<string, unknown> : undefined;
  const [model, effort] = [safeWord(pick?.model), safeWord(pick?.effort)];
  return model || effort ? { ...(model ? { model } : {}), ...(effort ? { effort } : {}) } : undefined;
}

/**
 * The team of a map or description run: the lead and the effort that a page sent, when it is of the same app, the lead is in the catalog and the lead
 * takes the effort; else those of teamOf(). The writers stay those of teamOf(): a writer that a page sends is ignored.
 */
export function teamFrom(app: string, sent: unknown, home = agentHome()): Team {
  const team = teamOf(app, home);
  const chosen = sent && typeof sent === 'object' ? sent as Record<string, unknown> : {};
  if (chosen.app !== app || !team.list.length) return team;
  const lead = modelIn(team, chosen.lead)?.id ?? team.lead;
  const effort = typeof chosen.effort === 'string' && (modelIn(team, lead)?.efforts ?? []).includes(chosen.effort) ? chosen.effort : team.effort;
  return { ...team, lead, effort };
}

const modelIn = (team: Team, id: unknown): ModelInfo | undefined => team.list.find((model) => model.id === id);

/**
 * What a run of a team takes: the lead's model and effort, and the writers' model at medium effort (or its nearest), whatever effort the lead has.
 * OpenCode keeps its own model.
 */
export const teamRun = (team: Team): { model?: string; effort: string; writers?: { model: string; effort: string }; opencodeModel: undefined } => ({
  ...(team.lead ? { model: team.lead } : {}), effort: nearestEffort(modelIn(team, team.lead)?.efforts ?? [], team.effort),
  ...(team.writer ? { writers: { model: team.writer, effort: defaultTeamEffort(modelIn(team, team.writer)) } } : {}),
  opencodeModel: undefined,
});

/**
 * The sentence of the prompt of a map run or a description run that names its models in plain words, so that the lead starts its writers on them:
 * Claude Code starts them as the agent of `--agents` (`writerAgent`), which has that model and effort; Codex gives them with spawn_agent, whose tool takes
 * `model` and `reasoning_effort`; Antigravity uses invoke_subagent with TypeName "self" and Model "inherit" when lead and writer share model and effort,
 * else swarm with the writer's model and effort slug. OpenCode keeps its own models: no sentence, and the words of the skill hold.
 */
export function teamSentence(team: Team, writerAgent: string): string {
  const run = teamRun(team);
  if (!team.lead || !run.writers) return '';
  const name = (id: string): string => team.list.find((model) => model.id === id)?.name ?? id;
  const agyHow = run.writers.model === team.lead && run.writers.effort === run.effort
    ? 'start each one with invoke_subagent, with TypeName "self" and Model "inherit"'
    : `start each one with swarm, action "add" and model "${/-(low|medium|high|xhigh|max)$/.test(run.writers.model) ? run.writers.model : `${run.writers.model}-${run.writers.effort}`}"`;
  const how = team.app === 'claude-code' ? `start each one as the agent ${writerAgent}, which runs on that model at that effort, and give it no model of your own`
    : team.app === 'codex' ? `start each one with spawn_agent, with model "${run.writers.model}" and reasoning_effort "${run.writers.effort}"`
      : team.app === 'antigravity' ? agyHow : '';
  return `You lead on ${name(team.lead)} at ${run.effort} effort: you start, check and correct the writers, and you write no part yourself. `
    + `Start every writer and checker subagent on ${name(run.writers.model)} at ${run.writers.effort} effort${how ? `: ${how}` : ''}.`;
}
