// What `apostil look-slots` prints, all read from LOOK_PARTS (shared/look.ts). With no argument: the core (what most looks use) and one index line
// for each area. With an area: only that area. With --find "<words>": the best matches of a plain search by words. With --all: the whole list.
// An agent pays for each character it reads, so the sizes are a contract that store/look-options.test.ts holds; an area that grows past its
// limit is split in two.

import { ACTIONS, ACTIONS_KEY, LOOK_PARTS, nearestPart, type LookPartsList } from './look';

const LIST: LookPartsList = LOOK_PARTS;
const MATCHES = 5;
const MORE = 'apostil look-slots <area> prints one area; --find "<words>" searches every part; --all prints the whole list.';

type Example = Readonly<Record<string, unknown>>;
const entries = <T>(record: Readonly<Record<string, T>>): [string, T][] => Object.entries(record);
const only = <T>(record: Readonly<Record<string, T>>, keys: readonly string[]): Record<string, T> => Object.fromEntries(entries(record).filter(([key]) => keys.includes(key)));
const kindsOf = (fields: Readonly<Record<string, string>>[]): string[] => [...new Set(fields.flatMap((one) => Object.values(one)))];

/** One line for each area: what is inside, as a person says it. */
const index = (): { id: string; line: string }[] => entries(LIST.areas).map(([id, words]) => ({ id, line: `${id}: ${words}` }));

/** The area of a slot: its own, else the area of the first component that has it. */
const slotArea = (name: string): string => LIST.slots[name].area ?? entries(LIST.components).find(([, one]) => one.slots.includes(name))?.[1].area ?? 'core';

/** The core: the components, every pick, the slots and fields that most looks use with the kinds of their values, and the form of each action. */
function core(): Record<string, unknown> {
  const slots = entries(LIST.slots).filter(([, slot]) => slot.core).map(([name, slot]) => [name, { what: slot.what, fields: slot.core === true ? slot.fields : only(slot.fields, slot.core!) }] as const);
  return {
    components: Object.fromEntries(entries(LIST.components).filter(([, one]) => one.core).map(([name, one]) => [name, { what: one.what, slots: one.slots }])),
    picks: LIST.picks,
    slots: Object.fromEntries(slots),
    values: only(LIST.values, kindsOf(slots.map(([, slot]) => slot.fields))),
    [ACTIONS_KEY]: Object.fromEntries(entries(ACTIONS).map(([name, action]) => [name, action.form])),
  };
}

/** One area: its components with their slots and examples, the fields of those slots with the kinds of their values, the picks, and what else is in it. */
function area(id: string): Record<string, unknown> {
  const components = entries(LIST.components).filter(([, one]) => one.area === id);
  const names = [...new Set([...components.flatMap(([, one]) => one.slots), ...entries(LIST.slots).filter(([, slot]) => slot.area === id).map(([name]) => name)])];
  // A slot shows its own example when no example of a component of the area uses it.
  const used = (name: string): boolean => components.some(([, one]) => name in one.example);
  const actions = entries(ACTIONS).filter(([, action]) => action.area === id);
  return {
    area: id,
    line: LIST.areas[id],
    ...(components.length ? { components: Object.fromEntries(components.map(([name, one]) => [name, { what: one.what, slots: one.slots, example: one.example }])) } : {}),
    ...(LIST.sets.area === id ? { sets: { what: LIST.sets.what, form: LIST.sets.form } } : {}),
    slots: Object.fromEntries(names.map((name) => {
      const slot = LIST.slots[name];
      return [name, { what: slot.what, ...(slot.one ? { one: true } : {}), fields: slot.fields, ...(used(name) ? {} : { example: slot.example }) }];
    })),
    values: only(LIST.values, kindsOf(names.map((name) => LIST.slots[name].fields))),
    picks: `${Object.keys(LIST.picks).join(', ')}: the core says what each picks`,
    ...(actions.length ? { [ACTIONS_KEY]: Object.fromEntries(actions.map(([name, action]) => [name, { what: action.what, form: action.form }])) } : {}),
  };
}

// ----- the search -----

/** A part that the search can find, with the words that it is found by: its name, its other words, and the rest of its text. */
interface Part {
  name: string;
  is: 'component' | 'slot' | 'field' | 'pick' | 'action' | 'set';
  area: string;
  line: string;
  example?: Example;
  by: { name: string[]; words: string[]; other: string[] };
}

const wordsOf = (...texts: unknown[]): string[] => texts.flatMap((text) => (typeof text === 'string' ? text : JSON.stringify(text ?? '')).toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean);
const IGNORED = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'its', 'are', 'not', 'all', 'any', 'can', 'how', 'make', 'show', 'want']);

/** The first example of the list that gives a key (a pick, a slot, "action", "set"), so that each match comes with a whole rule. */
function exampleWith(key: string): Example | undefined {
  const all = [...Object.values(LIST.components), ...Object.values(LIST.slots)].map((one) => one.example);
  return all.find((example) => JSON.stringify(example).includes(`"${key}":`));
}

