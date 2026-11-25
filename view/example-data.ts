// Writes view/media/example-data.js, so that page.html and list.html also open as files in a browser, with no VS Code around them.
// Usage: node out/view/example-data.js [<repo folder> <change-file.json> [<open-points.json> [<map.json>]]]
// With no arguments it makes the made-up example of the checks (view/check-example.ts) in a temporary folder, with its open points
// (view/example-open-points.json) and its map (view/example-map.json), and removes the folder at the end. Another repo gets a map only when it is named.

import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AgentSession } from '../shared/agents';
import type { ChangeFile } from '../shared/change-file';
import { checkChangeFile } from '../shared/checks';
import { baseOf, currentBranch, headCommit, repoId, tryGit } from '../shared/git';
import type { RepoMap } from '../shared/repo-map';
import { Store } from '../shared/store';
import { STATE_LOOKS, type PullRequest } from '../shared/pull-requests';
import type { OpenPoint, Remark } from '../shared/store';
import { madeUpAgentHome, madeUpMapSession, tempFolder } from '../shared/test-repo';
import { menuOf, sessionPick, teamOf } from '../shared/models';
import { EXAMPLE_FILES, EXAMPLE_LOOK, makeCheckExample, putLookFiles } from './check-example';
import { changePaths, homePaths, iconsFor, languagesOf, readIconTheme } from './file-icons';
import { asDefault, type LookData } from '../shared/look-data';
import { blocksAnswer, pageData, type CustomPageData } from './look-blocks';
import { addMarksToMap, setLook } from '../store/marks-save';
import { graphsData, homeData, homeRowState, mapRunOf, type GraphsData, type HomeData } from '../shared/home-data';
import { homeRun, withEnd, withSave, type MapRun, type MapRunLine } from '../shared/map-run';
import type { MapPlan, SaveTime } from '../shared/map-estimate';
import { mapRunChart } from '../shared/map-run-chart';
import { sessionGroups, type ListRow } from './list-rows';
import { pullRequestFrom, type Person } from '../shared/read-pull-request';
import { iconScript } from './state-icons';
import { exampleEarlierChange, examplePullRequest, exampleMergedPullRequest, exampleReadyPullRequest } from './example-pull-request';
import { saveMapDraft } from '../store/save';
import { agentOf, allQuestions, answer, diffRanges, examplePage, lookOfPage, marksBeside, notesBeside, type SendTo } from '../shared/page-data';

const [folderArg, fileArg, pointsArg, mapArg] = process.argv.slice(2);
// Made up: the catalogs of the agent apps and the last turns of two sessions, in a home of their own; the real home is never read here.
const agentHome = process.env.APOSTIL_AGENT_HOME = madeUpAgentHome({ claude: { 'made-up-session-0001': ['claude-opus-5-5', 'xhigh'], 'made-up-session-0002': ['claude-sonnet-5-5', 'medium'] } });
const example = folderArg ? undefined : makeCheckExample();
const folder = folderArg ?? example!.folder;
const file: ChangeFile = JSON.parse(readFileSync(fileArg ?? example!.changeFile, 'utf8'));
const pointsFile = pointsArg ?? (example ? join(__dirname, '../../view/example-open-points.json') : undefined);
const points: OpenPoint[] = (pointsFile ? JSON.parse(readFileSync(pointsFile, 'utf8')) : [])
  .map((point: OpenPoint, index: number) => ({ ...point, id: index + 1, changeId: 0, used: false }));

