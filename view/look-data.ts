// What a page needs to draw the look of a repo and its marks: the rules in the order that they apply, the sets, the values that the marks use with
// their icons, the marks that still stand at their lines, and an address for each file of the look. No `vscode` import.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_RULES, lookFiles, ONE_FIELD_SLOTS, type LookRule } from '../shared/look';
import { marksNow, SERVICES, type Mark, type MarkSet } from '../shared/marks';
import type { Store } from '../shared/store';
import { dataAddress, iconData, setsOf, valuesOf } from '../store/marks-save';

/** A mark that stands at its line now. `line` is its line at the save, which the steps of the map count by; `at` is its line in the file now. */
export type MarkHere = Omit<Mark, 'code' | 'group'> & { at: number };

/** A value as the page draws it: its name, its web address, and its icon as a data address. */
export interface ValueLook {
  name: string;
  site?: string;
  icon?: string;
}

export interface LookData {
  custom: boolean; // a look is saved; else the default look applies
  rules: LookRule[]; // the default first, then a rule for the corner of each set of the look, then the rules of the look: a later rule wins over an earlier one of the same rank
  one: string[]; // the slots that give one field only, which the page takes whole
  sets: Omit<MarkSet, 'values' | 'rule'>[];
  values: Record<string, ValueLook>; // by "<set>:<value>"
  marks: MarkHere[];
  files: Record<string, string>; // a kept file of the look, by its name: the address that the page loads
}

/** The rules of a look in the order that they apply. The corner of each set is a rule for its kinds, after the default and before the rules of the look. */
export function lookRules(sets: MarkSet[], rules: LookRule[] = []): LookRule[] {
  const ofSets: LookRule[] = sets.filter((set) => set.id !== SERVICES.id).flatMap((set) => [
    { pick: { kind: 'node' as const }, corners: { [set.corner.node]: { set: set.id } } },
    { pick: { kind: 'step' as const }, corners: { [set.corner.node]: { set: set.id } } },
    { pick: { kind: 'note' as const }, corners: { [set.corner.note]: { set: set.id } } },
  ]);
  return [...DEFAULT_RULES, ...ofSets, ...rules];
}


/**
 * The look of a repo and its marks for a page. `address` turns a kept file into an address that the page may load: inside VS Code a webview
 * address, in a browser a relative one. With `withMarks` false (the file tab), the marks come with the code of each file instead.
 */
export function lookData(store: Store, repo: string, folder: string, address: (file: string) => string, withMarks = true): LookData {
  const stored = store.getLook(repo)?.look;
  const sets = setsOf(store, repo);
  const map = store.getMap(repo)?.map;
  const marks = withMarks ? standingMarks(folder, map?.marks ?? []) : [];
  const values: Record<string, ValueLook> = {};
  for (const set of sets) {
    const used = new Set([...(map?.marks ?? []).filter((mark) => mark.set === set.id).map((mark) => mark.value), ...(set.values ?? []).map((value) => value.id)]);
    for (const value of valuesOf(store, repo, set.id).filter((one) => used.has(one.id))) {
      const icon = iconData(store, set.id, value);
      values[`${set.id}:${value.id}`] = { name: value.name, ...(value.site ? { site: value.site } : {}), ...(icon ? { icon } : {}) };
    }
  }
  const rules = lookRules(sets, stored?.rules);
  const keep = store.lookFolder(repo);
  // A button's icon is a data address, as the icon of a value is; a picture or a film is loaded by its address. A file that is gone has none.
  const files = Object.fromEntries(lookFiles({ rules }).flatMap(({ path: name, use }) => {
    const path = join(keep, name);
    const found = use === 'icon' ? dataAddress(path) : existsSync(path) ? address(path) : undefined;
    return found ? [[name, found]] : [];
  }));
  return { custom: !!stored, rules, one: ONE_FIELD_SLOTS, sets: sets.map(({ values: _values, rule: _rule, ...set }) => set), values, marks, files };
}

/** The same look data as if no look were saved: the default rules and the services alone. For a page that shows the default beside a look. */
export const asDefault = (data: LookData): LookData => ({ ...data, custom: false, rules: lookRules([SERVICES]), sets: data.sets.filter((set) => set.id === SERVICES.id) });

/** The marks that still stand at the text of their lines, each with its line now. */
export function standingMarks(folder: string, marks: Mark[]): MarkHere[] {
  return marksNow(folder, marks).flatMap(({ mark: { code: _code, group: _group, ...rest }, at }) => (at === undefined ? [] : [{ ...rest, at }]));
}