/** Every part of the list that the search can find. */
function parts(): Part[] {
  const found: Part[] = [];
  for (const [name, one] of entries(LIST.components)) {
    found.push({ name, is: 'component', area: one.area, line: `${one.what}; its slots: ${one.slots.join(', ')}`, example: one.example, by: { name: wordsOf(name), words: wordsOf(...(one.words ?? [])), other: wordsOf(one.what, one.example) } });
  }
  for (const [name, slot] of entries(LIST.slots)) {
    const at = slotArea(name);
    const fields = Object.keys(slot.fields);
    found.push({ name, is: 'slot', area: at, line: `${slot.what}; its fields: ${fields.join(', ')}`, example: slot.example, by: { name: wordsOf(name), words: wordsOf(...fields, ...(slot.words ?? [])), other: wordsOf(slot.what, slot.example) } });
    // A slot whose fields are all of one kind (the four corners, the one colour of a note) is found as a whole.
    if (new Set(Object.values(slot.fields)).size < 2) continue;
    for (const [field, kind] of entries(slot.fields)) {
      const line = `"${field}" of ${slot.what.split(/[:;]/)[0]}: ${LIST.values[kind]}`;
      found.push({ name: `${name}.${field}`, is: 'field', area: at, line, example: slot.example, by: { name: wordsOf(name, field), words: [], other: wordsOf(line) } });
    }
  }
  for (const [name, what] of entries(LIST.picks)) found.push({ name, is: 'pick', area: 'core', line: what, example: exampleWith(name), by: { name: wordsOf(name), words: [], other: wordsOf(what) } });
  for (const [name, action] of entries(ACTIONS)) {
    found.push({ name, is: 'action', area: action.area ?? 'core', line: `${action.what}: ${action.form}`, example: exampleWith('action'), by: { name: wordsOf(name), words: wordsOf(...(action.words ?? [])), other: wordsOf(action.what, action.form) } });
  }
  found.push({ name: 'sets', is: 'set', area: LIST.sets.area, line: `${LIST.sets.what}; its area gives its form`, example: exampleWith('set'), by: { name: wordsOf('set'), words: wordsOf(...(LIST.sets.words ?? [])), other: wordsOf(LIST.sets.what) } });
  return found;
}

/** 2 for the same word, 1 for the start of a word (or a word with an ending of one or two letters more), else 0. */
function hit(asked: string, word: string): number {
  if (asked === word) return 2;
  return word.startsWith(asked) || (word.length >= 3 && asked.startsWith(word) && asked.length - word.length <= 2) ? 1 : 0;
}

/** How well a part fits the words: for each word its best hit, a hit in the name counting 3 times, in the other words of the part twice. */
const score = (part: Part, asked: string[]): number =>
  asked.reduce((sum, one) => sum + Math.max(0, ...part.by.name.map((word) => 3 * hit(one, word)), ...part.by.words.map((word) => 2 * hit(one, word)), ...part.by.other.map((word) => hit(one, word))), 0);

/** The best matches of the words over every part, or one sentence and the index when nothing fits. */
function find(words: string): Record<string, unknown> {
  const asked = wordsOf(words).filter((word) => word.length >= 3 && !IGNORED.has(word));
  const ranked = parts().map((part, order) => ({ part, order, score: score(part, asked) })).filter((one) => one.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order).slice(0, MATCHES);
  if (!ranked.length) return { found: `Nothing in the list fits "${words}". Read the index lines; when none fits, tell the owner and leave it out.`, areas: index() };
  // An example that an earlier match shows already is named, not printed again.
  return {
    matches: ranked.map(({ part: { by: _by, ...match } }, at) => {
      const before = ranked.slice(0, at).find((one) => one.part.example === match.example);
      return before ? { ...match, example: `the example of "${before.part.name}"` } : match;
    }),
  };
}

/** What `apostil look-slots` prints for an area (or none), the words of --find (or undefined), and --all; printed with `compactJson`. */
export function lookSlots(areaId: string, words: string | undefined, all: boolean): { output: unknown; ok: boolean; compact: true } {
  const said = (output: unknown, ok = true) => ({ output, ok, compact: true as const });
  if (all) return said(LOOK_PARTS);
  if (words !== undefined) return words.trim() ? said(find(words)) : said({ problems: ['Give the words: apostil look-slots --find "<words>".'] }, false);
  if (!areaId) return said({ core: core(), areas: index(), more: MORE });
  const ids = Object.keys(LIST.areas);
  if (!ids.includes(areaId)) return said({ problems: [`"${areaId}" is no area. The areas are ${ids.join(', ')}.${nearestPart(areaId, ids)}`] }, false);
  return said(area(areaId));
}

/** JSON with each part that fits in a line of 100 characters on one line: an example reads as one rule, and a short list takes one line. */
export function compactJson(value: unknown, indent = ''): string {
  const flat = JSON.stringify(value);
  if (typeof value !== 'object' || value === null || indent.length + flat.length <= 100) return flat;
  const inner = `${indent} `;
  const items = Array.isArray(value) ? value.map((one) => inner + compactJson(one, inner)) : Object.entries(value).map(([key, one]) => `${inner}${JSON.stringify(key)}: ${compactJson(one, inner)}`);
  return Array.isArray(value) ? `[\n${items.join(',\n')}\n${indent}]` : `{\n${items.join(',\n')}\n${indent}}`;
}