// ----- made up: the agent, the remarks and the pull requests below are not real -----
const agent: AgentSession = { app: 'claude-code', account: 'reader@example.com', session: 'made-up-session-0001', hostSession: 'made-up-host-0001', name: 'Made-up session name' };
const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();
const partIds = file.parts.map((part) => part.id).filter((id) => id !== 'hold-service'); // the browser check writes its own remark on "hold-service"
const remarkOn = (id: number, index: number, text: string, more: Partial<Remark>): Remark => {
  const part = file.parts.find((candidate) => candidate.id === partIds[index % partIds.length])!;
  return { id, changeId: 0, target: { kind: 'part', part: part.id, label: `Part "${part.name}"` }, text, createdAt: minutesAgo(60 - id), state: 'open', ...more };
};
const remarks: Remark[] = [
  remarkOn(1, 0, 'Does the tab show the pickup day in the time of the branch?', {}),
  remarkOn(2, 1, 'Return 404, not 400, when the hold does not exist. @claude-current', { state: 'sent', to: { app: 'claude-code', kind: 'current' } }),
  remarkOn(3, 2, 'Why is the pickup day set before the mail is sent? @claude-current', { state: 'running', to: { app: 'claude-code', kind: 'current' }, run: { session: agent.session, startedAt: minutesAgo(4) } }),
  remarkOn(4, 3, 'Is the shelf tested with an empty list?', {
    state: 'done', answeredAt: minutesAgo(2),
    answer: 'Added a test for an empty shelf in ReadyShelf.test.tsx. The shelf now says "No copy waits for a member".',
    changed: ['web/src/desk/ReadyShelf.tsx', 'web/src/desk/ReadyShelf.test.tsx'],
  }),
  remarkOn(5, 4, 'Rename the column to last_pickup_day.', { state: 'closed', closedBy: 'claude-code' }),
  remarkOn(6, 3, 'And for a shelf with one copy?', {
    thread: 4, state: 'done', createdAt: minutesAgo(1.5), answeredAt: minutesAgo(1),
    answer: 'One copy shows the table with no line about the last day. A second test covers it.',
  }),
];
const pull = (number: number, title: string, state: PullRequest['state'], failed = 0, more: Partial<PullRequest> = {}): PullRequest =>
  ({ number, title, url: `https://example.com/made-up/pull/${number}`, state, look: STATE_LOOKS[state], checks: { passed: 7, failed, pending: 0 }, reviewers: [], labels: [], ...more });
// Made-up people of the list: two with a picture drawn here (no picture from the network), one with none, a product and a team.
const face = (background: string, figure: string): string => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${background}"/><circle cx="20" cy="16" r="7" fill="${figure}"/><path d="M6 40c1-9 7-14 14-14s13 5 14 14z" fill="${figure}"/></svg>`)}`;
const people: Record<string, Person> = {
  mira: { login: 'mira-k', avatar: face('#2f6f73', '#cfe8e6'), bot: false },
  jonas: { login: 'jonas-b', avatar: face('#8a5a2b', '#f3e2c7'), bot: false },
  lena: { login: 'lena-s', avatar: '', bot: false },
  copilot: { login: 'Copilot', avatar: '', bot: true, icon: 'copilot' },
  team: { login: 'Made-up team', avatar: '', bot: false, team: true },
};
const labels = { review: { name: 'needs review', color: 'fbca04' }, borrowing: { name: 'borrowing', color: '0e8a16' }, bug: { name: 'bug', color: 'd73a4a' } };
// ----- end of the made-up part -----

const apps = ['claude-code', 'codex', 'opencode']; // made up: the connected apps (on the path, with the skills of Apostil)
// Made up: one more Claude Code session that Apostil knows in this repo, with what each session last used, and the models that a new session would take:
// Claude Code with no setting, Codex with the setting gpt-6-luna.
const sendTo: SendTo = {
  sessions: [{ app: 'claude-code', session: 'made-up-session-0002', name: 'Tests for holds', at: minutesAgo(4), run: sessionPick('claude-code', 'made-up-session-0002', undefined) }],
  models: { 'claude-code': menuOf('claude-code', undefined), codex: menuOf('codex', 'gpt-6-luna'), opencode: menuOf('opencode', undefined) },
  own: sessionPick('claude-code', agent.session, undefined),
};
const base = example?.base ?? baseOf(folder, currentBranch(folder));

