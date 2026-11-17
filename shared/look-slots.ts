// What `apostil look-slots` prints, all read from LOOK_PARTS (shared/look.ts). With no argument: the core (what most looks use) and one index line
// for each area. With an area: only that area. With --find "<words>": the best matches of a plain search by words. With --all: the whole list.
// An agent pays for each character it reads, so the sizes are a contract that store/look-options.test.ts holds; an area that grows past its
// limit is split in two.

import { LOOK_PARTS, nearestPart, TARGETS_KEY, type LookPartsList } from './look';

const LIST: LookPartsList = LOOK_PARTS;
const TARGETS = LIST[TARGETS_KEY]; // where a click, a key or a menu entry can go
const MATCHES = 5;
const MORE = 'apostil look-slots <area> prints one area; --find "<words>" searches every part; --all prints the whole list.';

type Example = Readonly<Record<string, unknown>>;
const entries = <T>(record: Readonly<Record<string, T>>): [string, T][] => Object.entries(record);
const only = <T>(record: Readonly<Record<string, T>>, keys: readonly string[]): Record<string, T> => Object.fromEntries(entries(record).filter(([key]) => keys.includes(key)));
const kindsOf = (fields: Readonly<Record<string, string>>[]): string[] => [...new Set(fields.flatMap((one) => Object.values(one)))];
/** The words of a pick: a pick of a later build has its area, words and example beside them. */
const pickWhat = (pick: LookPartsList['picks'][string]): string => (typeof pick === 'string' ? pick : pick.what);

/** One line for each area: what is inside, as a person says it. */
const index = (): { id: string; line: string }[] => entries(LIST.areas).map(([id, words]) => ({ id, line: `${id}: ${words}` }));

/** The area of a slot: its own, else the area of the first component that has it. */
const slotArea = (name: string): string => LIST.slots[name].area ?? entries(LIST.components).find(([, one]) => one.slots.includes(name))?.[1].area ?? 'core';

/** The core: the components with their core slots, every pick, the slots and fields that most looks use with the kinds of their values, and the forms of the core targets. */
function core(): Record<string, unknown> {
  const slots = entries(LIST.slots).filter(([, slot]) => slot.core).map(([name, slot]) => [name, { what: slot.what, fields: slot.core === true ? slot.fields : only(slot.fields, slot.core!) }] as const);
  const said = (name: string, fields: Readonly<Record<string, string>>) => (LIST.slots[name].target ? { target: true } : { fields }); // a slot that is one target has no fields
  return {
    components: Object.fromEntries(entries(LIST.components).filter(([, one]) => one.core).map(([name, one]) => [name, { what: one.what, slots: one.slots.filter((slot) => LIST.slots[slot].core) }])),
    picks: Object.fromEntries(entries(LIST.picks).map(([name, pick]) => [name, pickWhat(pick)])),
    slots: Object.fromEntries(slots.map(([name, slot]) => [name, { what: slot.what, ...said(name, slot.fields) }])),
    values: only(LIST.values, kindsOf(slots.map(([, slot]) => slot.fields))),
    [TARGETS_KEY]: Object.fromEntries(entries(TARGETS).filter(([, target]) => target.core).map(([name, target]) => [name, target.form])),
  };
}

/** One area: its components with their slots and examples, the fields of those slots with the kinds of their values, the picks, and what else is in it. */
function area(id: string): Record<string, unknown> {
  const components = entries(LIST.components).filter(([, one]) => one.area === id);
  const names = [...new Set([...components.flatMap(([, one]) => one.slots), ...entries(LIST.slots).filter(([, slot]) => slot.area === id).map(([name]) => name)])];
  // A slot of another area is one line that names that area, where its fields stand; the slots of this area come whole.
  const whole = names.filter((name) => !LIST.slots[name].area || LIST.slots[name].area === id);
  // A slot shows its own example when no example of a component of the area uses it.
  const used = (name: string): boolean => components.some(([, one]) => name in one.example);
  const targets = entries(TARGETS).filter(([, target]) => target.area === id);
  const picks = entries(LIST.picks).filter(([, pick]) => typeof pick !== 'string' && pick.area === id);
  // The blocks of a page or a window (build 58): each with its form and the form of a file in its place, the title, the sources and the limits.
  const blocks = entries(LIST.blocks).filter(([, one]) => one.area === id);
  return {
    area: id,
    line: LIST.areas[id],
    ...(components.length ? { components: Object.fromEntries(components.map(([name, one]) => [name, { what: one.what, slots: one.slots, fields: one.fields, example: one.example }])) } : {}),
    ...(LIST.sets.area === id ? { sets: { what: LIST.sets.what, form: LIST.sets.form } } : {}),
    ...(blocks.length ? {
      blocks: Object.fromEntries(blocks.map(([name, one]) => [name, { what: one.what, form: one.form, ...(one.file ? { file: one.file } : {}) }])),
      title: LIST.blockTitle, sources: LIST.sources, limits: LIST.limits,
    } : {}),
    ...(LIST.pages.area === id ? { pages: { what: LIST.pages.what, form: LIST.pages.form, example: LIST.pages.example } } : {}),
    ...(names.length ? {
      slots: Object.fromEntries(names.map((name) => {
        const slot = LIST.slots[name];
        if (!whole.includes(name)) return [name, `the area ${slot.area}${slot.core ? ' (and the core)' : ''} gives its fields`];
        return [name, { what: slot.what, ...(slot.one ? { one: true } : {}), ...(slot.target ? { target: true } : { fields: slot.fields }), ...(used(name) || !slot.example ? {} : { example: slot.example }) }];
      })),
      values: only(LIST.values, kindsOf(whole.map((name) => LIST.slots[name].fields))),
      picks: `${Object.keys(LIST.picks).join(', ')}: the core says what each picks`,
    } : {}),
    ...(picks.length ? { fields: Object.fromEntries(entries(LIST.components).map(([name, one]) => [name, one.fields])) } : {}),
    ...(targets.length ? { [TARGETS_KEY]: Object.fromEntries(targets.map(([name, target]) => [name, { what: target.what, form: target.form }])) } : {}),
  };
}

