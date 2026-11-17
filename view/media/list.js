// The list of changes in the sidebar, in the look of the page, under the row that opens Home and the search field. A click on a row opens its page.
// With an empty field and the default sort the rows stand under the heads of their agent sessions; a search, a filter or another sort makes one flat list.
'use strict';

let shown = { repo: '', groups: [] }; // what VS Code sent last
const pulls = {}; // the pull requests of each branch, as they arrive after the list is drawn
const unfolded = new Set(); // what the owner unfolded: a branch (its pull requests), and for the session at place n "more:n" and "history:n"
let search = { ...Search.DEFAULT }; // the text of the field and the sort; VS Code keeps them for the repo
let searchOf; // the repo whose kept search the page took
let look; // the look of the repo when one is saved (VS Code sends it with the rows); with none the list is drawn as before
const targets = []; // the click targets of the look on the parts drawn last, by their data-lk
let repoPulls = { pulls: [] }; // the open pull requests of the repo and why there are none, as they arrive; `problem` is the failure of gh in a sentence
const SHOWN_PULLS = 20; // pull requests with no change that show before the line "n more"
const pullsOf = (row) => (row.only ? [row.only] : pulls[row.branch] ?? []);
/** The slots that the look gives a part of the list (PartLook in part-look.js); none with no look. */
const part = (kind, fields) => PartLook.slotsOf(look, kind, fields);
/** The attribute that sends a click of a part to the target of its rule, or nothing. */
const clickOf = (target) => (target ? ` data-lk="${targets.push(target) - 1}"` : '');

/**
 * One pull request: the avatar of its author, the icon of its state, its number and its state word; the check counts only when a check failed;
 * a quiet "2/3" for its place in a stack; its reviewers small at the right end. A click opens its conversation. A rule of the look gives its line
 * a colour and an icon, the parts that show in their order, and a click; another hides or sizes the avatars.
 */
function pullLine(pull) {
  const own = part('pull-line', { number: pull.number, state: pull.state, checks: PartLook.checksWord(pull.checks) });
  const faces = part('avatars');
  const size = faces['text.size'] === 'large' ? 's' : 'xs';
  const people = faces['show.shown'] !== false;
  const color = PartLook.wordsAttrs(own['text.color']);
  const icon = PartLook.iconHtml(look, own['text.icon']) || States.pullIcon(pull);
  const failed = pull.checks.failed ? esc(States.WORDS.failedChecks(pull.checks)) : '';
  const bits = {
    author: people && pull.author ? avatar(pull.author, size) : '',
    number: `<span class="pn" title="${esc(pull.title)}">#${pull.number}</span>`,
    state: `<span class="pw" title="${esc(pull.title)}">${esc(pull.state)}${!own.content && failed ? ` · ${failed}` : ''}</span>`,
    checks: failed && `<span class="pw">${failed}</span>`,
    stack: pull.stack ? `<i class="place" title="${esc(States.WORDS.inStack(pull.stack))}">${esc(States.WORDS.stackMark(pull.stack))}</i>` : '',
    reviewers: people && pull.reviewers?.length ? reviewerFaces(pull.reviewers, size) : '',
  };
  const shown = own.content?.fields ?? ['author', 'number', 'state', 'stack', 'reviewers']; // with no rule the checks stand in the state words
  const [first, ...rest] = shown.filter((name) => name !== 'author').map((name) => bits[name]);
  return `<a class="pr${color.cls}"${color.style} data-pull="${pull.number}"${clickOf(own.click)}>${shown.includes('author') ? bits.author : ''}${icon}${first ?? ''}${rest.join('')}</a>`;
}

/** The place in a stack of the first pull request of a row that is in one. */
const stackPlace = (row) => pullsOf(row).find((pull) => pull.stack)?.stack;

/** The state line of a row; a rule gives it other words (with {state}) and an icon in place of its dot. */
function stateHtml(row) {
  const line = States.rowLine(row.remarks, row.phrase);
  const state = States.rowState(row.remarks, row.phrase);
  const own = part('row-state', { state });
  const text = own.content?.words !== undefined ? Marks.fillText(own.content.words, { state }) : line.text;
  const icon = PartLook.iconHtml(look, own['text.icon']);
  return icon && text ? `<span class="state">${icon}${esc(text)}</span>` : States.lineHtml({ ...line, text });
}