// Home and the graphs pages, from a store of their own in a temporary folder: the change and the made-up map.
const mapFile = mapArg ?? (example ? join(__dirname, '../../view/example-map.json') : undefined);
const map: RepoMap | undefined = mapFile ? JSON.parse(readFileSync(mapFile, 'utf8')) : undefined;
const storeFolder = tempFolder('apostil-example-');
const store = new Store(storeFolder);
const changeId = store.saveChange({ repoId: repoId(folder), folder, branch: currentBranch(folder), base, head: headCommit(folder), file, checks: checkChangeFile(folder, base, file), agent });
const homeNoMap = { ...homeData(store, folder, apps, undefined, undefined, []), needsSetup: true }; // made up: no agent app has the skills yet
if (map) {
  const saved = saveMapDraft(store, folder, map); // by the same save as a map of an agent, so that its notes keep the text of their lines
  if (!saved.saved) throw new Error(`The save refused the example map: ${saved.problems.join(' ')}`);
}
// Made up: a question on a node of the map, and an answer that names code, a node of its diagram and another diagram.
if (example && map) {
  const asked = store.addRepoRemark(repoId(folder), { kind: 'node', diagram: 'lib-lending', node: 'service', label: 'Node "Hold service", diagram "Lending: holds, requests and mails"' }, 'Where does a hold start?');
  store.sendRemark(asked, { app: 'claude-code', kind: 'new' });
  store.answerRemark(asked, 'In place_hold, src/library/lending/hold_service.py:86-117, which keeps it with "Hold models"; its rows are in "The tables of holds".');
}
// The made-up marks and look (view/check-example/look/), saved as writers save them: the services first, which the default look shows;
// then the look with a second set and its marks. The files of the look are copied next to the page, which loads them as a file in a browser.
const lookFiles = join(__dirname, '../../view/media/example-look');
rmSync(lookFiles, { recursive: true, force: true });
mkdirSync(lookFiles, { recursive: true });
const address = (file: string): string => { copyFileSync(file, join(lookFiles, basename(file))); return `example-look/${basename(file)}`; };
const drafts: { set: string }[] = example ? JSON.parse(readFileSync(join(EXAMPLE_LOOK, 'marks.json'), 'utf8')) : [];
const put = example && map ? putLookFiles(folder) : undefined;
const must = (result: { saved: boolean; problems: string[] }, what: string): void => { if (!result.saved) throw new Error(`The save refused the example ${what}: ${result.problems.join(' ')}`); };
if (put) for (const draft of drafts.filter((one) => one.set === 'services')) must(addMarksToMap(store, folder, draft), 'marks');
const home = homeData(store, folder, apps, address, undefined, []);
// The graphs of the file of the browser check, and of every path that a node of the map opens: in the default look, as Home.
const graphPaths = new Set(['src/library/lending/hold_service.py']);
for (const diagram of home.map?.diagrams ?? []) for (const node of Object.values(diagram.nodes)) [node.graphs, ...node.paths.map((entry) => entry.path)].forEach((path) => graphPaths.add(path));
const graphs: Record<string, GraphsData> = Object.fromEntries([...graphPaths].map((path) => [path, graphsData(store, folder, path, address)]));
put?.clean(); // the files of the writers leave the repo before the page of the change reads its files

// Made up: a second agent read the flow chart; the other diagrams are not checked yet.
const page = examplePage(folder, base, file, points, remarks, agent, apps, map, changeId, ['offer-flow'], sendTo); // the id of the stored change, so that the graphs pages open this page