// ----- the search -----

/** A part that the search can find, with the words that it is found by: its name, its other words, and the rest of its text. */
interface Part {
  name: string;
  is: 'component' | 'slot' | 'field' | 'pick' | 'target' | 'set' | 'block' | 'page';
  area: string;
  line: string;
  example?: Example;
  by: { name: string[]; words: string[]; other: string[] };
}

const wordsOf = (...texts: unknown[]): string[] => texts.flatMap((text) => (typeof text === 'string' ? text : JSON.stringify(text ?? '')).toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean);
const IGNORED = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'its', 'are', 'not', 'all', 'any', 'can', 'make', 'want']);

/** The first example of the list that gives a key (a pick, a slot, "action", "set"), so that each match comes with a whole rule. */
function exampleWith(key: string): Example | undefined {
  const all = [...Object.values(LIST.components), ...Object.values(LIST.slots), ...Object.values(TARGETS)].map((one) => one.example).filter((one): one is Example => !!one);
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
    found.push({ name, is: 'slot', area: at, line: `${slot.what}${fields.length ? `; its fields: ${fields.join(', ')}` : ''}`, example: slot.example ?? exampleWith(name), by: { name: wordsOf(name), words: wordsOf(...fields, ...(slot.words ?? [])), other: wordsOf(slot.what, slot.example) } });
    // A slot whose fields are all of one kind (the four corners, the one colour of a note) is found as a whole.
    if (new Set(Object.values(slot.fields)).size < 2) continue;
    for (const [field, kind] of entries(slot.fields)) {
      const line = `"${field}" of ${slot.what.split(/[:;]/)[0]}: ${LIST.values[kind]}`;
      found.push({ name: `${name}.${field}`, is: 'field', area: at, line, example: slot.example ?? exampleWith(name), by: { name: wordsOf(name, field), words: [], other: wordsOf(line) } });
    }
  }
  for (const [name, pick] of entries(LIST.picks)) {
    const own = typeof pick === 'string' ? { what: pick } : pick;
    found.push({ name, is: 'pick', area: own.area ?? 'core', line: own.what, example: own.example ?? exampleWith(name), by: { name: wordsOf(name), words: wordsOf(...(own.words ?? [])), other: wordsOf(own.what) } });
  }
  for (const [name, target] of entries(TARGETS)) {
    found.push({ name, is: 'target', area: target.area ?? 'core', line: `${target.what}: ${target.form}`, example: target.example ?? exampleWith('action'), by: { name: wordsOf(name), words: wordsOf(...(target.words ?? [])), other: wordsOf(target.what, target.form) } });
  }
  found.push({ name: 'sets', is: 'set', area: LIST.sets.area, line: `${LIST.sets.what}; its area gives its form`, example: exampleWith('set'), by: { name: wordsOf('set'), words: wordsOf(...(LIST.sets.words ?? [])), other: wordsOf(LIST.sets.what) } });
  for (const [name, block] of entries(LIST.blocks)) {
    found.push({ name, is: 'block', area: block.area, line: `${block.what}: ${block.form}${block.file ? `; a file in its place: ${block.file}` : ''}`, example: block.example, by: { name: wordsOf(name), words: wordsOf(...(block.words ?? [])), other: wordsOf(block.what) } });
  }
  found.push({ name: 'pages', is: 'page', area: LIST.pages.area, line: `${LIST.pages.what}; its area gives its form`, example: LIST.pages.example, by: { name: wordsOf('page', 'pages'), words: wordsOf(...(LIST.pages.words ?? [])), other: wordsOf(LIST.pages.what) } });
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
  const items = Array.isArray(value) ? value.map((one) => inner + compactJson(one, inner))
    : Object.entries(value).filter(([, one]) => one !== undefined).map(([key, one]) => `${inner}${JSON.stringify(key)}: ${compactJson(one, inner)}`);
  return Array.isArray(value) ? `[\n${items.join(',\n')}\n${indent}]` : `{\n${items.join(',\n')}\n${indent}}`;
}