const FACTS = ['age', 'commits', 'files', 'added', 'removed', 'author'];
/** The facts line of a row: age, commits, files, added and removed lines; a rule names the facts that show, in their order (`names`). */
function factsHtml(row, fields, names) {
  if (!names) return `<div class="mt">${esc(row.age)} · ${plural(row.commits, 'commit')} · ${plural(row.files, 'file')} · <span class="lc">${countsHtml(row) || '+0'}</span></div>`;
  const parts = [];
  names.forEach((name, at) => {
    if (name === 'removed' && names[at - 1] === 'added') return; // added and removed side by side are one count, as with no rule
    const counts = name === 'added' ? { added: row.added, removed: names[at + 1] === 'removed' ? row.removed : 0 } : { removed: row.removed };
    const one = { age: esc(row.age), commits: plural(row.commits, 'commit'), files: plural(row.files, 'file'), author: esc(fields.author) }[name]
      ?? `<span class="lc">${countsHtml(counts) || (name === 'added' ? '+0' : '−0')}</span>`;
    if (one) parts.push(one);
  });
  return parts.length ? `<div class="mt">${parts.join(' · ')}</div>` : '';
}

/**
 * One row: branch and its state line, then age, commits, files, added and removed lines, then its own pull requests: at most two, and the fold for more in the row.
 * `own`: the pull requests that show (a search can keep fewer). `flat`: in the flat list of a search the icon of the agent app stands before the branch.
 * A rule of the look gives a row the facts that show in their order, a colour, and a click; and the older pull requests open or hidden.
 */
function listRow(row, own = pullsOf(row), flat = false) {
  if (row.only) return pullRow(row.only);
  const fields = PartLook.rowFields(row, pullsOf(row));
  const lk = part('change-row', fields);
  const shows = lk.content?.fields;
  const show = PartLook.shows(shows);
  const facts = part('row-facts', fields).content?.fields ?? shows?.filter((name) => FACTS.includes(name));
  const box = PartLook.boxAttrs(lk['box.color']);
  const older = part('more-pulls');
  const folded = States.foldPulls(own, unfolded.has(row.branch) || older['show.folded'] === false ? Infinity : 2);
  const app = shows ? shows.includes('app') : flat;
  return `<div class="row${row.open ? ' sel' : ''}${flat ? ' flat' : ''}${box.cls}"${box.style}${row.id !== undefined ? ` data-id="${row.id}"` : row.commits || row.files ? '' : ' data-home-row'}${clickOf(lk.click)}>`
    + `<div class="top">${app ? (row.agent && agentIcon(row.agent)) || '<span class="icon"></span>' : ''}${show('branch') ? `<span class="nm">${esc(row.branch)}</span>` : ''}${show('state') ? stateHtml(row) : ''}</div>`
    + (row.uncounted ? `<div class="mt">${esc(row.age)} · ${esc(row.uncounted)}</div>` : factsHtml(row, fields, facts))
    + folded.shown.map(pullLine).join('')
    + (folded.more && older['show.shown'] !== false ? `<a class="more" data-unfold="${esc(row.branch)}">${esc(States.WORDS.morePulls(folded.more))}</a>` : '')
    + '</div>';
}

/** A row for a pull request with no stored change, so that the search, the sort and the look read it as any row. */
const pullAsRow = (pull) => ({ only: pull, branch: pull.branch ?? '', age: '', savedAt: pull.updatedAt ?? pull.createdAt ?? '', firstSavedAt: pull.createdAt, commits: 0, files: 0, added: 0, removed: 0, phrase: '', open: false, remarks: { sent: 0, running: 0, done: 0 } });

/** The open pull requests that have no row: those whose branch has a row show under it already. */
const pullRows = () => {
  const branches = new Set(shown.groups.flatMap((group) => group.rows.map((row) => row.branch)));
  return repoPulls.pulls.filter((pull) => !branches.has(pull.branch)).map(pullAsRow);
};