// Each made-up look of the example (view/check-example/look/look*.json), saved as a writer saves it, one after the other: "look.json" (with
// its second set and its marks) is "?look=1", "look-<name>.json" is "?look=<name>". Home and the note cards are read after each save.
const homeLooks: Record<string, HomeData> = {};
const pageLooks: Record<string, LookData | undefined> = {};
const graphsLooks: Record<string, Record<string, GraphsData>> = {}; // the graphs pages of a few paths in each look, for the browser checks
const LOOK_GRAPHS = ['db/migrations/0042_holds.sql', 'src/library/lending/requests.py'];
// The pages of each look, as "?look=<name>&page=<id>", and the blocks of each section of its own and window of a target, as the page asks for them.
const lookPages: Record<string, Record<string, CustomPageData>> = {};
const lookAnswers: Record<string, unknown> = {};
for (const name of put ? readdirSync(EXAMPLE_LOOK).filter((one) => /^look(-[a-z-]+)?\.json$/.test(one)).sort() : []) {
  const key = name === 'look.json' ? '1' : name.slice('look-'.length, -'.json'.length);
  const files = putLookFiles(folder);
  must(setLook(store, folder, JSON.parse(readFileSync(join(EXAMPLE_LOOK, name), 'utf8'))), name);
  if (key === '1') for (const draft of drafts.filter((one) => one.set !== 'services')) must(addMarksToMap(store, folder, draft), 'marks');
  files.clean();
  homeLooks[key] = homeData(store, folder, apps, address, undefined, []);
  pageLooks[key] = lookOfPage(store, page, address);
  const ids = (JSON.parse(readFileSync(join(EXAMPLE_LOOK, name), 'utf8')).pages ?? []).map((one: { id: string }) => one.id) as string[];
  lookPages[key] = Object.fromEntries(ids.map((id) => [id, pageData(store, folder, id, address)]));
  for (const [, ref] of JSON.stringify([homeLooks[key].look, lookPages[key]]).matchAll(/"ref":"([0-9a-f]+)"/g)) lookAnswers[`blocks:${ref}`] = blocksAnswer(store, folder, ref, address);
  graphsLooks[key] = Object.fromEntries(LOOK_GRAPHS.map((path) => [path, graphsData(store, folder, path, address)]));
}

// Made up: an earlier change, merged long ago, with a note on code that this change left alone. The file tab shows it beside its lines, with no colour.
const earlier = exampleEarlierChange(folder, base);
if (earlier) store.saveChange(earlier);

// The look of the note cards: a look of the example with "?look=<name>", else the default look, which shows the logos of the services.
const pageLook = pageLooks['1'] ?? lookOfPage(store, page, address);
page.look = pageLook && asDefault(pageLook);
const answers = Object.fromEntries(allQuestions(page).map((question) => [question, answer(page, question, (path, lines) => notesBeside(store, page, path, lines), (path) => marksBeside(store, page, path))]));
Object.assign(answers, lookAnswers);

