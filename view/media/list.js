// The list of changes in the sidebar, in the look of the page, under the row that opens Home and the search field. A click on a row opens its page.
// With an empty field and the default sort the rows stand under the heads of their agent sessions; a search, a filter or another sort makes one flat list.
'use strict';

let shown = { repo: '', groups: [] }; // what VS Code sent last
const pulls = {}; // the pull requests of each branch, as they arrive after the list is drawn
const unfolded = new Set(); // what the owner unfolded: a branch (its pull requests), and for the session at place n "more:n" and "history:n"
let search = { ...Search.DEFAULT }; // the text of the field and the sort; VS Code keeps them for the repo
let searchOf; // the repo whose kept search the page took
const pullsOf = (row) => pulls[row.branch] ?? [];

/**
 * One pull request: the avatar of its author, the icon of its state, its number and its state word; the check counts only when a check failed;
 * a quiet "2/3" for its place in a stack; its reviewers small at the right end. A click opens its conversation.
 */
const pullLine = (pull) => `<a class="pr" data-pull="${pull.number}">${pull.author ? avatar(pull.author, 'xs') : ''}${States.pullIcon(pull)}<span class="pn" title="${esc(pull.title)}">#${pull.number}</span>`
  + `<span class="pw" title="${esc(pull.title)}">${esc(pull.state)}${pull.checks.failed ? ` · ${esc(States.WORDS.failedChecks(pull.checks))}` : ''}</span>`
  + `${pull.stack ? `<i class="place" title="${esc(States.WORDS.inStack(pull.stack))}">${esc(States.WORDS.stackMark(pull.stack))}</i>` : ''}${pull.reviewers?.length ? reviewerFaces(pull.reviewers, 'xs') : ''}</a>`;

/** The place in a stack of the first pull request of a row that is in one. */
const stackPlace = (row) => pullsOf(row).find((pull) => pull.stack)?.stack;

/**
 * One row: branch and its state line, then age, commits, files, added and removed lines, then its own pull requests: at most two, and the fold for more in the row.
 * `own`: the pull requests that show (a search can keep fewer). `flat`: in the flat list of a search the icon of the agent app stands before the branch.
 */
function listRow(row, own = pullsOf(row), flat = false) {
  const folded = States.foldPulls(own, unfolded.has(row.branch) ? Infinity : 2);
  return `<div class="row${row.open ? ' sel' : ''}${flat ? ' flat' : ''}"${row.id !== undefined ? ` data-id="${row.id}"` : ''}>`
    + `<div class="top">${flat ? (row.agent && agentIcon(row.agent)) || '<span class="icon"></span>' : ''}<span class="nm">${esc(row.branch)}</span>${States.lineHtml(States.rowLine(row.remarks, row.phrase))}</div>`
    + `<div class="mt">${esc(row.age)} · ${plural(row.commits, 'commit')} · ${plural(row.files, 'file')} · <span class="lc">${countsHtml(row) || '+0'}</span></div>`
    + folded.shown.map(pullLine).join('')
    + (folded.more ? `<a class="more" data-unfold="${esc(row.branch)}">${esc(States.WORDS.morePulls(folded.more))}</a>` : '')
    + '</div>';
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
  return `<div class="grp">${group.agent ? agentHead(group.agent) : ''}`
    + rows.filter((row) => sets.shown.includes(row) || (all && sets.more.includes(row))).map((row) => listRow(row)).join('')
    + (sets.more.length ? foldLine(`more:${index}`, all, all ? States.WORDS.fewer : States.WORDS.morePulls(sets.more.length)) : '')
    + (sets.history.length ? foldLine(`history:${index}`, old, States.WORDS.history(sets.history.length), States.WORDS.historyTip) : '')
    + (old ? sets.history.map((row) => listRow(row)).join('') : '')
    + '</div>';
}

/**
 * The rows that match the search, in the order of the sort, as one list with no heads and no folds of rows; "History" rows match too.
 * The line above them says how many match, or that none does, with a link that clears the field.
 */
function flatHtml(rows, query) {
  const found = new Map();
  for (const row of rows) {
    const own = Search.match(row, pullsOf(row), query);
    if (own) found.set(row, own);
  }
  const line = !Search.active(query) ? esc(States.WORDS.changes)
    : found.size ? esc(States.WORDS.matching(found.size, rows.length))
    : `${esc(States.WORDS.noMatch)} · <a data-clear>${esc(States.WORDS.clear)}</a>`;
  return `<div class="eyebrow">${line}</div>`
    + Search.sortRows([...found.keys()], pullsOf, search.sort, search.reverse).map((row) => listRow(row, found.get(row), true)).join('');
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

function draw() {
  const list = document.getElementById('list');
  if (!list.firstElementChild) list.innerHTML = `<a class="home" data-home><img class="mark" src="apostil.svg" alt="">Home<span class="repo"></span></a>${findHtml()}<div class="changes"></div>`;
  list.querySelector('.home .repo').textContent = shown.repo;
  const rows = shown.groups.flatMap((group) => group.rows);
  const query = Search.parse(search.text);
  list.querySelector('.changes').innerHTML = Search.active(query) || !Search.defaultSort(search) ? flatHtml(rows, query)
    : `<div class="eyebrow">${esc(States.WORDS.changes)}</div>${shown.groups.map(groupHtml).join('')}`; // no first words here: the press that maps a repo, the set-up step and the example are on Home
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
  tell({ type: 'menu', values: Search.menuValues(shown.groups.flatMap((group) => group.rows), pullsOf), search });
}

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.type === 'rows') {
    if (message.repo !== searchOf) { searchOf = message.repo; search = { ...Search.DEFAULT, ...message.search }; } // the search kept for this repo
    shown = message;
    tell({ type: 'rendered', rows: draw() }); // VS Code loads the pull requests after this
  }
  if (message?.type === 'search') { search = { ...Search.DEFAULT, ...message.search }; draw(); } // a pick in the quick pick of VS Code
  if (message?.type === 'askMenu') askMenu(); // the command "Apostil: Sort and Filter the Changes"
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
  if (event.target.closest('[data-home]')) return tell({ type: 'home' });
  if (event.target.closest('[data-setup]')) return; // tools.js tells VS Code
  const pull = event.target.closest('[data-pull]');
  const row = event.target.closest('[data-id]');
  if (pull && row) return tell({ type: 'openPull', id: Number(row.dataset.id), number: Number(pull.dataset.pull) });
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
    const { list } = window.APOSTIL_EXAMPLE;
    shown = list;
    draw();
    setTimeout(() => { Object.assign(pulls, list.pulls); draw(); window.apostilListDone = true; }, 50); // as in VS Code: pull requests come later
  };
  document.head.append(script);
}