/** One pull request with no stored change: its title, then its line (number and state). A click opens its page. */
const pullRow = (pull) => `<div class="row prow" data-pull="${pull.number}"><div class="top"><span class="nm" title="${esc(pull.title)}">${esc(pull.title)}</span></div>${pullLine(pull)}</div>`;

/**
 * The head "Pull requests" and the open pull requests with no change, the first 20 and a line for the rest; or one quiet line that says why gh gave none.
 * With a rule of the look that orders the rows, the rows stand in that order.
 */
function repoPullsHtml(order) {
  if (repoPulls.problem) return `<div class="eyebrow">${esc(States.WORDS.pullRequests)}</div><div class="note">${esc(repoPulls.problem)}</div>`;
  const rows = pullRows();
  if (!rows.length) return '';
  const ordered = order ? PartLook.rowGroups([{ rows }], pullsOf, { ...order, group: undefined })[0]?.rows ?? [] : rows;
  const all = unfolded.has('repo-pulls');
  return `<div class="eyebrow">${esc(States.WORDS.pullRequests)}</div>${ordered.slice(0, all ? Infinity : SHOWN_PULLS).map((row) => pullRow(row.only)).join('')}`
    + (ordered.length > SHOWN_PULLS ? foldLine('repo-pulls', all, all ? States.WORDS.fewer : States.WORDS.nMore(ordered.length - SHOWN_PULLS)) : '');
}

/** The head of a session; a rule gives it other words (with {name} and {app}) and an icon in place of the icon of its app. */
function sessionHead(agent) {
  const fields = { app: agent.app, name: agent.name ?? '' };
  const own = part('session-head', fields);
  const words = own.content?.words;
  return agentHead(words === undefined ? agent : { ...agent, name: Marks.fillText(words, fields) }, PartLook.iconHtml(look, own['text.icon']) || undefined);
}

/** A line that opens or folds a set of rows: a small arrow and the words. */
const foldLine = (key, open, words, tip = '') => `<a class="fold" data-unfold="${esc(key)}"${tip ? ` title="${esc(tip)}"` : ''}><span class="chev">${open ? '▾' : '▸'}</span>${esc(words)}</a>`;

/**
 * The rows of one agent session under its head: at most two with an open pull request, and a line that shows the others.
 * The rows whose pull requests are all merged or closed are under "History", folded at first.
 */
function groupHtml(group, index) {
  const rows = States.stackOrder(group.rows, stackPlace);
  const sets = States.foldRows(rows, pullsOf);
  const all = unfolded.has(`more:${index}`), old = unfolded.has(`history:${index}`);
  return `<div class="grp">${group.agent ? sessionHead(group.agent) : ''}`
    + rows.filter((row) => sets.shown.includes(row) || (all && sets.more.includes(row))).map((row) => listRow(row)).join('')
    + (sets.more.length ? foldLine(`more:${index}`, all, all ? States.WORDS.fewer : States.WORDS.morePulls(sets.more.length)) : '')
    + (sets.history.length ? foldLine(`history:${index}`, old, States.WORDS.history(sets.history.length), States.WORDS.historyTip) : '')
    + (old ? sets.history.map((row) => listRow(row)).join('') : '')
    + '</div>';
}

/**
 * The rows that match the search, in the order of the sort, as one list with no heads and no folds of rows; "History" rows match too.
 * The line above them says how many match, or that none does, with a link that clears the field. While he picked no sort, the order of a
 * rule of the look (`order`) orders them.
 */
function flatHtml(rows, query, order) {
  const found = new Map();
  for (const row of rows) {
    const own = Search.match(row, pullsOf(row), query);
    if (own) found.set(row, own);
  }
  const line = !Search.active(query) ? esc(States.WORDS.changes)
    : found.size ? esc(States.WORDS.matching(found.size, rows.length))
    : `${esc(States.WORDS.noMatch)} · <a data-clear>${esc(States.WORDS.clear)}</a>`;
  const sorted = Search.sortRows([...found.keys()], pullsOf, search.sort, search.reverse);
  const ordered = order ? PartLook.rowGroups([{ rows: sorted }], pullsOf, { ...order, group: undefined })[0]?.rows ?? [] : sorted; // one group: no heads
  return `<div class="eyebrow">${line}</div>` + ordered.map((row) => listRow(row, found.get(row), true)).join('');
}