// Made-up map runs, read from the store as Home reads them ("?run=<name>"): the run of Home, his own session in the desktop app (it opens there) and in a
// terminal (it opens in a terminal that continues it), and a run that stopped. Each saved the overview, 3 areas and the notes of 40 files.
const mapSession = '1a2b3c4d-0000-4000-8000-00000000cafe';
const savedSoFar = (run: MapRun | undefined, by: AgentSession | undefined): MapRun => {
  const at = minutesAgo(1);
  let next = withSave(run, { overview: true }, by, 8, at);
  for (const area of ['Lending', 'Desk', 'Catalogue']) next = withSave(next, { area }, by, 8, at);
  return withSave(next, { noteFiles: 40 }, by, 8, at);
};
const desktopRun = savedSoFar(undefined, { app: 'claude-code', session: mapSession, hostSession: 'made-up-host-0002', name: 'Map of library-app' });
const lineOf = (run: MapRun): MapRunLine | undefined => { store.changeMapRun(repoId(folder), () => run); return mapRunOf(store, repoId(folder)); };
// Made up: a run of Home that writes the whole map, with its plan of the work, in three states: before the overview ("reading", with
// "&nomap=1"), while the areas load ("areas": the areas of the top map done, two worked on now and two that wait), and the same run after one more save
// ("later"), with a new time left. The saves are made up; the time left and the bar come from the plan, as on Home.
const plan: MapPlan = { at: 0, done: 0, lines: 6400, overview: 1, areas: 3, notes: 16, noteFiles: 48, processes: 8, services: 8, again: 1, fit: 1 };
const planned = (minutes: number, saves: SaveTime[], parts: MapRun['parts']): MapRun => ({
  ...homeRun('claude-code', minutesAgo(minutes)), agent: { app: 'claude-code', session: mapSession }, parts, plan, saves, ...(saves.length ? { savedAt: minutesAgo(0.5) } : {}),
});
const loading: SaveTime[] = [['o', 7], ['a', 12], ['a', 13], ['n', 15, 6], ['n', 16, 6], ['n', 18, 6]];
const top = home.map?.diagrams.find((diagram) => diagram.id === home.map?.top);
const leading = Object.entries(top?.nodes ?? {}).filter(([, node]) => !node.quiet && (node.down || node.paths.length)).map(([key]) => key);
const areaStates = { [leading[1]]: { state: 'working', share: 0.45 }, [leading[3]]: { state: 'working', share: 0.2 } } as const;
// As VS Code sends it (home-page.ts): whole minutes, and the share of the bar to a thousandth.
const whole = (line: MapRunLine | undefined): MapRunLine | undefined => (line?.time ? { ...line, time: { minutes: Math.round(line.time.minutes), share: Math.round(line.time.share * 1000) / 1000 } } : line);
const withAreas = (line: MapRunLine | undefined): MapRunLine | undefined => (line ? { ...line, ...whole(line), areas: areaStates } : line);
const mapRuns = {
  home: lineOf(savedSoFar(homeRun('claude-code', minutesAgo(5)), { app: 'claude-code', session: mapSession })),
  terminal: lineOf(savedSoFar(undefined, { app: 'claude-code', session: mapSession })),
  stopped: lineOf(withEnd(desktopRun, minutesAgo(0), true)!),
  reading: whole(lineOf(planned(3, [], {}))),
  areas: withAreas(lineOf(planned(19, loading, { overview: true, areas: ['Lending', 'Desk'], ofAreas: 3, noteFiles: 18 }))),
  later: withAreas(lineOf(planned(19, [...loading, ['n', 18.5, 12]], { overview: true, areas: ['Lending', 'Desk'], ofAreas: 3, noteFiles: 30 }))),
  desktop: lineOf(desktopRun), // the last one: the row "Home" of the list reads it too
};
// The tab "Map run" ("?chart=live", "?chart=done"), read by the real reader from a made-up map session in the made-up agent home: 10 minutes in with
// 7 minutes left, and the same session after its run ended at minute 12.
const chartStart = Date.now() - 10 * 60_000;
const chartRun = { ...homeRun('claude-code', new Date(chartStart).toISOString(), mapSession), savedAt: minutesAgo(1) };
madeUpMapSession(agentHome, mapSession, chartStart);
const liveChart = mapRunChart(chartRun, agentHome, Date.now(), { minutesLeft: 7 });
madeUpMapSession(agentHome, mapSession, chartStart, true);
const charts = { live: liveChart, done: mapRunChart(withEnd(chartRun, new Date(chartStart + 12 * 60_000).toISOString())!, agentHome) };
const homeState = homeRowState(store, repoId(folder));
store.close();
rmSync(storeFolder, { recursive: true, force: true });

// The list: the example branch and a made-up second change of the same session, and one change with no agent.
const sum = (key: 'added' | 'removed'): number => page.files.reduce((total, changed) => total + changed[key], 0);
const row = (fields: Partial<ListRow>): ListRow => ({
  branch: page.branch, folder, age: '2 hours ago', savedAt: minutesAgo(120), commits: 3, files: page.files.length, added: sum('added'), removed: sum('removed'),
  phrase: '', open: false, remarks: { sent: 0, running: 0, done: 0 }, ...fields,
});
// Made up: the dates of the rows. Modified, newest first: the example branch, the follow-up, the change with no agent. Created: the follow-up, the example branch, the change with no agent (its first commit).
const rows = [
  row({ id: 0, open: true, agent: agentOf(agent), phrase: `${page.checks.filesInNoPart.length} files in no part`, remarks: { sent: 1, running: 1, done: 1 }, firstSavedAt: minutesAgo(26 * 60), firstCommitAt: minutesAgo(30 * 60) }),
  row({ id: 1, branch: 'made-up/follow-up', age: '3 hours ago', savedAt: minutesAgo(180), firstSavedAt: minutesAgo(200), firstCommitAt: minutesAgo(210), commits: 1, files: 2, added: 40, removed: 6, agent: agentOf(agent) }),
  row({ id: 2, branch: 'made-up/without-agent', age: '1 day ago', savedAt: minutesAgo(24 * 60), firstCommitAt: minutesAgo(50 * 60), commits: 2, files: 4, added: 120, removed: 30, phrase: 'out of date' }),
];
const pulls = {
  [page.branch]: [
    { ...pull(12, 'Holds for books that are out', 'checks failing', 1, {
      author: people.mira, labels: [labels.review, labels.borrowing], createdAt: minutesAgo(20 * 60), updatedAt: minutesAgo(30),
      reviewers: [{ person: people.lena, state: 'changes requested' }, { person: people.jonas, state: 'approved' }, { person: people.copilot, state: 'reviewed' }, { person: people.team, state: 'asked' }],
    }), stack: { number: 7, size: 3, position: 2 } },
    pull(11, 'First half of the holds', 'merged', 0, { author: people.jonas, labels: [labels.borrowing], createdAt: minutesAgo(40 * 60), updatedAt: minutesAgo(22 * 60) }),
    pull(10, 'A first try of holds', 'closed', 0, { author: people.mira, createdAt: minutesAgo(45 * 60), updatedAt: minutesAgo(41 * 60) }),
  ],
  'made-up/follow-up': [pull(14, 'Follow-up: the ready shelf', 'checks failing', 2, {
    author: people.jonas, labels: [labels.bug], createdAt: minutesAgo(170), updatedAt: minutesAgo(90), reviewers: [{ person: people.mira, state: 'asked' }],
  })],
};
const list = { repo: page.repo, groups: sessionGroups(rows), pulls };

