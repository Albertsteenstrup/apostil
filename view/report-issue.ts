// "Apostil: Report an Issue": for a person with no agent at hand. It opens GitHub's page for a new issue with the facts filled in
// and the headings empty. The person writes the rest there and submits it under their own account.

import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { storeFolder } from '../shared/store';
import { issueFacts, issuesAddress, openInBrowser, prepareIssue, whoIsHere, type IssueKind } from '../store/issue';
import { thisInstall } from '../store/setup';

const KINDS: (vscode.QuickPickItem & { issueKind: IssueKind })[] = [
  { label: 'Something does not work', detail: 'A step failed, or a page shows something wrong.', issueKind: 'bug' },
  { label: 'What I think', detail: 'What helped, what was in the way, what is missing.', issueKind: 'feedback' },
];

/** Asks for the kind, reads the facts and opens the page. The address is built as the command `apostil issue --open` builds it. A given kind skips the question, for a check. */
async function reportIssue(context: vscode.ExtensionContext, kind?: IssueKind): Promise<void> {
  const picked = KINDS.find((one) => one.issueKind === kind) ?? await vscode.window.showQuickPick(KINDS, { title: 'Report an Issue', placeHolder: 'You read the issue on GitHub before it goes.' });
  if (!picked) return;
  const root = context.extensionUri.fsPath;
  const issues = issuesAddress(root);
  if (!issues) return void vscode.window.showWarningMessage('package.json of Apostil names no repo, so there is no page for issues.');
  const issue = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Apostil: reading the versions for the issue…' }, async () => {
    await new Promise((shown) => setTimeout(shown, 50)); // the note shows before the versions are read, which takes a moment
    const machine = { home: homedir(), path: process.env.PATH ?? '' };
    const who = whoIsHere(machine.home);
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? machine.home;
    const facts = issueFacts({ folder, machine, install: thisInstall(root), cli: join(root, 'out', 'store', 'cli.js'), store: storeFolder(), who, vscode: vscode.version, onEditor: true });
    return prepareIssue({ kind: picked.issueKind, title: '', text: '', facts, who, issues });
  });
  openInBrowser(issue.address);
}

export const registerReportIssue = (context: vscode.ExtensionContext): vscode.Disposable =>
  vscode.commands.registerCommand('apostil.reportIssue', (kind?: IssueKind) => reportIssue(context, kind));
