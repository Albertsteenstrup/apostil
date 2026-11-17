// "Sort and filter" in VS Code's own quick pick, which stands over the whole window (a view of the side bar can draw only inside its own frame).
// The lines come from sort-filter.ts. A pick changes the search at once and the quick pick stays open: each line has a check box (VS Code's `canSelectMany`),
// a click or Space on a line is one pick, and Enter or "OK" is "done" and closes it. The icons are drawn here: avatars as files in the global storage, a dot for a label, codicons for states.

import * as vscode from 'vscode';
import type { Person } from '../shared/read-pull-request';
import type { ListSearch } from './change-list';
import { groups, pick, PLACEHOLDER, TITLE, type Entry, type Mark, type MenuMessage } from './sort-filter';

type IconPath = vscode.Uri | vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri };
type Item = vscode.QuickPickItem & { entry?: Entry };

const GREY = '#6e7781';
const AVATAR_HOST = 'https://avatars.githubusercontent.com/';
const MAX_AVATAR_BYTES = 200_000;

/** A small SVG as an address that VS Code draws as an icon. */
const svgIcon = (svg: string): vscode.Uri => vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${svg}</svg>`).toString('base64')}`);
/** The first letter of the login in a round mark, as the list shows it when a picture is missing. */
const letterIcon = (login: string): vscode.Uri => svgIcon(
  `<circle cx="8" cy="8" r="8" fill="${GREY}"/><text x="8" y="11.5" font-size="10" font-weight="600" font-family="sans-serif" text-anchor="middle" fill="#fff">${login.replace(/[^a-zA-Z0-9]/g, '').slice(0, 1).toUpperCase() || '?'}</text>`);
/** A dot in the colour of a label (the six hex digits that GitHub gives). */
const labelIcon = (color: string): vscode.Uri => svgIcon(`<circle cx="8" cy="8" r="5" fill="${/^[0-9a-f]{6}$/i.test(color) ? `#${color}` : GREY}"/>`);

// The state of a pull request as a codicon in a colour of the theme of VS Code, so that it shows in every theme.
const STATE_CODICON: Record<string, string> = { 'git-merge-conflict': 'warning' };
const STATE_COLOUR: Record<string, string> = { grey: 'descriptionForeground', green: 'charts.green', amber: 'charts.yellow', red: 'charts.red', purple: 'charts.purple' };

export class SortAndFilter {
  private open?: vscode.QuickPick<Item>;

  /** `storage`: the global storage of the extension, where each avatar is saved once. `change` gets the search after each pick. */
  constructor(private media: vscode.Uri, private storage: vscode.Uri, private change: (search: ListSearch) => void) {}

  /** The picture of a person, saved once by login in the global storage; a failed download gives the first letter. */
  private async avatar(person: Person): Promise<IconPath> {
    if (person.icon) return new vscode.ThemeIcon(person.icon === 'copilot' ? 'copilot' : 'robot');
    if (person.avatar.startsWith('data:')) return vscode.Uri.parse(person.avatar);
    if (!person.avatar.startsWith(AVATAR_HOST)) return letterIcon(person.login);
    const file = vscode.Uri.joinPath(this.storage, 'avatars', `${encodeURIComponent(person.login.toLowerCase())}.png`);
    try {
      await vscode.workspace.fs.stat(file);
    } catch {
      try {
        const answer = await fetch(person.avatar, { signal: AbortSignal.timeout(3000) });
        const bytes = new Uint8Array(await answer.arrayBuffer());
        if (!answer.ok || !answer.headers.get('content-type')?.startsWith('image/') || bytes.length > MAX_AVATAR_BYTES) return letterIcon(person.login);
        await vscode.workspace.fs.writeFile(file, bytes);
      } catch {
        return letterIcon(person.login);
      }
    }
    return file;
  }

  private async iconOf(mark: Mark): Promise<IconPath | undefined> {
    if (mark.kind === 'person') return this.avatar(mark.person);
    if (mark.kind === 'label') return labelIcon(mark.color);
    if (mark.kind === 'state') return new vscode.ThemeIcon(STATE_CODICON[mark.look.icon] ?? mark.look.icon, new vscode.ThemeColor(STATE_COLOUR[mark.look.colour]));
    if (mark.kind === 'agent') { const file = vscode.Uri.joinPath(this.media, 'agents', `${mark.app}.svg`); return { light: file, dark: file }; }
    return undefined;
  }

  /** Opens the quick pick for the values and the search that the view sent. */
  async show(menu: MenuMessage): Promise<void> {
    this.open?.dispose();
    let search = menu.search;
    const idOf = (entry: Entry): string => `${entry.key}\n${entry.value}`;
    const all = groups(menu).flatMap((group) => group.entries);
    const icons = new Map(await Promise.all(all.map(async (entry): Promise<[string, IconPath | undefined]> => [idOf(entry), await this.iconOf(entry.mark)])));

    const quick = vscode.window.createQuickPick<Item>();
    this.open = quick;
    quick.title = TITLE;
    quick.placeholder = PLACEHOLDER;
    quick.canSelectMany = true;
    quick.matchOnDescription = false;
    // VS Code answers each change of the items or of the check marks that we make with events of selection, a moment later (first none checked, then ours).
    // Until the check marks that we set come back, events are ours, not a pick; 300 ms at most, in case the marks did not change.
    let expected: Set<string> | undefined;
    let forget: NodeJS.Timeout | undefined;

    /** The lines for the search as it is; the line under the keyboard stays under it. */
    const draw = (): void => {
      const active = quick.activeItems[0]?.entry;
      quick.items = groups({ values: menu.values, search }).flatMap((group): Item[] => [
        { label: group.title, kind: vscode.QuickPickItemKind.Separator },
        ...group.entries.map((entry): Item => ({ label: entry.label, description: entry.description, iconPath: icons.get(idOf(entry)), entry })),
      ]);
      quick.selectedItems = quick.items.filter((item) => item.entry?.on);
      quick.activeItems = quick.items.filter((item) => active && item.entry?.key === active.key && item.entry.value === active.value);
      expected = new Set(quick.selectedItems.map((item) => item.entry && idOf(item.entry)).filter((id): id is string => !!id));
      clearTimeout(forget);
      forget = setTimeout(() => { expected = undefined; }, 300);
    };
    const apply = (entry: Entry): void => {
      search = pick(search, entry);
      this.change(search);
      draw();
    };
    quick.onDidChangeSelection((selected) => {
      if (expected) {
        const got = selected.map((item) => item.entry && idOf(item.entry));
        if (got.length === expected.size && got.every((id) => id && expected!.has(id))) expected = undefined;
        return;
      }
      const toggled = quick.items.filter((item) => item.entry && selected.includes(item) !== item.entry.on);
      if (toggled.length === 1 && toggled[0].entry) apply(toggled[0].entry);
      else draw(); // the box "select all" of VS Code is no pick: the marks go back to the search
    });
    quick.onDidAccept(() => quick.hide());
    quick.onDidHide(() => { clearTimeout(forget); quick.dispose(); if (this.open === quick) this.open = undefined; });
    draw();
    quick.show();
  }
}