/**
 * The list in the order of a rule of the look, while the field is empty and he picked no sort: the groups of PartLook.rowGroups, each with its head
 * (a session, or the value of the field that groups), no folds of rows.
 */
function orderedHtml(order) {
  const head = (group) => (group.by === 'session' ? (group.agent ? sessionHead(group.agent) : '') : group.by ? `<div class="head"><span class="ses">${esc(group.value ?? '')}</span></div>` : '');
  return `<div class="eyebrow">${esc(States.WORDS.changes)}</div>`
    + PartLook.rowGroups(shown.groups, pullsOf, order).map((group) => `<div class="grp">${head(group)}${group.rows.map((row) => listRow(row, undefined, group.by !== 'session')).join('')}</div>`).join('') + repoPullsHtml(order);
}

// ----- the search field -----

/** The field, built once, so that typing keeps its place: the words "Search changes" while it is empty, a clear mark, and "Sort and filter" (VS Code's own menu, asked for by `askMenu`). */
const findHtml = () => {
  const words = States.WORDS;
  return `<div class="find"><input class="q" type="text" placeholder="${esc(words.searchChanges)}" aria-label="${esc(words.searchChanges)}" spellcheck="false" autocomplete="off">`
    + `<span class="ends"><button type="button" class="clear" data-clear title="${esc(words.clearSearch)}" aria-label="${esc(words.clearSearch)}" hidden>${ico('x')}</button>`
    + `<button type="button" class="sf" data-menu title="${esc(words.sortAndFilter)}" aria-label="${esc(words.sortAndFilter)}">${ico('filter')}<i class="on" hidden></i></button></span></div>`;
};

/** The field and its marks as the search is: the text, the clear mark, and the dot of a sort or a filter that is on. */
function markField(query) {
  const find = document.querySelector('.find');
  const field = find.querySelector('.q');
  if (field.value !== search.text) field.value = search.text;
  find.classList.toggle('typed', !!search.text);
  find.querySelector('.clear').hidden = !search.text;
  find.querySelector('.sf .on').hidden = Search.defaultSort(search) && !query.words.length;
}

/** The row "Home": the mark of Apostil, "Home" and the name of the repo; a rule gives it an icon of the look and other words (with {repo}). */
function drawHome(home) {
  const own = part('home-row', { repo: shown.repo });
  const words = own.content?.words;
  home.innerHTML = `<img class="mark" src="${esc(look?.files?.[own['text.icon']] ?? 'apostil.svg')}" alt="">`
    + (words === undefined ? `Home<span class="repo">${esc(shown.repo)}</span>` : esc(Marks.fillText(words, { repo: shown.repo })));
}

function draw() {
  const list = document.getElementById('list');
  if (!list.firstElementChild) list.innerHTML = `<a class="home" data-home></a>${findHtml()}<div class="changes"></div>`;
  drawHome(list.querySelector('.home'));
  targets.length = 0;
  const rows = shown.groups.flatMap((group) => group.rows);
  const query = Search.parse(search.text);
  const order = Search.defaultSort(search) ? PartLook.rowOrder(look) : null; // a sort that he picked wins over the order of the look
  list.querySelector('.changes').innerHTML = Search.active(query) || !Search.defaultSort(search) ? flatHtml([...rows, ...pullRows()], query, order)
    : order ? orderedHtml(order)
    : `<div class="eyebrow">${esc(States.WORDS.changes)}</div>${shown.groups.map(groupHtml).join('')}${repoPullsHtml()}`; // no first words here: the press that maps a repo, the set-up step and the example are on Home
  markField(query);
  return rows.length;
}

/** A new text or sort: VS Code keeps it for the repo, and the list is drawn again. */
function setSearch(change) {
  search = { ...search, ...change };
  tell({ type: 'search', search });
  draw();
}

/**
 * "Sort and filter": sends the values of the filters (with their counts) and the search to VS Code, which shows them in its own quick pick.
 * The values are counted here, in search.js, and nowhere else.
 */