// The made-up conversations of the two pull requests of the branch, as the page asks for them ("pull:<link>").
const conversation = examplePullRequest();
// The made-up pull request stands for the code of the example: its head is the code here, and its diff the diff of the change.
const lines = { atHead: true, dirty: [], files: diffRanges(tryGit(folder, 'diff', '-U3', '--no-color', '--no-ext-diff', base) ?? '') };
answers['pull:https://example.com/made-up/pull/12'] = { pull: pullRequestFrom(conversation.raw), lastLooked: conversation.lastLooked, lines };
answers['pull:https://example.com/made-up/pull/11'] = { pull: pullRequestFrom(exampleMergedPullRequest()) };
const pagePulls = pulls[page.branch].slice(0, 2); // the page knows the two that have a made-up conversation
const readyPull = pullRequestFrom(exampleReadyPullRequest()); // #12 as a read gives it once it can merge: the browser check puts it in place of #12

// The icons of the rows of Home and of the page in the made-up file icon theme (view/check-example/file-icons/), resolved as in VS Code
// with a dark colour theme; its files are copied next to the page.
const iconFiles = join(__dirname, '../../view/media/example-icons');
rmSync(iconFiles, { recursive: true, force: true });
mkdirSync(iconFiles, { recursive: true });
const iconAddress = (file: string): string => { copyFileSync(file, join(iconFiles, basename(file))); return `example-icons/${basename(file)}`; };
const iconTheme = readIconTheme(join(EXAMPLE_FILES, 'file-icons/icon-theme.json'));
if (!iconTheme) throw new Error('The made-up icon theme cannot be read.');
const iconLanguages = languagesOf([{ contributes: { languages: [{ id: 'python', extensions: ['.py'] }] } }]);
const icons = { home: iconsFor(iconTheme, homePaths(home.map), 'dark', iconLanguages, iconAddress), page: iconsFor(iconTheme, changePaths(page), 'dark', iconLanguages, iconAddress) };

const target = join(__dirname, '../../view/media/example-data.js');
writeFileSync(target, `// Written by view/example-data.ts. Not in Git.\n${iconScript(join(__dirname, '../../view/media'))}window.APOSTIL_EXAMPLE = ${JSON.stringify({ page, pageLooks, pagePulls, readyPull, answers, list, home, homeLooks, homeNoMap, graphs, lookPages, graphsLooks, mapRuns, charts, homeState, icons, askTeam: teamOf('claude-code', agentHome, true) })};\n`);
example?.remove();
rmSync(agentHome, { recursive: true, force: true });
console.log(`Wrote ${target}: ${page.files.length} files, ${page.parts.length} parts, ${Object.keys(answers).length} answers, ${rows.length} list rows, ${home.map?.diagrams.length ?? 0} map diagrams, ${Object.keys(graphs).length} graphs pages.`);
