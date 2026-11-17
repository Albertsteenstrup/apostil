// "Sort and filter" of the list in the side bar: what its quick pick holds. The values and their counts come from the view (Search.menuValues in
// media/search.js); the words and the one parser of the field come from media too. Nothing here draws or imports `vscode`: sort-filter-pick.ts does that.

import { APP_NAMES } from '../shared/agents';
import type { StateLook } from '../shared/pull-requests';
import type { Person } from '../shared/read-pull-request';
import type { ListSearch } from './change-list';

interface SearchRules {
  SORTS: string[];
  KEYS: string[];
  DEFAULT: ListSearch;
  parse(text: string): unknown;
  isOn(query: unknown, key: string, value: string): boolean;
  toggle(text: string, key: string, value: string): string;
}
interface Words {
  sort: string;
  sorts: Record<string, string>;
  sortOrder: Record<string, [string, string]>;
  filters: Record<string, string>;
  sortAndFilter: string;
  sortAndFilterFind: string;
}
/* eslint-disable @typescript-eslint/no-require-imports */
const Search: SearchRules = require('../../view/media/search.js');
const WORDS: Words = require('../../view/media/states.js').WORDS;
/* eslint-enable @typescript-eslint/no-require-imports */

/** One value of a filter as Search.menuValues gives it: the value, its count, and what it carries for its mark. */
export interface MenuValue {
  value: string;
  count: number;
  person?: Person; // an author or a reviewer
  color?: string; // a label: the six hex digits of GitHub
  look?: StateLook; // a state
  agent?: { app: string }; // an agent
}
/** What the view sends when the icon is pressed: the values of each filter and the search as it is. */
export interface MenuMessage {
  values: Record<string, MenuValue[]>;
  search: ListSearch;
}

/** What stands before a name in the quick pick. */
export type Mark = { kind: 'person'; person: Person } | { kind: 'label'; color: string } | { kind: 'state'; look: StateLook } | { kind: 'agent'; app: string } | { kind: 'none' };

/** One line of the quick pick. `key` is "sort" or a filter; `value` is the sort or the value of the filter. */
export interface Entry {
  key: string;
  value: string;
  label: string;
  description: string;
  on: boolean;
  mark: Mark;
}
export interface Group {
  title: string;
  entries: Entry[];
}

export const TITLE = WORDS.sortAndFilter;
export const PLACEHOLDER = WORDS.sortAndFilterFind;

const markOf = (key: string, one: MenuValue): Mark => {
  if (key === 'author' || key === 'reviewer') return one.person ? { kind: 'person', person: one.person } : { kind: 'none' };
  if (key === 'label') return { kind: 'label', color: one.color ?? '' };
  if (key === 'state' && one.look) return { kind: 'state', look: one.look };
  return key === 'agent' && one.agent ? { kind: 'agent', app: one.agent.app } : { kind: 'none' };
};

/**
 * The groups of the quick pick: "Sort" (the sort that is on has its order in the description; Author is left out when no row has an author),
 * then each filter that has values, each value with its count. A value that the field holds is on. A group with no values is left out.
 */
export function groups({ values, search }: MenuMessage): Group[] {
  const query = Search.parse(search.text);
  const sorts = Search.SORTS.filter((sort) => sort !== 'author' || values.author?.length).map((sort): Entry => {
    const on = search.sort === sort;
    return { key: 'sort', value: sort, label: WORDS.sorts[sort], description: on ? WORDS.sortOrder[sort][search.reverse ? 1 : 0] : '', on, mark: { kind: 'none' } };
  });
  const filters = Search.KEYS.filter((key) => values[key]?.length).map((key): Group => ({
    title: WORDS.filters[key],
    entries: values[key].map((one) => ({
      key, value: one.value, label: key === 'agent' ? (APP_NAMES[one.agent?.app ?? ''] ?? one.value) : one.value, description: String(one.count),
      on: Search.isOn(query, key, one.value), mark: markOf(key, one),
    })),
  }));
  return [{ title: WORDS.sort, entries: sorts }, ...filters];
}

/** The search after a pick: the sort that is on turns its order round, another sort replaces it, a value is added to the field or taken out. */
export function pick(search: ListSearch, entry: Pick<Entry, 'key' | 'value'>): ListSearch {
  if (entry.key !== 'sort') return { ...search, text: Search.toggle(search.text, entry.key, entry.value) };
  return entry.value === search.sort ? { ...search, reverse: !search.reverse } : { ...search, sort: entry.value, reverse: false };
}
