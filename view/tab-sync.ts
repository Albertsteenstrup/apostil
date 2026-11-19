// Which editor group a code file opens or follows in when triggered from a diagram tab (Home). No `vscode` import.

/** One open tab in VS Code, stripped to what tab-sync needs. */
export interface OpenTab {
  viewColumn: number;
  uri?: string;
  isFileTab: boolean; // an Apostil file tab (custom editor apostil.file)
  isTextEditor: boolean; // a normal text editor of VS Code
  isActive: boolean; // the active tab of its group
}

/** Where a diagram node focus should scroll or open code without stealing focus from the diagram tab. */
export interface FollowTarget {
  viewColumn: number;
  alreadyOpen: boolean;
  isFileTab: boolean;
}

const isCode = (tab: OpenTab): boolean => tab.isFileTab || tab.isTextEditor;
const otherColumn = (tab: OpenTab, fromColumn: number | undefined): boolean => fromColumn === undefined || tab.viewColumn !== fromColumn;

/**
 * Picks the code tab to scroll when a node that maps to a note is focused in a diagram tab (`fromColumn`).
 * 1. If `targetUri` is already open in another tab group, reuse it (preferring an active tab).
 * 2. Else if another tab group currently holds any code tab (an Apostil file tab or a text editor), follow into that group so multi-file processes stay synced.
 * 3. Else return undefined: never open a split pane uninvited when no code tab is open beside the diagram.
 */
export function chooseFollowTarget(tabs: OpenTab[], fromColumn: number | undefined, targetUri: string): FollowTarget | undefined {
  const others = tabs.filter((tab) => otherColumn(tab, fromColumn));
  const same = others.filter((tab) => tab.uri === targetUri && isCode(tab));
  const hit = same.find((tab) => tab.isActive) ?? same[0];
  if (hit) return { viewColumn: hit.viewColumn, alreadyOpen: true, isFileTab: hit.isFileTab };
  if (fromColumn === undefined) return undefined;
  const codeOthers = others.filter(isCode);
  const group = codeOthers.find((tab) => tab.isActive) ?? codeOthers[0];
  return group ? { viewColumn: group.viewColumn, alreadyOpen: false, isFileTab: group.isFileTab } : undefined;
}

/**
 * Picks the editor column when the user explicitly asks to open code beside a diagram tab ("Open code beside" or Cmd+click).
 * Reuses an existing other code tab group when one is open (so Tab 2 updates instead of opening Tab 3); returns undefined to use ViewColumn.Beside.
 */
export function chooseBesideColumn(tabs: OpenTab[], fromColumn: number | undefined, targetUri: string): number | undefined {
  return chooseFollowTarget(tabs, fromColumn, targetUri)?.viewColumn;
}