function askMenu() {
  tell({ type: 'menu', values: Search.menuValues([...shown.groups.flatMap((group) => group.rows), ...pullRows()], pullsOf), search });
}

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.type === 'rows') {
    look = message.look;
    // The search kept for this repo; with none kept, the words of a rule of the look.
    if (message.repo !== searchOf) { searchOf = message.repo; search = { ...Search.DEFAULT, ...PartLook.startSearch(message.search, part('list-search').content?.words) }; }
    shown = message;
    tell({ type: 'rendered', rows: draw() }); // VS Code loads the pull requests after this
  }
  if (message?.type === 'search') { search = { ...Search.DEFAULT, ...message.search }; draw(); } // a pick in the quick pick of VS Code
  if (message?.type === 'askMenu') askMenu(); // the command "Apostil: Sort and Filter the Changes"
  if (message?.type === 'repoPulls') {
    repoPulls = { pulls: message.pulls ?? [], problem: message.problem };
    draw();
  }
  if (message?.type === 'pulls') {
    pulls[message.branch] = message.pulls;
    draw();
  }
});

document.addEventListener('input', (event) => {
  if (event.target.matches?.('.find .q')) setSearch({ text: event.target.value });
});

// Escape in the field empties it. Down in the field opens "Sort and filter".
document.addEventListener('keydown', (event) => {
  const inField = event.target.matches?.('.find .q');
  if (event.key === 'Escape' && inField && search.text) return setSearch({ text: '' });
  if (event.key === 'ArrowDown' && inField) { event.preventDefault(); askMenu(); }
});

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-link]')) return; // tools.js opens links
  if (event.target.closest('[data-menu]')) return askMenu();
  if (event.target.closest('[data-clear]')) { setSearch({ text: '' }); document.querySelector('.find .q').focus(); return; }
  const unfold = event.target.closest('[data-unfold]');
  if (unfold) { const key = unfold.dataset.unfold; if (!unfolded.delete(key)) unfolded.add(key); draw(); return; } // a line of a session opens and folds; the fold of a row only opens, since it goes away
  const home = event.target.closest('[data-home]');
  if (home) { const own = part('home-row', { repo: shown.repo }); return own.click ? Marks.act(own.click, home) : tell({ type: 'home' }); }
  if (event.target.closest('[data-setup]')) return; // tools.js tells VS Code
  const pull = event.target.closest('[data-pull]');
  const row = event.target.closest('[data-id]');
  // A click of the look: the target of the innermost part that has one; a pull request line of its own wins over the click of its row.
  const lk = event.target.closest('[data-lk]');
  if (lk && !(pull && pull !== lk && lk.contains(pull))) return Marks.act(targets[Number(lk.dataset.lk)], lk);
  if (pull && row) return tell({ type: 'openPull', id: Number(row.dataset.id), number: Number(pull.dataset.pull) });
  if (pull) return tell({ type: 'openRepoPull', number: Number(pull.dataset.pull), url: repoPulls.pulls.find((one) => one.number === Number(pull.dataset.pull))?.url }); // a pull request with no stored change
  if (event.target.closest('[data-home-row]')) return tell({ type: 'home' }); // the open branch with no commit and no changed file: Home
  if (row) tell({ type: 'open', id: Number(row.dataset.id) });
});

// Start: inside VS Code ask for the rows; as a file in a browser, show the example list of example-data.js.
if (vscodeApi) {
  tell({ type: 'ready' });
} else {
  const script = document.createElement('script');
  script.nonce = document.currentScript?.nonce;
  script.src = 'example-data.js';
  script.onload = () => {
    const { list, pageLooks } = window.APOSTIL_EXAMPLE;
    const key = new URLSearchParams(location.search).get('look'); // a made-up look of the example: "?look=side-bar"
    look = key ? pageLooks[key] : undefined;
    search = { ...search, ...PartLook.startSearch(undefined, part('list-search').content?.words) };
    shown = list;
    draw();
    setTimeout(() => { Object.assign(pulls, list.pulls); repoPulls = list.repoPulls ?? repoPulls; draw(); window.apostilListDone = true; }, 50); // as in VS Code: pull requests come later
  };
  document.head.append(script);
}
