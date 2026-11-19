// The view "Conversation" of a pull request: the status strip with its checks, the title with the side facts, the folded description,
// and the messages from GitHub in a window of their own, in two looks. "Messages" reads like a calm chat: groups of one person, his own words at the right, day lines, calm folds.
// "Classic" reads like GitHub's own conversation tab: boxes on a line, events with their icons, a merge box, a side column.
// The HTML of a description or a comment was cleaned when it was read (shared/clean-html.ts); every other text is escaped here.
// The owner writes to GitHub from here: an answer in a thread, Resolve, a comment at the end, a review from the strip. Nothing is sent
// unless he sends it with a button or Cmd+Enter, and a failed send is never sent again by itself.
'use strict';

const Conversation = (() => {
  const FEW = 4; // more earlier messages than this fold into one row
  const KEEP_OPEN = 2; // the newest messages before the line that stay open
  const SAME_MINUTES = 5; // messages of one author within this time share one avatar
  const LONG_LINES = 25; // a longer message shows its first lines and "Show all"
  const CODE_LINES = 6; // the lines of code that a thread shows before its fold
  const CLASSIC_LONG = 60; // "Classic" hides the middle of a longer conversation, as GitHub does
  const CLASSIC_HEAD = 15;
  const CLASSIC_TAIL = 30;

  let chosen = kept.conversationMode; // "messages" or "classic" as he chose last, kept for the window
  let mode = 'messages'; // set by each drawing: his choice, else the look of the repo, else "Messages"
  let checksOpen = false; // the list of checks under the strip
  const earlyRows = new Map(); // the folded code lines of each thread, drawn when he opens them

  // The look of the repo on the parts of a pull request (PartLook in part-look.js, LOOK_PARTS in shared/look.ts). With no rule for a part, it keeps its default look.
  const pageLook = () => App.page?.look;
  const own = (kind, fields) => PartLook.slotsOf(pageLook(), kind, fields);
  const lookIcon = (name) => PartLook.iconHtml(pageLook(), name);
  /** True when the look does not open a fold of this kind at the start: the earlier messages, a run of events, a run of commits. */
  const folds = (of) => own('fold', { of })['show.folded'] !== false;

  // ----- small parts -----

  const MINUTE = 60_000;
  const DAY = 24 * 60 * MINUTE;
  /** "5 minutes ago", "yesterday", "3 days ago", or the date. `short`: "5 min ago", "19 h ago". */
  function ago(iso, short = false) {
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms)) return '';
    const minutes = Math.round(ms / MINUTE);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return short ? `${minutes} min ago` : `${plural(minutes, 'minute')} ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return short ? `${hours} h ago` : `${plural(hours, 'hour')} ago`;
    const days = Math.round(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 31) return `${days} days ago`;
    return `on ${dateWords(iso, true)}`;
  }
  const dateWords = (iso, year = new Date(iso).getFullYear() !== new Date().getFullYear()) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', ...(year ? { year: 'numeric' } : {}) });
  const exact = (iso) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  // The time has one place in each look. "Classic": it follows the words ("commented 3 days ago"), as on GitHub.
  // "Messages": one time for a group of messages, in the name line of its first message ("mira-k · 19 h ago", the dot drawn by look.css);
  // the exact date and time is its tooltip, and the tooltip of a later message of the group. Rows on the line have no time.
  const when = (iso) => `<span class="t time" title="${esc(exact(iso))}">${esc(ago(iso))}</span>`;
  const timeAgo = (iso) => `<span class="t time ago" title="${esc(exact(iso))}">${esc(ago(iso, true))}</span>`;
  /** The exact time as the tooltip of a thing that shows no time. */
  const exactTip = (iso) => ` title="${esc(exact(iso))}"`;
  const edited = (flag) => (flag ? '<span class="t">edited</span>' : '');
  /** "edited"; "sending" on his words while GitHub has not answered yet; "example" on an item that a send in the example page added. */
  const marksOf = (said) => `${edited(said.edited)}${said.sending ? `<span class="t ex">${esc(WRITE.sendingMark)}</span>` : said.example ? `<span class="t ex">${esc(WRITE.example)}</span>` : ''}`;
  /** "Today", "Yesterday" or "3 November": the line between the days of "Messages". */
  function dayWord(iso) {
    const start = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const days = Math.round((start(new Date()) - start(new Date(iso))) / DAY);
    return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : dateWords(iso);
  }
  const dayKey = (iso) => new Date(iso).toDateString();

  // ico(), avatar(), labelRgb(), REVIEWER_LOOK and reviewerFaces() are in tools.js: the list of the side bar draws people with them too.
  const name = (person) => `<b>${esc(person.login)}</b>${person.bot ? '<i class="bot">bot</i>' : ''}`;
  /** His own name on his own message in "Messages": for a screen reader only, since the message stands at the right with no avatar and no name, as in a chat app. */
  const ownName = (person) => `<b class="sr">${esc(person.login)}</b>`;
  /** The reactions as small chips; none when a rule of the look leaves them out. */
  const chips = (list) => (list.length && own('reaction')['show.shown'] !== false ? `<div class="react">${list.map((one) => `<span class="chip">${one.emoji} ${one.count}</span>`).join('')}</div>` : '');
  const plainText = (markup) => { const box = document.createElement('template'); box.innerHTML = markup; return box.content.textContent.replace(/\s+/g, ' ').trim(); };

  /** A label as a pill in its own colour, readable on light and dark themes; a long name is cut, with the whole name in its title. A rule gives it another colour and an icon. */
  function labelPill(label) {
    const look = own('label', { name: label.name });
    return `<span class="lbl" style="--lc:${labelRgb(PartLook.labelColor(look['box.color']) ?? label)}" title="${esc(label.name)}">${lookIcon(look['text.icon'])}${esc(label.name)}</span>`;
  }
  /** The labels that no rule leaves out. */
  const shownLabels = (pull) => pull.labels.filter((label) => own('label', { name: label.name })['show.shown'] !== false);

  /** A branch name as a code pill; a long one is cut in the middle, with the whole name in its title. */
  function branchPill(branch) {
    const shown = branch.length > 36 ? `${branch.slice(0, 18)}…${branch.slice(-14)}` : branch;
    return `<code class="br" title="${esc(branch)}">${esc(shown)}</code>`;
  }

  /** The words of the lines of a thread: "12–14", "whole file", "file removed". */
  const linesWord = (thread) => (thread.fileRemoved ? 'file removed' : thread.wholeFile ? 'whole file' : !thread.lines ? '' : thread.lines[0] === thread.lines[1] ? `${thread.lines[0]}` : `${thread.lines[0]}–${thread.lines[1]}`);

  /** About how many lines a piece of HTML takes: its blocks, its line breaks in code, and its length. */
  function lineCount(markup) {
    const blocks = (markup.match(/<(p|li|br|tr|h[1-6]|blockquote|details|div)\b/g) ?? []).length;
    const codeBreaks = (markup.match(/<pre[\s\S]*?<\/pre>/g) ?? []).reduce((sum, pre) => sum + pre.split('\n').length, 0);
    return blocks + codeBreaks + Math.floor(markup.replace(/<[^>]+>/g, '').length / 110);
  }

  /** The text of a message: the formatted HTML, folded to its first lines when it is long. */
  function textHtml(markup) {
    if (!markup) return '';
    if (lineCount(markup) <= LONG_LINES) return `<div class="tx md">${markup}</div>`;
    return `<div class="long" data-box><div class="tx md">${markup}</div><a class="more" data-toggle><span class="show">Show all</span><span class="hide">Show less</span></a></div>`;
  }

  /** A heading at the start of a message is its title line: { title, rest }, or null. */
  function headingOf(markup) {
    const match = /^\s*<h([1-6])>([\s\S]*?)<\/h\1>/.exec(markup ?? '');
    return match ? { title: plainText(match[2]), rest: markup.slice(match[0].length) } : null;
  }

  // ----- the checks, the deployments and the merge sentence -----

  const CHECK_LOOK = {
    failed: ['x-circle-fill', 'bad'], 'timed out': ['x-circle-fill', 'bad'], 'needs action': ['alert', 'wait'], cancelled: ['stop', 'quiet'],
    waiting: ['clock', 'wait'], running: ['dot-fill', 'wait'], passed: ['check-circle-fill', 'ok'], neutral: ['check-circle', 'quiet'], skipped: ['skip', 'quiet'],
  };
  const STATE_ORDER = ['failed', 'timed out', 'needs action', 'cancelled', 'waiting', 'running', 'neutral', 'passed', 'skipped'];
  const isFailed = (check) => ['failed', 'timed out', 'needs action', 'cancelled'].includes(check.state);

  /** The checks in a few words. A list that was cut never says "all passed". */
  function checksLine(pull) {
    const { checks } = pull;
    const total = checks.passed + checks.failed + checks.pending;
    if (!total) return { text: 'no checks', dot: 'none' };
    if (checks.failed) return { text: States.WORDS.failedChecks(checks), dot: 'red' };
    if (checks.pending) return { text: `${number(checks.pending)} of ${number(total)} checks running`, dot: 'amber' };
    if (pull.cut.checks) return { text: `${total} checks read, all passed; ${number(pull.cut.checks)} more not read`, dot: 'teal' };
    return { text: total === 1 ? 'the check passed' : `all ${number(total)} checks passed`, dot: 'teal' };
  }

  const DEPLOY_LOOK = { ready: 'ok', failed: 'bad', running: 'wait', waiting: 'wait', inactive: 'quiet' };
  const deploymentsLine = (pull) => pull.deployments.map((one) => `<span class="dep ${DEPLOY_LOOK[one.state]}">${ico('rocket')}${esc(one.environment)}: ${esc(one.state)}`
    + `${one.link ? ` <a data-link="${esc(one.link)}">View deployment</a>` : ''}</span>`).join('<span class="sep"> · </span>');

  /** One check: its state icon (or the icon of a rule), name, words, time, links; a failed one with its annotations. */
  function checkRow(check) {
    const [icon, look] = CHECK_LOOK[check.state] ?? ['dot-fill', 'quiet'];
    const iconOf = lookIcon(own('check', PartLook.checkFields(check))['text.icon']) || ico(icon, look);
    const links = [check.link ? `<a data-link="${esc(check.link)}">${check.runLink ? 'View the log' : 'Details'}</a>` : '', isFailed(check) && check.runLink ? `<a data-link="${esc(check.runLink)}">Run again</a>` : ''].filter(Boolean).join('');
    const notes = isFailed(check) ? check.annotations.map((note) => `<div class="ann ${note.level}">${ico(note.level === 'failure' ? 'x-circle' : note.level === 'warning' ? 'alert' : 'comment')}`
      + `<span class="am">${esc(note.title ? `${note.title}: ` : '')}${esc(note.message)}</span>`
      + `${note.path && note.path !== '.github' ? `<a class="at" data-thread-file="${esc(note.path)}" data-lines="${note.line ? `${note.line},${note.line}` : ''}">${esc(note.path)}${note.line ? `:${note.line}` : ''}</a>` : ''}</div>`).join('') // ".github" is where GitHub hangs its own notes of a job: no file of the repo
      + (check.cutAnnotations ? `<div class="ann quiet">${plural(check.cutAnnotations, 'more note')} on GitHub</div>` : '') : '';
    return `<div class="ck ${look}${check.state === 'skipped' ? ' skipped' : ''}">${iconOf}<span class="cn">${esc(check.name)}</span>`
      + `<span class="cs">${esc(check.description ?? check.state)}${check.seconds !== undefined ? ` · ${check.seconds < 60 ? `${check.seconds} s` : `${Math.round(check.seconds / 60)} min`}` : ''}</span>`
      + `<span class="cl">${links}</span></div>${notes}`;
  }

  /**
   * The list of checks: under the name of their workflow ("CI · GitHub Actions"), other products under "Other checks". In each: failed, waiting and running,
   * the passed ones as one folded row, skipped ones quiet. A rule of the look leaves checks out (the strip still counts them), or orders and groups them.
   */
  function checksHtml(pull) {
    const shown = pull.checks.list.filter((check) => PartLook.checkShown(pageLook(), check));
    const byRule = PartLook.checkGroups(pageLook(), shown);
    const groups = new Map();
    for (const check of shown) groups.set(check.group, [...(groups.get(check.group) ?? []), check]);
    const worst = (list) => Math.min(...list.map((check) => STATE_ORDER.indexOf(check.state)));
    const ordered = [...groups.entries()].sort(([a, one], [b, two]) => (a === 'Other checks') - (b === 'Other checks') || worst(one) - worst(two));
    const ruleHtml = ({ title, checks }) => `<div class="cg"><div class="cgh">${ico(title === 'Other checks' ? 'check-circle' : 'workflow')}<b>${esc(title)}</b></div>${checks.map(checkRow).join('')}</div>`;
    const groupHtml = ([title, list]) => {
      const sorted = [...list].sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
      const passed = sorted.filter((check) => check.state === 'passed' || check.state === 'neutral');
      const before = sorted.filter((check) => !passed.includes(check) && check.state !== 'skipped');
      const skipped = sorted.filter((check) => check.state === 'skipped');
      const passedRow = passed.length ? `<div class="cpass" data-box><a class="ck ok" data-toggle>${ico('check-circle-fill', 'ok')}<span class="cn">${number(passed.length)} passed</span><span class="cs"><span class="show">Show</span><span class="hide">Hide</span></span></a><div class="inner">${passed.map(checkRow).join('')}</div></div>` : '';
      return `<div class="cg"><div class="cgh">${ico(title === 'Other checks' ? 'check-circle' : 'workflow')}<b>${esc(title)}</b></div>${before.map(checkRow).join('')}${passedRow}${skipped.map(checkRow).join('')}</div>`;
    };
    const cut = pull.cut.checks ? `<p class="quiet">Only the first ${number(pull.checks.list.length)} checks are read. See all on <a data-link="${esc(pull.url)}">GitHub</a>.</p>` : '';
    const deployments = pull.deployments.length ? `<div class="deps">${deploymentsLine(pull)}</div>` : '';
    const rows = byRule ? byRule.map(ruleHtml).join('') : ordered.map(groupHtml).join('');
    return `${deployments}${rows || (pull.checks.list.length ? '' : '<p class="quiet">No checks ran.</p>')}${cut}`;
  }

  const REVIEW_DOTS = { amber: 'wait', red: 'bad', teal: '' };
  const names = (people) => people.map((one) => one.person.login).join(', ');

  /** The review of an open pull request in a few words, with the colour of its dot. */
  function reviewLine(pull) {
    const by = (state) => pull.reviewers.filter((one) => one.state === state);
    if (by('changes requested').length) return { text: `changes asked by ${names(by('changes requested'))}`, dot: 'amber' };
    if (pull.review === 'APPROVED' || by('approved').length) return { text: `approved by ${names(by('approved'))}`, dot: 'teal' };
    if (pull.review === 'REVIEW_REQUIRED') return { text: `review required${by('asked').length ? ` from ${names(by('asked'))}` : ''}`, dot: 'amber' };
    if (by('asked').length) return { text: `review asked from ${names(by('asked'))}`, dot: 'amber' };
    if (by('reviewed').length) return { text: `reviewed by ${names(by('reviewed'))}`, dot: 'teal' };
    return { text: 'no review yet', dot: 'amber' };
  }

  const bit = (line, more = '', cls = '') => (line ? `<span class="${cls}">${line.dot === 'none' ? '' : `<i class="dot ${REVIEW_DOTS[line.dot] ?? ''}"></i>`}${esc(line.text)}${more}</span>` : '');

  /** The icon of the state of a pull request, with its word when there is room; its tooltip says "#12 · Review needed". `slots`: an icon of the look in its place. */
  const icon = (pull, word = true, slots = {}) => `${lookIcon(slots['text.icon']) || States.pullIcon(pull)}${word ? `<span class="prw">${esc(pull.state)}</span>` : ''}`;
  /** The first part of the strip, the icon of the state, in the colour of a rule of the look. */
  const stateBit = (pull, word, slots) => { const color = PartLook.wordsAttrs(slots['text.color']); return `<span${color.cls ? ` class="${color.cls.trim()}"` : ''}${color.style}>${icon(pull, word, slots)}</span>`; };

  /**
   * The merge sentence of the strip: the parts that the strip does not say before it. The state word says a draft and conflicts,
   * the review says what the review needs, the checks say the failed ones, else the running ones.
   */
  function stripSentence(pull) {
    const said = new Set(['review', 'checks failed', pull.checks.failed ? '' : 'checks running', pull.state === 'draft' ? 'draft' : '', pull.state === 'conflicts' ? 'conflicts' : '']);
    return pull.merge.parts.filter((part) => !said.has(part.about)).map((part) => part.text);
  }

  /** The reviewers of the strip as avatars that lie over each other (reviewerFaces in tools.js); a rule gives them a size, or their names beside or in place of the avatars. */
  function reviewersHtml(pull) {
    const look = own('reviewers');
    const names = () => `<span class="rvnames">${pull.reviewers.map((one) => `<span title="${esc((REVIEWER_LOOK[one.state] ?? REVIEWER_LOOK.reviewed)[2])}">${esc(one.person.login)}</span>`).join(', ')}</span>`;
    return (look.content?.fields ?? ['avatar']).map((part) => (part === 'avatar' ? reviewerFaces(pull.reviewers, { small: 'xs', large: '' }[look['text.size']] ?? 's') : names())).join('');
  }

  /**
   * The status strip, one short line. `full` is the pull request as read in full, else only the short form from the list of the branch is known.
   * Open: the icon of the state (its word only for a draft and for conflicts, which nothing else on the strip says), the reviewers as avatars with the mark of their state, the checks
   * (a click opens their list, which names the failed ones), and the first thing that still stands before a merge, with a count of the others; the pointer
   * on it says them all. Merged or closed: who and when, no more. A rule of the look gives the icon of the state another icon and a colour, and names
   * the bits that show in their order (PartLook.stripBits); the checks bit always counts every check.
   */
  function stripHtml(short, full, others = 0) {
    lastStrip = [short, full, others];
    const choice = others ? `<a class="others" data-pulls>${esc(States.WORDS.morePulls(others))}</a>` : '';
    const look = own('status-strip', { state: (full ?? short).state });
    if (!full) return `<div class="status">${stateBit(short, !short.checks.failed, look)}${short.checks.failed ? bit({ text: States.WORDS.failedChecks(short.checks), dot: 'red' }) : ''}${choice}</div>`;
    if (!full.open) return `<div class="status">${stateBit(full, true, look)}<span class="msent">${esc(full.merge.sentence)}</span>${choice}</div>`;
    const checks = checksLine(full);
    const checksBit = checks.dot === 'none' ? bit(checks) : `<a class="chk${checksOpen ? ' on' : ''}" data-checks title="Show the checks">${checks.dot === 'none' ? '' : `<i class="dot ${REVIEW_DOTS[checks.dot] ?? ''}"></i>`}${esc(checks.text)}<span class="chev">${checksOpen ? '▾' : '▸'}</span></a>`;
    const [first, ...rest] = stripSentence(full);
    const sentence = first ? `<span class="msent${full.merge.ready ? ' ok' : ''}"${rest.length ? ` title="${esc([first, ...rest].join(' · '))}"` : ''}>${esc(first)}${rest.length ? `<i class="muted">${rest.length} more</i>` : ''}</span>` : '';
    // The bits in the order of a rule of the look; "Merge", "Review" and the choice of pull requests keep their place at the end, since they write to GitHub.
    const bits = { reviewers: () => (full.reviewers.length ? reviewersHtml(full) : ''), review: () => bit(reviewLine(full)), checks: () => checksBit, blocker: () => sentence };
    const shown = PartLook.stripBits(pageLook(), full).map((name) => bits[name]()).join('');
    return `<div class="status">${stateBit(full, full.state === 'draft' || full.state === 'conflicts', look)}${shown}${mergeBit(full)}${reviewBit(full)}${choice}</div>`
      + (checksOpen ? `<section class="checks-panel">${checksHtml(full)}</section>` : '') + reviewHtml(full);
  }

  let lastStrip = null;
  /** A click on the checks of the strip opens or closes their list under it. */
  function bindStrip(el) {
    el.querySelector('[data-checks]')?.addEventListener('click', () => {
      checksOpen = !checksOpen;
      el.innerHTML = stripHtml(...lastStrip);
      bindStrip(el);
    });
  }

  // ----- the side facts: reviewers, assignees, labels, milestone, closing issues, tasks -----

  const reviewerRow = (one) => { const [i, look, words] = REVIEWER_LOOK[one.state] ?? REVIEWER_LOOK.reviewed; return `<div class="pp">${avatar(one.person, 's')}<span class="pn">${esc(one.person.login)}${one.person.team ? ' <i class="quiet">team</i>' : ''}</span><span class="ps ${look}" title="${esc(words)}">${ico(i, look)}<span class="pw">${esc(words)}</span></span></div>`; };
  const tasksWords = (tasks) => `${tasks.done} of ${tasks.total} tasks`;
  const milestoneWords = (milestone) => `${milestone.title}${milestone.due ? `, due ${dateWords(milestone.due)}` : ''}`;
  /** A label that opens the pull requests of the repo with that label on GitHub, as a label there does; in the facts line and in its details. */
  const labelLink = (pull, label) => `<a class="flink" data-link="${esc(`https://github.com/${pull.repo}/pulls?q=${encodeURIComponent(`is:pr label:"${label.name}"`)}`)}">${labelPill(label)}</a>`;

  /** The side facts as sections: the side column of "Classic", and the fold of "Messages". A rule of the look leaves sections out and puts some first. */
  function factsSections(pull) {
    const section = (title, body) => `<section><h4>${esc(title)}</h4>${body}</section>`;
    const none = (text) => `<p class="quiet">${esc(text)}</p>`;
    const sections = {
      reviewers: section('Reviewers', pull.reviewers.length ? pull.reviewers.map(reviewerRow).join('') : none('No reviewers')),
      assignees: section('Assignees', pull.assignees.length ? pull.assignees.map((one) => `<div class="pp">${avatar(one, 's')}<span class="pn">${esc(one.login)}</span></div>`).join('') : none('No one')),
      labels: section('Labels', pull.labels.length ? `<div class="lbls">${shownLabels(pull).map((label) => labelLink(pull, label)).join('')}</div>` : none('None yet')),
      milestone: section('Milestone', pull.milestone ? `<a class="mlink" data-link="${esc(pull.milestone.url)}">${ico('milestone')}${esc(milestoneWords(pull.milestone))}</a>` : none('No milestone')),
      closes: section('Closes', pull.closes.length ? pull.closes.map((issue) => `<a class="mlink" data-link="${esc(issue.url)}">${ico(issue.open ? 'issue-opened' : 'issue-closed', issue.open ? 'ok' : 'done')}#${issue.number} ${esc(issue.title)}</a>`).join('') : none('No issue')),
      // The tasks go to their list in the description, as in the facts line.
      tasks: pull.tasks.total ? section('Tasks', `<a class="mlink" data-tasks>${ico('tasklist')}${esc(tasksWords(pull.tasks))}</a>`) : '',
    };
    return PartLook.sideSections(pageLook(), Object.keys(sections)).map((id) => sections[id]).join('');
  }

  /** The side facts of "Messages": one quiet line under the title, with a fold for the details. Nothing when there is nothing to say. The sections of the look order and leave out its bits. */
  function factsLine(pull) {
    const labels = shownLabels(pull);
    // Each fact opens its own page on GitHub, as there; the tasks go to their list in the description.
    const personLink = (one) => (/^[\w-]+$/.test(one.login) ? `<a class="flink" data-link="https://github.com/${esc(one.login)}">${esc(one.login)}</a>` : esc(one.login));
    const all = {
      labels: labels.length ? `<span class="lbls">${labels.map((label) => labelLink(pull, label)).join('')}</span>` : '',
      reviewers: pull.reviewers.length ? `<span>${ico('eye')}${plural(pull.reviewers.length, 'reviewer')}</span>` : '',
      assignees: pull.assignees.length ? `<span>${ico('person')}${pull.assignees.map(personLink).join(', ')}</span>` : '',
      milestone: pull.milestone ? `<span><a class="flink" data-link="${esc(pull.milestone.url)}">${ico('milestone')}${esc(milestoneWords(pull.milestone))}</a></span>` : '',
      closes: pull.closes.length ? `<span>${ico('issue-opened')}closes ${pull.closes.map((issue) => `<a class="flink" data-link="${esc(issue.url)}" title="${esc(issue.title)}">#${issue.number}</a>`).join(', ')}</span>` : '',
      tasks: pull.tasks.total ? `<span><a class="flink" data-tasks>${ico('tasklist')}${esc(tasksWords(pull.tasks))}</a></span>` : '',
    };
    const bits = PartLook.sideSections(pageLook(), Object.keys(all)).map((id) => all[id]).filter(Boolean);
    if (!bits.length) return '';
    return `<div class="facts" data-box><div class="fline">${bits.join('')}<a class="fmore" data-toggle><span class="show">Details</span><span class="hide">Less</span></a></div><div class="inner fsec">${factsSections(pull)}</div></div>`;
  }

  // ----- the stack: where the pull request stands, and the other pull requests of the stack -----

  /** The pull requests of the stack, the top first: the icon, the number, the title on one line, and "this one". A click on another opens it. */
  function stackRows(pull) {
    const rows = pull.stack.entries.map((entry) => {
      const place = { number: pull.stack.number, size: pull.stack.size, position: entry.position }; // for the tooltip of the icon
      const inner = `${States.pullIcon({ ...entry, stack: place })}<span class="sn">#${entry.number}</span><span class="st" title="${esc(entry.title)}">${esc(entry.title)}</span>`;
      return entry.number === pull.number
        ? `<div class="srow this">${inner}<i class="sthis">this one</i></div>`
        : `<a class="srow" data-stack-pull="${esc(entry.url)}" data-number="${entry.number}">${inner}</a>`;
    }).join('');
    const cut = pull.stack.cut ? `<p class="quiet">${plural(pull.stack.cut, 'more pull request')} of the stack are on <a data-link="${esc(pull.url)}">GitHub</a>.</p>` : '';
    return `<div class="srows">${rows}</div>${cut}`;
  }

  /** "2 of 3 in a stack onto main". */
  const stackWords = (pull) => States.WORDS.inStack(pull.stack, pull.stack.base);

  /** "Messages": the place of the pull request as one quiet line under the title; a click opens the list of the stack. */
  const stackLine = (pull) => (pull.stack
    ? `<div class="stack" data-box><a class="sline" data-toggle>${ico('git-branch')}${esc(stackWords(pull))}<span class="chev show">▸</span><span class="chev hide">▾</span></a><div class="inner">${stackRows(pull)}</div></div>`
    : '');

  /** "Classic": the stack as a box above the first comment, as on GitHub. */
  const stackBox = (pull) => (pull.stack
    ? `<div class="item stackbox">${ico('git-branch', 'mic')}<div class="gbox"><div class="gh"><b>Stack</b> of ${plural(pull.stack.size, 'pull request')}${pull.stack.base ? ` onto ${esc(pull.stack.base)}` : ''}</div>${stackRows(pull)}</div></div>`
    : '');

  /** The pull request right below this one in its stack, after its branches: "· on #2", a click opens it. */
  function belowLink(pull) {
    const below = pull.stack?.entries.find((entry) => entry.position === pull.stack.position - 1);
    return below ? `<span class="sep">·</span><a class="onpr" data-stack-pull="${esc(below.url)}" data-number="${below.number}" title="${esc(below.title)}">on #${below.number}</a>` : '';
  }

  // ----- review threads -----

  /** Code lines of a thread: a long line wraps and goes on at its indent plus 2 characters, as in the file tab. Nothing is cut off. */
  const codeRows = (lines) => lines.map((line) => {
    const hang = line.text.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length + 2;
    const cls = line.sign === '+' ? 'add' : line.sign === '-' ? 'del' : '';
    return `<div class="l ${cls}"><span class="no">${line.line ?? ''}</span><span class="g">${line.sign === '-' ? '−' : line.sign.trim()}</span><span class="x" style="--hang:${hang}ch">${esc(line.text)}</span></div>`;
  }).join('');

  let threadCount = 0;
  /** The lines of code of a thread: the last few, and the fold of the rest, which is drawn when he opens it. */
  function codeHtml(thread) {
    if (!thread.code.length) return '';
    const early = thread.code.slice(0, Math.max(0, thread.code.length - CODE_LINES));
    const late = thread.code.slice(early.length);
    const key = `t${++threadCount}`;
    if (early.length) earlyRows.set(key, early);
    return `<div class="tcode" data-box>${early.length ? `<a class="rest" data-early="${key}"><span class="show">${plural(early.length, 'more line')}</span><span class="hide">Fewer lines</span></a>` : ''}`
      + `<div class="early"></div>${codeRows(late)}</div>`;
  }

  /**
   * A comment inside a thread, or a hidden one as one quiet row that a click opens. Its suggested changes stand in its text, with their buttons.
   * In "Messages" the answers read as a small chat: his own at the right in a tinted bubble, and a comment right after one of the same person
   * (`before`, within minutes) with no avatar, no name and no time. The first comment has no time either: the message around the thread says it.
   * A comment with no time has its exact time as its tooltip.
   */
  function smallComment(comment, thread, pull, before) {
    const text = textHtml(commentText(comment, thread, pull, true));
    let body;
    if (mode !== 'messages') body = `<div class="sc" data-said="${esc(comment.id)}"><div class="top">${avatar(comment.author, 's')}${name(comment.author)}${when(comment.at)}${marksOf(comment)}</div>${text}${chips(comment.reactions)}</div>`;
    else {
      const mine = !!comment.mine;
      const same = !!before && !before.hidden && before.author.login === comment.author.login && new Date(comment.at) - new Date(before.at) < SAME_MINUTES * MINUTE;
      const marks = marksOf(comment);
      const top = same ? (marks ? `<div class="top">${marks}</div>` : '')
        : `<div class="top">${mine ? ownName(comment.author) : `${avatar(comment.author, 's')}${name(comment.author)}`}${marks}${before ? timeAgo(comment.at) : ''}</div>`;
      body = `<div class="sc${mine ? ' mine' : ''}${same ? ' same' : ''}" data-said="${esc(comment.id)}"${same || !before ? exactTip(comment.at) : ''}>${top}${mine ? `<div class="bub">${text}</div>` : text}${chips(comment.reactions)}</div>`;
    }
    return comment.hidden ? hiddenBox(comment, body) : body;
  }

  function hiddenBox(comment, body) {
    return `<div class="hidbox" data-box><a class="hid" data-toggle>${avatar(comment.author, 's')}<span>Hidden by GitHub as ${esc(comment.hidden)} · ${esc(comment.author.login)} · ${esc(ago(comment.at))}</span><span class="show">Show</span><span class="hide">Hide</span></a><div class="inner">${body}</div></div>`;
  }

  /** The file of a thread: a click opens the file tab at its lines when the file is in the folder. */
  const fileLink = (thread) => (App.page?.pullOnly?.otherRepo || thread.fileRemoved
    ? `<span class="fp">${esc(thread.path)}</span>`
    : `<a class="fp" data-thread-file="${esc(thread.path)}" data-lines="${thread.lines ? thread.lines.join(',') : ''}" title="Open the file at these lines">${esc(thread.path)}</a>`);

  /**
   * A review thread: its file and lines, its last lines of code, its comments.
   * "Messages": a resolved thread is one folded, faded row. "Classic": resolved and outdated threads fold with "Show resolved" and "Show outdated".
   */
  function threadHtml(thread, pull, classic = false) {
    const head = `<div class="fh">${fileLink(thread)}<span>${esc(linesWord(thread))}</span>${thread.outdated ? '<span class="lab">Outdated</span>' : ''}</div>`;
    const cut = thread.cutComments ? `<a class="cut" data-link="${esc(thread.comments[0]?.url ?? pull.url)}">${plural(thread.cutComments, 'more comment')} on GitHub</a>` : '';
    const inner = `<div class="excerpt">${head}${codeHtml(thread)}</div>${thread.comments.map((comment, at) => smallComment(comment, thread, pull, thread.comments[at - 1])).join('')}${cut}${threadField(thread, pull)}`;
    const id = `data-thread="${esc(thread.id)}"`; // a write draws this one thread again in its place
    const sending = thread.sending ? `<span class="t ex">${esc(WRITE.sendingMark)}</span>` : '';
    if (classic && (thread.resolved || thread.outdated)) {
      const why = thread.resolved ? 'resolved' : 'outdated';
      return `<div class="thread gfold" data-box ${id}><a class="ghead" data-toggle><span class="fp">${esc(thread.path)}</span>${thread.outdated ? '<span class="lab">Outdated</span>' : ''}${sending}`
        + `<span class="gbtn"><span class="show">Show ${why}</span><span class="hide">Hide ${why}</span></span></a><div class="inner">${inner}</div></div>`;
    }
    if (!thread.resolved) return `<div class="thread${thread.outdated ? ' outdated' : ''}" ${id}>${inner}</div>`;
    const first = thread.comments[0];
    const how = applied[thread.id] !== undefined ? 'suggestion applied by' : 'resolved by';
    const who = thread.resolvedBy ? `${avatar(thread.resolvedBy, 's')}<span class="by">${how} ${esc(thread.resolvedBy.login)}</span>${sending}` : `<span class="by">resolved</span>${sending}`;
    return `<div class="thread folded${thread.outdated ? ' outdated' : ''}" data-box ${id}><a class="resolved" data-toggle><span class="ok">✓</span>${who}`
      + `<span class="at">${esc(baseName(thread.path))} ${esc(linesWord(thread))}</span><span class="first">${esc(first ? plainText(first.html) : '')}</span>`
      + `<span class="n">${plural(thread.comments.length, 'message')}</span><span class="go">›</span></a><div class="inner">${inner}</div></div>`;
  }

  const VERDICTS = {
    approved: ['check-circle-fill', 'ok', 'approved', 'approved these changes'], 'changes requested': ['file-diff', 'bad', 'asked for changes', 'asked for changes'],
    reviewed: ['eye', 'quiet', 'reviewed', 'reviewed'], dismissed: ['x', 'quiet', 'review dismissed', 'reviewed, dismissed'], 'not sent yet': ['pencil', 'quiet', 'review not sent yet', 'started a review, not sent yet'],
  };

  // ----- "Messages": the modern look -----

  /**
   * What the look gives a message of "Messages", by its author and its kind: the class and the colours of its box, and a test for each of its parts
   * (avatar, name, time, text, reactions) that shows. The threads of a review always show: they hold "Answer" and "Resolve".
   */
  function messageLook(item, author) {
    const look = own('message', { author: author?.login ?? '', type: PartLook.messageType(item, author) });
    return { box: PartLook.boxAttrs(look['box.color']), shows: PartLook.shows(look.content?.fields) };
  }
  const gap = '<span class="av gap"></span>';

  /** A message row: avatar, then the name and one relative time on one line, then the title line (a heading at its start), the text, chips, threads. */
  function messageHtml(item, pull, same) {
    if (item.kind === 'thread') {
      const first = item.thread.comments[0];
      const { box, shows } = messageLook(item, first?.author);
      return `<div class="msg${box.cls}"${box.style}>${shows('avatar') ? avatar(first?.author ?? { login: '?' }) : gap}<div class="body"><div class="top">${first && shows('name') ? name(first.author) : ''}<span class="t">on code</span>${shows('time') ? timeAgo(item.at) : ''}</div>${threadHtml(item.thread, pull)}</div></div>`;
    }
    if (item.kind === 'reply') {
      const { comment, thread } = item;
      const { box, shows } = messageLook(item, comment.author);
      const body = `<div class="msg${box.cls}"${box.style} data-msg="${esc(comment.id)}">${shows('avatar') ? avatar(comment.author) : gap}<div class="body"><div class="top">${shows('name') ? name(comment.author) : ''}${edited(comment.edited)}`
        + `<span class="t">answered on ${esc(baseName(thread.path))} ${esc(linesWord(thread))}</span>${shows('time') ? timeAgo(comment.at) : ''}</div>${shows('text') ? textHtml(commentText(comment, thread, pull, false)) : ''}${shows('reactions') ? chips(comment.reactions) : ''}</div></div>`;
      return comment.hidden ? hiddenBox(comment, body) : body;
    }
    const heading = headingOf(item.html);
    const text = heading ? heading.rest : item.html;
    const times = item.repeat ? `<span class="t rep" title="${esc([item.at, ...item.repeat].map(exact).join(', '))}">posted ${item.repeat.length + 1} times</span>` : '';
    const { box, shows } = messageLook(item, item.author);
    const words = shows('text') ? `${heading ? `<div class="mtitle">${esc(heading.title)}</div>` : ''}${textHtml(text)}` : '';
    const reactions = shows('reactions') ? chips(item.reactions) : '';
    // His own message stands at the right with no avatar, as in a chat app; his name is there for a screen reader.
    const mine = !!item.mine;
    const who = shows('name') ? (mine ? ownName(item.author) : name(item.author)) : '';
    const bubble = (inner) => (mine && inner ? `<div class="bub">${inner}</div>` : inner);
    if (item.kind === 'review') {
      const [i, look, verdict] = VERDICTS[item.state] ?? VERDICTS.reviewed;
      const body = `<div class="msg${mine ? ' mine' : ''}${box.cls}"${box.style} data-msg="${esc(item.id)}">${mine ? '' : shows('avatar') ? avatar(item.author) : gap}<div class="body"><div class="top">${who}${marksOf(item)}${shows('time') ? timeAgo(item.at) : ''}</div>`
        + `<div class="card review ${look}"><div class="verdict ${look}">${ico(i, look)}${esc(verdict)}</div>${words}${reactions}${item.threads.map((thread) => threadHtml(thread, pull)).join('')}</div></div></div>`;
      return item.hidden ? hiddenBox(item, body) : body;
    }
    // A group: messages of one person in a row, a few minutes apart. The first has the avatar, the name and the time; a later one only its text
    // (and its marks, when it has some), close under the one before, with its exact time as its tooltip.
    const marks = `${marksOf(item)}${times}`;
    const head = same ? (marks ? `<div class="top">${marks}</div>` : '') : `<div class="top">${who}${marks}${shows('time') ? timeAgo(item.at) : ''}</div>`;
    const left = mine ? '' : same ? '<span class="gut"></span>' : shows('avatar') ? avatar(item.author) : gap;
    const body = `<div class="msg${same ? ' same' : ''}${mine ? ' mine' : ''}${box.cls}"${box.style} data-msg="${esc(item.id)}"${same ? exactTip(item.at) : ''}>${left}<div class="body">${head}`
      + `${bubble(words)}${reactions}</div></div>`;
    return item.hidden ? hiddenBox(item, body) : body;
  }

  // ----- rows on the line: commits, events and the comments of a product -----

  /**
   * A row on the line of "Messages": its icon on the line and a short faint word beside it, no time and no box; a click opens its details
   * under it, in place. `open`: a rule of the look opens this fold at the start. `look`: the class and style that the look gives the row.
   */
  const lineRow = (cls, icon, words, details, open = false, look = PartLook.NONE) => `<div class="${cls} online${open ? ' open' : ''}" data-box>`
    + `<a class="lrow${look.cls}"${look.style} data-toggle><span class="lic">${icon}</span><span class="what">${words}</span></a><div class="inner">${details}</div></div>`;

  /** The comments of a product in a row ("GitHub Actions · 2 comments"): a click opens them in place, each with its title line and its text. */
  function productsHtml(group) {
    const last = group[group.length - 1];
    const { box, shows } = messageLook(last, last.author);
    const comments = group.map((item) => {
      const heading = headingOf(item.html);
      return `<div class="said"${exactTip(item.at)}>${heading ? `<div class="mtitle">${esc(heading.title)}</div>` : ''}${shows('text') ? textHtml(heading ? heading.rest : item.html) : ''}${shows('reactions') ? chips(item.reactions) : ''}</div>`;
    }).join('');
    const words = `${shows('name') ? `${esc(last.author.login)} · ` : ''}${plural(group.length, 'comment')}`;
    return lineRow('prods', shows('avatar') ? avatar(last.author, 's') : ico('comment'), words, comments, false, box);
  }

  /** What the look gives an event or a commit: an icon in place of its own, and a colour of its words (the class and style of its row). */
  function eventLook(item) {
    const look = own('event', { of: PartLook.eventOf(item) });
    return { icon: lookIcon(look['text.icon']), color: PartLook.wordsAttrs(look['text.color']) };
  }
  /** True when no rule of the look leaves the event or the commit out. Other items always show. */
  const eventShown = (item) => (item.kind !== 'commit' && item.kind !== 'event') || own('event', { of: PartLook.eventOf(item) })['show.shown'] !== false;

  // The details of a row on the line: one row for each commit or event, its exact time as its tooltip.
  const commitRow = (item) => { const { icon, color } = eventLook(item); return `<div class="row${color.cls}"${color.style}${exactTip(item.at)}>${icon || ico('git-commit')}<code>${esc(item.hash)}</code><span class="what">${esc(item.subject)}</span>`
    + `${item.verified ? '<span class="vf">Verified</span>' : ''}<span class="t who">${esc(item.author.login)}${item.author.bot ? ' (bot)' : ''}</span></div>`; };

  /** Commits in a row: "4 commits" on the line; a click opens their short hashes and subjects. */
  function commitsHtml(group) {
    const { icon, color } = eventLook(group[0]);
    return lineRow('commits', icon || ico('git-commit'), esc(plural(group.length, 'commit')), group.map(commitRow).join(''), !folds('commits'), color);
  }

  const DEPLOY_WORDS = { ready: 'ready', failed: 'failed', running: 'running', waiting: 'waiting', inactive: 'no longer active' };
  /** The words of an event, with its label pill, its link or its deployment. */
  const eventWords = (item) => `${item.actor ? `<b>${esc(item.actor.login)}</b> ` : ''}${esc(item.text)}`
    + `${item.label ? ` ${labelPill(item.label)}` : ''}${item.link ? ` <a data-link="${esc(item.link.url)}">${esc(item.link.text)}</a>` : ''}`
    + `${item.deployment ? ` <span class="dep ${DEPLOY_LOOK[item.deployment.state]}">${esc(DEPLOY_WORDS[item.deployment.state])}</span>${item.deployment.link ? ` <a data-link="${esc(item.deployment.link)}">View deployment</a>` : ''}` : ''}`;

  const eventHtml = (item) => { const { icon, color } = eventLook(item); return `<div class="row ev${color.cls}"${color.style}${exactTip(item.at)}>${icon || ico(item.icon)}<span class="what">${eventWords(item)}</span></div>`; };

  // The kinds of event that one row on the line holds, by their words (shared/read-pull-request.ts makes them), with the short words of the row:
  // "3 force pushes", "label backend", "review asked from lena-s", "merged". `of` gives the name that the words of an event hold.
  const listed = (run, of) => [...new Set(run.map(of))].join(', ');
  const LINE_WORDS = [
    [/^force-pushed the base branch/, (run) => (run.length === 1 ? 'force push of the base' : `${number(run.length)} force pushes of the base`)],
    [/^force-pushed/, (run) => (run.length === 1 ? '1 force push' : `${number(run.length)} force pushes`)],
    [/^deployed to/, (run) => plural(run.length, 'deployment')],
    [/^added the label/, (run) => `${run.length === 1 ? 'label' : 'labels'} ${listed(run, (item) => item.label?.name ?? '')}`],
    [/^took away the label/, (run) => `${run.length === 1 ? 'label' : 'labels'} ${listed(run, (item) => item.label?.name ?? '')} taken away`],
    [/^asked (.+) for a review$/, (run, of) => `review asked from ${listed(run, of)}`],
    [/^no longer asks (.+) for a review$/, (run, of) => `review no longer asked from ${listed(run, of)}`],
    [/^assigned (.+)$/, (run, of) => `assigned ${listed(run, of)}`],
    [/^added it to the milestone (.+)$/, (run, of) => `milestone ${listed(run, of)}`],
    [/^mentioned it in/, (run) => plural(run.length, 'mention')],
    [/^merged /, () => 'merged'],
    [/^closed it$/, () => 'closed'],
    [/^opened it again$/, () => 'reopened'],
  ];
  const lineKind = (item) => { const at = LINE_WORDS.findIndex(([words]) => words.test(item.text)); return at < 0 ? `${item.icon}|${item.text}` : `#${at}`; };
  /** The short words of a row of events of one kind: from LINE_WORDS, else the words of the event ("deleted the branch"), with a count when it repeats. */
  function lineWords(run) {
    const [words, say] = LINE_WORDS.find(([one]) => one.test(run[0].text)) ?? [];
    if (say) return say(run, (item) => words.exec(item.text)?.[1] ?? '');
    const first = `${run[0].text}${run[0].link ? ` ${run[0].link.text}` : ''}`;
    return run.length === 1 ? first : `${number(run.length)} × ${run[0].text}`;
  }

  /**
   * Events in a row: one row on the line for each kind, in the order of their first event ("3 force pushes", "2 deployments", "label backend");
   * a click opens its events with their whole words. A rule of the look that opens the fold of events opens every row at the start.
   */
  function eventsHtml(items) {
    const kinds = new Map();
    for (const item of items) kinds.set(lineKind(item), [...(kinds.get(lineKind(item)) ?? []), item]);
    return [...kinds.values()].map((run) => {
      const { icon, color } = eventLook(run[0]);
      return lineRow('evrun', icon || ico(run[0].icon), esc(lineWords(run)), run.map(eventHtml).join(''), !folds('events'), color);
    }).join('');
  }

  /** True when he wrote the message of an entry himself: his own words are never new to him. */
  const mineEntry = (entry) => entry.kind === 'message' && !!(entry.item.mine || entry.item.comment?.mine || entry.item.thread?.comments[0]?.mine);

  /**
   * The entries of "Messages": commits in a row as one entry, events in a row as one entry, product comments in a row as one entry.
   * A later answer in a thread stands at its own time only when it is new; his own answer stands only in its thread, as on GitHub.
   * Equal messages of one author are one, with a count.
   */
  function entriesOf(pull, since) {
    const entries = [];
    const seen = new Map();
    let run = null;
    for (const raw of pull.items) {
      if (raw.kind === 'reply' && !(since && raw.at > since && !raw.comment.mine)) continue;
      if (!eventShown(raw)) continue; // an event or a commit that a rule of the look leaves out; the lines that count commits still count it
      let item = raw;
      if (item.kind === 'comment' && plainText(item.html).length > 0) {
        const key = `${item.author.login}\n${item.html}`;
        const first = seen.get(key);
        if (first) { first.repeat = [...(first.repeat ?? []), item.at]; continue; }
        item = { ...item };
        seen.set(key, item);
      }
      const kind = item.kind === 'commit' ? 'commits' : item.kind === 'event' ? 'events' : item.kind === 'comment' && item.author.bot && !item.hidden ? `product:${item.author.login}` : null;
      if (kind && run?.kind === kind) { run.items.push(item); continue; }
      if (kind) { entries.push((run = { kind, at: item.at, items: [item], author: kind.startsWith('product') ? item.author : undefined })); continue; }
      run = null;
      entries.push({ kind: 'message', at: item.at, item, message: true, author: item.author ?? item.comment?.author ?? item.thread?.comments[0]?.author });
    }
    for (const entry of entries) if (entry.kind.startsWith('product')) entry.message = true;
    return entries;
  }

  /** True when a comment follows a comment of the same author within a few minutes: it shares the avatar of the one before. */
  const sameAuthor = (entry, before) => !!(before?.kind === 'message' && before.item.kind === 'comment' && entry?.item?.kind === 'comment'
    && before.author?.login === entry.author?.login && new Date(entry.at) - new Date(before.at) < SAME_MINUTES * MINUTE && dayKey(entry.at) === dayKey(before.at));

  function entryHtml(entry, pull, before) {
    if (entry.kind === 'commits') return commitsHtml(entry.items);
    if (entry.kind === 'events') return eventsHtml(entry.items);
    if (entry.kind.startsWith('product')) return productsHtml(entry.items);
    return messageHtml(entry.item, pull, sameAuthor(entry, before));
  }

  /** The line of a day ("Today", "Yesterday", "3 November"); a rule of the look gives it other words (with {day} and {date}) or leaves it out. */
  function dayLine(iso) {
    const fields = { day: dayWord(iso), date: dateWords(iso, true) };
    const look = own('day-line', fields);
    if (look['show.shown'] === false) return '';
    return `<div class="dayline"><span>${esc(look.content?.words !== undefined ? Marks.fillText(look.content.words, fields) : fields.day)}</span></div>`;
  }

  /** Entries with a day line where the day changes. */
  function entriesHtml(entries, pull, dayBefore = '') {
    let day = dayBefore;
    return entries.map((entry, index) => {
      const newDay = dayKey(entry.at) !== day;
      day = dayKey(entry.at);
      return (newDay ? dayLine(entry.at) : '') + entryHtml(entry, pull, newDay ? null : entries[index - 1]);
    }).join('');
  }

  /** The row of the earlier messages: how many, who, from when to when. Its entries are drawn when he opens it. */
  function earlierHtml(entries) {
    const messages = entries.filter((entry) => entry.message);
    const people = [...new Map(messages.map((entry) => [entry.author?.login, entry.author])).values()].filter(Boolean).slice(0, 4);
    const commits = entries.filter((entry) => entry.kind === 'commits').reduce((sum, entry) => sum + entry.items.length, 0);
    const events = entries.filter((entry) => entry.kind === 'events').reduce((sum, entry) => sum + entry.items.length, 0);
    const words = [messages.length ? plural(messages.length, 'earlier message') : '', commits ? plural(commits, 'commit') : '', events ? plural(events, 'event') : ''].filter(Boolean).join(' · ');
    return `<a class="fold" data-earlier>${esc(words)}<span class="avs">${people.map((one) => avatar(one, 's')).join('')}</span>`
      + `<span class="t">${esc(ago(entries[0].at))} – ${esc(ago(entries[entries.length - 1].at))}</span></a>`;
  }

  /** The form "Messages": earlier messages folded, the line "New since you last looked" before the first new words of others, the rest open, a day line between days. */
  function messagesHtml(pull, since) {
    const entries = entriesOf(pull, since);
    const firstNew = since ? entries.findIndex((entry) => entry.at > since && !mineEntry(entry)) : -1;
    const before = firstNew < 0 ? (since ? entries : []) : entries.slice(0, firstNew);
    const after = firstNew < 0 ? (since ? [] : entries) : entries.slice(firstNew);
    let foldTo = 0;
    if (before.filter((entry) => entry.message).length > FEW && folds('earlier')) {
      let open = 0;
      foldTo = before.length;
      while (foldTo > 0 && open < KEEP_OPEN) if (before[--foldTo].message) open++;
      while (foldTo > 0 && sameAuthor(before[foldTo], before[foldTo - 1])) foldTo--; // messages that share an avatar stay together
    }
    const earlier = before.slice(0, foldTo);
    const open = before.slice(foldTo);
    const newCount = after.filter((entry) => entry.message && !mineEntry(entry)).length;
    const lastDay = open.length ? dayKey(open[open.length - 1].at) : '';
    return {
      earlier,
      html: (earlier.length ? earlierHtml(earlier) : '')
        + entriesHtml(open, pull)
        + (firstNew >= 0 ? `<div class="new" id="new-line">New since you last looked · ${newCount}</div>` : '')
        + entriesHtml(after, pull, firstNew >= 0 ? '' : lastDay),
    };
  }

  // ----- "Classic": the look of GitHub's conversation tab -----

  /** The marks of a head bar: "Author", "Owner" and the like, "bot". */
  const marks = (person, pull, role) => [person.bot ? 'bot' : '', !person.bot && person.login === pull.author.login ? 'Author' : '', role && role !== 'Contributor' ? role : '']
    .filter(Boolean).map((mark) => `<span class="lab">${esc(mark)}</span>`).join('');

  /** A box: the avatar beside it, a head bar, its text, its reactions, and what it holds. A rule of the look gives a box of its kind (`type`) a colour and a line. */
  const gbox = (person, head, body, more = '', markHtml = '', type = person.bot ? 'bot' : 'comment') => {
    const look = own('classic-box', { type });
    const box = PartLook.boxAttrs(look['box.color'], look['box.line']);
    return `<div class="item">${avatar(person)}<div class="gbox${box.cls}"${box.style}><div class="gh"><b>${esc(person.login)}</b> ${head}<span class="marks">${markHtml}</span></div>${body}${more}</div></div>`;
  };

  /** A small row with its icon on the line; `look` is what the look gives an event (eventLook): an icon in place of its own and a colour. */
  const gev = (iconName, words, right = '', cls = '', look = { icon: '', color: PartLook.NONE }) =>
    `<div class="ev${cls ? ` ${cls}` : ''}${look.color.cls}"${look.color.style}><span class="ic">${look.icon || ico(iconName)}</span><span class="what">${words}</span>${right}</div>`;

  function classicRow(item, pull) {
    if (item.kind === 'reply') return ''; // GitHub shows an answer in its thread
    if (item.kind === 'commit') {
      return gev('git-commit', `${item.author.login ? `<b>${esc(item.author.login)}</b> ` : ''}${esc(item.subject)}`,
        `${item.verified ? '<span class="vf">Verified</span>' : ''}${item.url ? `<a class="hash" data-link="${esc(item.url)}">${esc(item.hash)}</a>` : `<code>${esc(item.hash)}</code>`}`, 'cm', eventLook(item));
    }
    if (item.kind === 'event') return gev(item.icon, `${eventWords(item)} ${when(item.at)}`, '', '', eventLook(item));
    if (item.kind === 'thread') {
      const first = item.thread.comments[0] ?? { author: { login: '?' } };
      return gbox(first.author, `commented on code ${when(item.at)}`, `<div class="gb">${threadHtml(item.thread, pull, true)}</div>`, '', marks(first.author, pull, first.role));
    }
    const edited = `${item.edited ? '<span class="lab">edited</span>' : ''}${item.sending ? `<span class="lab">${esc(WRITE.sendingMark)}</span>` : item.example ? `<span class="lab">${esc(WRITE.example)}</span>` : ''}`;
    const body = item.html ? `<div class="gb"><div class="md">${item.html}</div></div>` : '';
    const reactions = item.reactions.length ? `<div class="gr">${chips(item.reactions)}</div>` : '';
    let html;
    if (item.kind === 'review') {
      const [i, look, , words] = VERDICTS[item.state] ?? VERDICTS.reviewed;
      const threads = item.threads.length ? `<div class="gthreads">${item.threads.map((thread) => threadHtml(thread, pull, true)).join('')}</div>` : '';
      html = gev(i, `<b>${esc(item.author.login)}</b>${item.author.bot ? '<i class="bot">bot</i>' : ''} ${esc(words)} ${when(item.at)}`, '', `rv ${look}`)
        + (body || threads ? gbox(item.author, `left a comment ${when(item.at)}`, body, `${reactions}${threads}`, `${marks(item.author, pull, item.role)}${edited}`, 'review') : '');
    } else {
      html = gbox(item.author, `commented ${when(item.at)}`, body || '<div class="gb quiet">No text</div>', reactions, `${marks(item.author, pull, item.role)}${edited}`);
    }
    return item.hidden ? `<div class="hidbox classic" data-box><a class="hid" data-toggle>${avatar(item.author, 's')}<span>This comment was hidden as ${esc(item.hidden)}</span><span class="show">Show</span><span class="hide">Hide</span></a><div class="inner">${html}</div></div>` : html;
  }

  // ----- the state card: the state, three meters and the actions, at the top of "Messages" and "Classic" (MergeCard in merge-card.js says what it holds) -----

  const CARD = MergeCard.WORDS;
  let mergeStep = null; // { pullId, method, admin } while the merge step of the card is open
  let mergeRun = null; // { pullId, method } while a merge runs
  let changing = null; // the action of the card that runs now (close, reopen, …): one click, one send
  let openAtCard = false; // the press "Merge" of the strip opened "Conversation": it opens at the card, not at the first unseen message
  const mergeEdits = {}; // his commit title and message, by pull id and method

  /** A thin bar of a meter in segments; striped when nobody approved yet, a plain line when there is nothing to count. */
  function barHtml(meter) {
    if (meter.none) return '<span class="pcbar none"></span>';
    const parts = meter.parts.filter((part) => part.count > 0);
    return `<span class="pcbar">${parts.map((part) => `<i class="${part.look}" style="flex:${part.count}"></i>`).join('')}</span>`;
  }
  const meterHtml = (meter) => `<a class="pcmeter" data-card-go="${meter.go}" tabindex="0"><span class="pcml">${esc(meter.label)}</span><span class="pcmv">${esc(meter.text)}</span>${barHtml(meter)}</a>`;

  /** A blocker as a link to its fix: the checks list, the first open thread, the review panel, "Update branch", the pull request below, a page of GitHub. */
  function blockerHtml(part, pull) {
    const text = esc(part.text);
    if (part.go === 'conflicts') return `<a class="pcgo" data-link="${esc(`${pull.url}/conflicts`)}">${text}</a>`;
    if (part.go === 'github') return `<a class="pcgo" data-link="${esc(pull.url)}">${text}</a>`;
    if (part.go === 'stack') {
      const below = pull.stack?.entries.filter((entry) => entry.position < pull.stack.position && entry.state !== 'merged' && entry.state !== 'closed').at(0);
      return below ? `<a class="pcgo" data-stack-pull="${esc(below.url)}" data-number="${below.number}">${text}</a>` : text;
    }
    if (part.go === 'update' || part.go === 'ready') return `<a class="pcgo" data-card-act="${part.go}" tabindex="0">${text}</a>`;
    return part.go ? `<a class="pcgo" data-card-go="${part.go}" tabindex="0">${text}</a>` : text;
  }

  /** The quiet actions of the card, in their order. */
  function linkHtml(name, pull) {
    if (name === 'conflicts') return `<a data-link="${esc(`${pull.url}/conflicts`)}">${esc(CARD.conflictsLink)}</a>`;
    const words = { 'merge-admin': CARD.mergeAdmin, update: CARD.update, ready: CARD.readyIt, draft: CARD.draftIt, close: CARD.close, reopen: CARD.reopen, 'delete-branch': CARD.deleteBranch }[name];
    return `<a data-card-act="${name}" tabindex="0">${esc(changing === name ? WRITE.sending : words)}</a>`;
  }

  /** The merge step in place: the method with its one sentence, the commit title and message (not for a rebase), "Confirm merge". */
  function stepHtml(pull) {
    const { method, admin } = mergeStep;
    const base = pull.base;
    const way = (one) => `<b>${esc(MergeCard.METHODS[one].name)}</b><span class="pcwhy">${esc(MergeCard.METHODS[one].say(base))}</span>`;
    const ways = pull.methods.length === 1 ? `<p class="pcway one">${way(method)}</p>`
      : pull.methods.map((one) => `<label class="pcway"><input type="radio" name="merge-method" value="${one}"${one === method ? ' checked' : ''}><span>${way(one)}</span></label>`).join('');
    const text = mergeEdits[`${pull.id}:${method}`] ?? MergeCard.commitText(pull, method);
    const fields = text ? `<label class="pcf"><span>${esc(CARD.title)}</span><input class="ghf" data-merge-field="title" value="${esc(text.title)}"></label>`
      + `<label class="pcf"><span>${esc(CARD.message)}</span><textarea class="ghf" data-merge-field="body" rows="3">${esc(text.body)}</textarea></label>` : '';
    return `<div class="pcstep" data-merge-step>${admin ? `<p class="pcnote">${esc(CARD.adminLine)}</p>` : ''}<div class="pcways" role="radiogroup" aria-label="${esc(CARD.method)}">${ways}</div>${fields}`
      + `<div class="pcdo"><button class="mgo" data-card-act="confirm">${esc(CARD.confirm)}</button><a class="ghr" data-card-act="cancel" tabindex="0">${esc(CARD.cancel)}</a></div>${errorHtml(`merge:${pull.id}`)}</div>`;
  }

  /**
   * The state card: the state in one headline with its icon, its colour and one sentence (a blocked one names what blocks it, each a link to its fix);
   * the merge step when it is open; three meters while it is open; the quiet actions. "Merge" is the only filled button of the page, and only while it can merge.
   */
  function cardHtml(pull) {
    const running = Boolean(mergeRun) && mergeRun.pullId === pull.id;
    const card = running ? MergeCard.merging(pull, mergeRun.method) : MergeCard.of(pull, ago);
    const writable = canWrite(pull);
    const stepOpen = writable && !running && Boolean(mergeStep) && mergeStep.pullId === pull.id;
    const say = card.kind === 'blocked' ? card.blockers.map((part) => blockerHtml(part, pull)).join('<span class="sep"> · </span>') : esc(card.sentence);
    const primary = writable && card.primary && !stepOpen ? `<button class="mgo" data-card-act="merge">${esc(CARD.merge)}</button>` : '';
    const sending = pull.sending ? `<span class="t ex">${esc(WRITE.sendingMark)}</span>` : '';
    const open = pull.state !== 'merged' && pull.state !== 'closed';
    const meters = open ? `<div class="pcm">${[card.meters.checks, card.meters.comments, card.meters.approvals].map(meterHtml).join('')}</div>` : '';
    const links = writable && !stepOpen ? card.links.map((name) => linkHtml(name, pull)).join('') : ''; // the open merge step is the one thing to do
    return `<section class="pcard" id="pcard" data-kind="${card.kind}"><div class="pch"><span class="pcb ${card.colour}">${ico(card.icon)}</span>`
      + `<div class="pcw"><div class="pct">${esc(card.headline)}${sending}</div>${say ? `<div class="pcs">${say}</div>` : ''}</div>${primary}</div>`
      + `${stepOpen ? stepHtml(pull) : ''}${meters}${links ? `<div class="pcl">${links}</div>` : ''}`
      + `${pull.branchDeleted ? `<p class="pcnote">${esc(CARD.branchDeleted(pull.head))}</p>` : ''}${errorHtml(`card:${pull.id}`)}</section>`;
  }

  /** Draws the card again in its place, from the pull request as it is now. */
  function redrawCard() {
    const el = document.getElementById('pcard');
    const pull = shownRead()?.pull;
    if (el && pull) el.replaceWith(...nodesOf(cardHtml(pull)));
  }

  /** The strip, the card, the slim bar and the suggestions again, after the state of the pull request changed; the focus stays where it can. */
  function redrawPullState() {
    const pull = shownRead()?.pull;
    if (!pull) return;
    keepFocus(() => {
      redrawStrip();
      redrawCard();
      redrawSuggestions(pull);
      const short = document.querySelector('#short .pri');
      if (short) short.outerHTML = icon(pull, false);
    });
  }

  /** Opens the merge step of the card, with the method that he used last in this repo, else GitHub's for him; the cursor goes to the title. */
  function openMerge(admin = false) {
    const pull = shownRead()?.pull;
    if (!pull || !canWrite(pull)) return;
    mergeStep = { pullId: pull.id, method: MergeCard.firstMethod(pull, kept.mergeMethods?.[pull.repo]), admin };
    delete failed[`merge:${pull.id}`];
    redrawCard();
    const card = document.getElementById('pcard');
    (card?.querySelector('[data-merge-field="title"]') ?? card?.querySelector('.pcway input:checked') ?? card?.querySelector('[data-card-act="confirm"]'))?.focus({ preventScroll: true });
    if (card && (card.getBoundingClientRect().top < viewTop() || card.getBoundingClientRect().bottom > innerHeight)) card.scrollIntoView({ block: 'start' });
  }

  /**
   * "Confirm merge": a merge cannot be undone, so it is not shown before GitHub answers. The card says "Merging…" while it runs; then the merged
   * state in place, or the merge step again with his choices and GitHub's reason in one line.
   */
  function confirmMerge() {
    const pull = shownRead()?.pull;
    if (!pull || !mergeStep || mergeRun) return;
    const { method } = mergeStep;
    const text = MergeCard.commitText(pull, method) && (mergeEdits[`${pull.id}:${method}`] ?? MergeCard.commitText(pull, method));
    const write = { kind: 'merge', pullId: pull.id, method, ...(text ? { title: text.title, body: text.body } : {}), headOid: pull.headOid };
    delete failed[`merge:${pull.id}`];
    mergeRun = { pullId: pull.id, method };
    redrawCard();
    void inBackground(write, (result) => {
      mergeRun = null;
      mergeStep = null;
      keep({ mergeMethods: { ...(kept.mergeMethods ?? {}), [pull.repo]: method } }); // the method he used last
      Object.assign(pull, MergeCard.after(pull, 'merged', me(pull), new Date().toISOString(), { ...result.merged, method }));
      reviewOpen = false;
      redrawPullState();
    }, (problem) => {
      mergeRun = null;
      failed[`merge:${pull.id}`] = problem;
      redrawCard();
    });
  }

  /**
   * Close, reopen, ready for review, convert to draft, update the branch, delete the branch: each can be undone, so it shows at once and GitHub
   * answers in the background; a failure puts the pull request back as it was and says why in one line of the card.
   */
  function changePull(action) {
    const pull = shownRead()?.pull;
    if (!pull || changing || mergeRun) return;
    const write = action === 'delete-branch' ? { kind: action, refId: pull.headRefId } : action === 'update' ? { kind: action, pullId: pull.id, headOid: pull.headOid } : { kind: action, pullId: pull.id };
    const change = MergeCard.after(pull, action, me(pull), new Date().toISOString());
    const before = Object.fromEntries(Object.keys(change).map((key) => [key, pull[key]]));
    const key = `card:${pull.id}`;
    changing = action;
    mergeStep = null;
    delete failed[key];
    Object.assign(pull, change, { sending: true });
    if (!pull.open) reviewOpen = false;
    redrawPullState();
    void inBackground(write, (result) => {
      changing = null;
      delete pull.sending;
      if (result.headOid) pull.headOid = result.headOid; // the branch moved on: a merge or a comment on code starts from it
      redrawPullState();
    }, (problem) => {
      changing = null;
      delete pull.sending;
      Object.assign(pull, before);
      failed[key] = problem;
      redrawPullState();
    });
  }

  /** A meter or a blocker of the card: the checks list under the strip, the first open thread (folds open), the review panel. */
  function cardGo(where) {
    const pull = shownRead()?.pull;
    if (!pull) return;
    const status = document.getElementById('status');
    if (where === 'checks') {
      checksOpen = true;
      redrawStrip();
      return status?.scrollIntoView({ block: 'nearest' });
    }
    if (where === 'review') {
      if (!canWrite(pull) || !pull.open) return;
      reviewOpen = true;
      redrawStrip(true);
      return status?.scrollIntoView({ block: 'nearest' });
    }
    if (where !== 'comments') return;
    const thread = MergeCard.threadsOf(pull).find((one) => !one.resolved);
    if (!thread) return;
    const selector = `.conv [data-thread="${CSS.escape(thread.id)}"]`;
    if (!document.querySelector(selector)) document.querySelector('.conv [data-earlier], .conv [data-classic-more]')?.click(); // drawn when the earlier messages open
    const el = document.querySelector(selector);
    if (!el) return;
    for (let box = el; box; box = box.parentElement?.closest('[data-box]')) if (box.matches('[data-box]')) openBox(box);
    toInWindow(el);
  }

  // ----- the window of the conversation: its own scroll, its head at the top and the box to write at the bottom -----

  const SLIM = 52; // the slim bar at the top of the page and a small gap under it: where the top of the window stands when it comes into view
  const scroller = () => document.getElementById('cscroll');

  /** Brings the window into view on the page: all of it when it fits, else its top under the slim bar. */
  function showWindow() {
    const win = document.getElementById('cwin');
    if (!win) return;
    const box = win.getBoundingClientRect();
    if (box.top < SLIM) scrollBy(0, box.top - SLIM);
    else if (box.bottom > innerHeight - 8) scrollBy(0, Math.min(box.top - SLIM, box.bottom - innerHeight + 8));
  }

  /** The place of a thing inside the window, from the top of what the window shows; null when it is not in the window. */
  function topInWindow(el) {
    const room = scroller();
    return room?.contains(el) ? el.getBoundingClientRect().top - room.getBoundingClientRect().top : null;
  }

  /** A link to a message or a thread: the window comes into view, and the window scrolls so that the thing stands near its top. */
  function toInWindow(el, gap = 8) {
    const top = topInWindow(el);
    if (top === null) return el.scrollIntoView({ block: 'center' });
    showWindow();
    scroller().scrollTop += top - gap;
  }

  /** True when the window shows its newest message: at its end, or with nothing to scroll. */
  const atNewest = () => { const room = scroller(); return !room || room.scrollTop + room.clientHeight >= room.scrollHeight - 24; };

  let arrived = 0; // messages that came at the end while the window was not at its newest: "↓ 2 new"
  /** "↓ Newest" shows while the window is not at its newest message, and says how many came since he left the end. */
  function markNewest() {
    const newest = document.getElementById('newest');
    if (!newest) return;
    if (atNewest()) arrived = 0;
    newest.textContent = arrived ? `↓ ${arrived} new` : '↓ Newest';
    newest.classList.toggle('on', !atNewest());
  }

  /** A new message at the end: at the newest message the window keeps the end in view; else "↓ Newest" counts it. `was` is atNewest() before it came. */
  function cameAtEnd(was) {
    const room = scroller();
    if (!room) return;
    if (was) room.scrollTop = room.scrollHeight;
    else arrived++;
    markNewest();
  }

  /** "Classic" above the window of the conversation: the stack and the description as the first boxes of GitHub's line, so that the page opens with them. */
  function classicTopHtml(pull) {
    const about = own('description');
    const box = gbox(pull.author, `commented ${when(pull.openedAt)}`, `<div class="gb">${pull.html ? `<div class="md">${pull.html}</div>` : '<span class="quiet">No description provided.</span>'}</div>`, '', marks(pull.author, pull), 'description');
    const description = about['show.shown'] === false ? '' : about['window.width'] ? `<div style="max-width:${Number(about['window.width'])}px">${box}</div>` : box;
    const top = `${stackBox(pull)}${description}`;
    return top ? `<div class="tl ctop">${top}</div>` : '';
  }

  /**
   * The form "Classic": GitHub's order and form. Nothing is folded apart from what GitHub folds: resolved, outdated, hidden, and the middle of a long
   * conversation. `since` is when he last looked: the window opens at the first row that he has not seen.
   */
  function classicHtml(pull, since) {
    const rows = pull.items.filter((item) => item.kind !== 'reply' && eventShown(item));
    // The first row that he has not seen, from the top: new itself, or a thread with a new answer of others (GitHub shows an answer in its thread).
    const fresh = (at) => since && at > since;
    const newAnswer = (item) => (item.kind === 'thread' ? [item.thread] : item.kind === 'review' ? item.threads : []).flatMap((thread) => thread.comments).find((comment) => fresh(comment.at) && !comment.mine);
    const newItself = (item) => fresh(item.at) && !mineEntry({ kind: 'message', item });
    const firstNew = since ? rows.findIndex((item) => newItself(item) || newAnswer(item)) : -1;
    classicNew = firstNew >= 0 && !newItself(rows[firstNew]) ? newAnswer(rows[firstNew]).id : null;
    // The middle of a long conversation folds, as on GitHub, but never a row that he has not seen.
    const end = rows.length - CLASSIC_TAIL;
    const hidden = rows.length > CLASSIC_LONG && folds('earlier') ? rows.slice(CLASSIC_HEAD, firstNew >= 0 ? Math.max(CLASSIC_HEAD, Math.min(end, firstNew)) : end) : [];
    // An empty mark before the first unseen row, where the window opens; Classic keeps GitHub's look, so it draws no line.
    const shown = (from, to) => rows.slice(from, to).map((item, at) => (from + at === firstNew && !classicNew ? '<div class="new-at" id="new-line"></div>' : '') + classicRow(item, pull)).join('');
    const middle = hidden.length ? `<div class="ev more-row"><a class="gbtn" data-classic-more>Show ${number(hidden.length)} more</a></div>` : '';
    classicHidden = { rows: hidden, pull };
    return `<div class="tl">${hidden.length ? shown(0, CLASSIC_HEAD) + middle + shown(CLASSIC_HEAD + hidden.length) : shown(0)}</div>`;
  }
  let classicHidden = null;
  let classicNew = null; // the id of the first unseen answer in a thread, when the first unseen thing of Classic is one: the window opens there

  // ----- writing to GitHub -----

  // The words of writing to GitHub. Change them here.
  const WRITE = {
    answer: 'Answer…', answerButton: 'Answer', resolve: 'Resolve', unresolve: 'Unresolve',
    comment: 'Write a comment…', commentButton: 'Comment', sending: 'Sending…', sendingMark: 'sending', keys: '⌘ Enter',
    review: 'Review', reviewText: 'Write what the review says…', sendReview: 'Send review', needsText: 'Write what the review says first.',
    verdicts: { COMMENT: 'Comment', APPROVE: 'Approve', REQUEST_CHANGES: 'Request changes' },
    own: 'This is your pull request: GitHub lets you comment on it, not approve it or ask for changes.',
    pending: (count) => `Your review is not sent: ${plural(count, 'comment')}`,
    locked: 'This conversation is locked. Nothing can be written here.',
    example: 'example',
    // The comment box on code: the choice "@github", and why it is not offered.
    github: (number) => `a comment on pull request #${number}`,
    githubThread: 'an answer in its thread on GitHub',
    githubHint: (number) => `Type @github to post it on pull request #${number}.`,
    intoReview: 'This goes into your review that is not sent yet.',
    notAtHead: 'The branch here is not at the commit of the pull request. Pull or push first.',
    dirty: 'This file has changes here that are not committed, so its line numbers differ from GitHub.',
    notInDiff: (number, one) => `GitHub takes a comment only on lines of its diff. ${one ? 'This line is' : 'These lines are'} not in the diff of pull request #${number}.`,
    lockedPull: (number) => `The conversation of pull request #${number} is locked.`,
    onlyGitHub: 'On this page a comment goes only to GitHub: type @github.',
    // A suggested change, with GitHub's own words.
    suggested: 'Suggested change', commitSuggestion: 'Commit suggestion', commitBatch: (count) => `Commit suggestions (${count})`,
    batch: 'Add suggestion to batch', unbatch: 'Remove from batch',
    applied: (short) => (short ? `Committed as ${short}. Pull to have it here.` : 'Committed.'),
    one: 'Update', many: 'Apply suggestions from code review', // the commit message that GitHub writes for one suggestion (with the file name) and for a batch
  };

  // What the fields hold, by key ("reply:<thread id>", "comment:<pull id>", "review:<pull id>"): kept when the page draws again or changes its view.
  const drafts = { ...(kept.githubDrafts ?? {}) };
  const verdicts = {}; // the chosen verdict of each review panel, by pull id
  const failed = {}; // GitHub's sentence in the thread or under the field whose write failed, by key
  const flipping = new Set(); // the threads whose resolve or unresolve runs now: one click, one send
  let reviewOpen = false; // the review panel under the strip

  const keepDrafts = () => keep({ githubDrafts: drafts });
  const canWrite = (pull) => !!pull.id && !pull.locked;

  /**
   * A field that writes to GitHub: quiet on one line until a click or Tab opens it; its button sends, and so does Cmd+Enter.
   * `beside` stands at the right of the field (Resolve). GitHub's sentence of a failed write stands under it, and the text stays.
   * A send empties it at once: it is ready for the next words while GitHub answers.
   */
  function fieldHtml(key, placeholder, button, beside = '', hint = '') {
    return `<div class="ghw${drafts[key] || failed[key] ? ' on' : ''}" data-gh="${esc(key)}"><div class="ghl">`
      + `<textarea class="ghf" rows="1" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">${esc(drafts[key] ?? '')}</textarea>${beside}</div>`
      + `<div class="gha"><button class="ghs" data-gh-send>${esc(button)}</button><span class="ghk">${esc(WRITE.keys)}</span>${hint ? `<span class="ghh">${esc(hint)}</span>` : ''}</div>`
      + `${errorHtml(key)}</div>`;
  }
  const errorHtml = (key) => (failed[key] ? `<p class="gherr">${esc(failed[key])}</p>` : '');

  /** The end of a review thread: "Answer…", and "Resolve" or "Unresolve" beside it when he may ("Sending…" while it runs). */
  function threadField(thread, pull) {
    if (!canWrite(pull)) return '';
    const key = `reply:${thread.id}`;
    const flip = thread.resolved ? thread.canUnresolve && 'unresolve' : thread.canResolve && 'resolve';
    const beside = flip ? `<a class="ghr" data-gh-resolve="${flip}" tabindex="0">${esc(flipping.has(thread.id) ? WRITE.sending : WRITE[flip])}</a>` : '';
    if (thread.canReply) return fieldHtml(key, WRITE.answer, WRITE.answerButton, beside, pull.pending ? WRITE.intoReview : ''); // GitHub puts an answer into a review that is not sent yet
    return beside || failed[key] ? `<div class="ghw" data-gh="${esc(key)}"><div class="ghl solo">${beside}</div>${errorHtml(key)}</div>` : '';
  }

  /** The end of the conversation: "Write a comment…", or one line when it is locked. */
  function endHtml(pull) {
    if (pull.locked) return `<p class="ghlock">${esc(WRITE.locked)}</p>`;
    return pull.id ? `<div class="ghend">${fieldHtml(`comment:${pull.id}`, WRITE.comment, WRITE.commentButton)}</div>` : '';
  }

  /** The strip of a pull request that can merge: a quiet press "Merge", which opens the merge step of the card in "Conversation". */
  const mergeBit = (pull) => (canWrite(pull) && !(mergeRun && mergeRun.pullId === pull.id) && MergeCard.canMerge(pull) ? `<a class="rvb" data-merge-go tabindex="0">${esc(CARD.merge)}</a>` : '');

  /** The strip of an open pull request: his review that is not sent yet, and the quiet button "Review". */
  const reviewBit = (pull) => (canWrite(pull) && pull.open
    ? `${pull.pending ? `<span class="ghpend">${esc(WRITE.pending(pull.pending.comments))}</span>` : ''}<a class="rvb${reviewOpen ? ' on' : ''}" data-review tabindex="0">${esc(WRITE.review)}</a>`
    : '');

  /**
   * The review panel under the strip: the text, the three verdicts, "Send review". On his own pull request GitHub takes only a comment: the panel
   * says so in one quiet line and shows no verdict, since a choice of one is none and greyed verdicts look broken.
   */
  function reviewHtml(pull) {
    if (!reviewOpen || !canWrite(pull) || !pull.open) return '';
    const key = `review:${pull.id}`;
    const chosen = verdicts[pull.id] ?? 'COMMENT';
    const choice = (verdict) => `<label class="ghv"><input type="radio" name="verdict-${esc(pull.id)}" value="${verdict}"${verdict === chosen ? ' checked' : ''}>${esc(WRITE.verdicts[verdict])}</label>`;
    return `<section class="review-panel">${pull.mine ? `<p class="ghown">${esc(WRITE.own)}</p>` : ''}<div class="ghw on" data-gh="${esc(key)}">`
      + `<textarea class="ghf" rows="3" placeholder="${esc(WRITE.reviewText)}" aria-label="${esc(WRITE.reviewText)}">${esc(drafts[key] ?? '')}</textarea>`
      + `<div class="gha"><span class="ghvs">${pull.mine ? '' : Object.keys(WRITE.verdicts).map(choice).join('')}</span>`
      + `<button class="ghs" data-gh-send>${esc(WRITE.sendReview)}</button><span class="ghk">${esc(WRITE.keys)}</span></div>`
      + `${errorHtml(key)}</div></section>`;
  }

  /** The pull request that the page shows now, as read: { pull, lines }, or undefined. */
  const shownRead = () => { const link = App.pullLink(); return link ? App.read[link] : undefined; };

  /** Every review thread of a pull request: in a review, or alone. */
  const allThreads = (pull) => pull.items.flatMap((item) => (item.kind === 'review' ? item.threads : item.kind === 'thread' ? [item.thread] : []));
  const threadById = (pull, id) => allThreads(pull).find((thread) => thread.id === id);

  /** The write that a field asks for, from its key and its text; or { problem } when it cannot go. */
  function writeOf(key, body) {
    const pull = shownRead()?.pull;
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (!pull) return { problem: 'The pull request is not read yet.' };
    if (kind === 'reply') return threadById(pull, id) ? { kind: 'reply', threadId: id, body } : { problem: 'This thread is not in the pull request as read.' };
    if (kind === 'comment') return { kind: 'comment', pullId: id, body };
    const verdict = pull.mine ? 'COMMENT' : verdicts[id] ?? 'COMMENT'; // GitHub takes only a comment on his own pull request
    if (!body && verdict !== 'APPROVE' && !pull.pending) return { problem: WRITE.needsText };
    return { kind: 'review', pullId: id, verdict, body, ...(pull.pending ? { pendingId: pull.pending.id } : {}) };
  }

  /**
   * Sends one write: through VS Code, which answers { ok, … } with what GitHub made, or { problem }; as a file in a browser the example answers
   * as GitHub does (exampleWrite). It is sent once. The answer comes back to the caller, who shows it; nothing here sends it again.
   */
  let writeCount = 0;
  const answerOf = new Map();
  function toGitHub(write) {
    window.apostilSent.push({ type: 'write', write });
    if (!vscodeApi && window.apostilExampleHold) return new Promise((resolve) => { window.apostilExampleRelease = () => resolve(exampleWrite(write)); }); // a browser check holds the answer, to see the page before it
    if (!vscodeApi) return Promise.resolve(exampleWrite(write));
    return new Promise((resolve) => {
      const id = ++writeCount;
      answerOf.set(id, resolve);
      vscodeApi.postMessage({ type: 'write', id, write });
    });
  }
  window.addEventListener('message', (event) => {
    if (event.data?.type !== 'written') return;
    answerOf.get(event.data.id)?.(event.data.result);
    answerOf.delete(event.data.id);
  });

  // ----- a write shows its result at once; the call to GitHub runs in the background -----

  let running = 0; // writes whose answer has not come yet
  let started = 0; // writes started on this page
  /** True while a write runs. App.reread() takes a read of the pull request only when no write ran while it read: such a read may not hold that write. */
  const writing = () => running > 0;
  const writesStarted = () => started;

  /** Sends a write in the background: `done(answer)` takes GitHub's answer in place, `undo(problem)` puts the page back as it was and says why. */
  async function inBackground(write, done, undo) {
    running++;
    started++;
    const result = await toGitHub(write);
    running--;
    if (result.problem) undo(result.problem);
    else done(result);
    if (!result.problem && !vscodeApi) App.reread(); // in VS Code the extension asks for it after each write that went through
  }

  /** He himself, as gh is signed in; "you" when the read did not say. */
  const me = (pull) => pull.viewer ?? { login: 'you', avatar: '', bot: false };
  let localCount = 0;
  /** His words as a comment that shows at once, marked "sending" until GitHub answers with the comment that it made. */
  const sendingComment = (pull, body) => ({
    id: `sending-${++localCount}`, author: me(pull), at: new Date().toISOString(), edited: false,
    html: `<p>${esc(body).replace(/\n/g, '<br>')}</p>`, reactions: [], url: pull.url, mine: true, sending: true,
  });
  /** The comment that GitHub answered, or the one that showed, now without its mark. */
  const answered = (shown, made) => { if (made) return made; const { sending, ...rest } = shown; return rest; };
  /** A failed send gives his words back to their field, before what he typed there since. */
  const giveBack = (key, body) => { drafts[key] = drafts[key] ? `${body}\n\n${drafts[key]}` : body; keepDrafts(); };

  const nodesOf = (html) => { const box = document.createElement('template'); box.innerHTML = html; return [...box.content.children]; };
  /** The nodes of `html` in place of `old`; the new nodes. */
  const swapNodes = (old, html) => { const fresh = nodesOf(html); if (old[0]?.isConnected) old[0].before(...fresh); old.forEach((node) => node.remove()); return fresh; };
  /** The y below the slim bar at the top, where a thing that comes into view stands. */
  const viewTop = () => { const short = document.getElementById('short'); return short?.classList.contains('on') ? short.getBoundingClientRect().bottom : 0; };

  /** Opens a box again after it was drawn anew: the folded code lines of a thread are drawn when it opens. */
  function openBox(box) {
    box.classList.add('open');
    const early = box.querySelector(':scope > [data-early]');
    const rows = box.querySelector(':scope > .early');
    if (early && rows && !rows.childElementCount && earlyRows.has(early.dataset.early)) rows.innerHTML = codeRows(earlyRows.get(early.dataset.early));
  }

  /** Runs `draw`, which draws a part again, and puts the keyboard focus back where it was: in a field (with its caret), on Resolve, or on Review. */
  function keepFocus(draw) {
    const active = document.activeElement;
    const key = active?.closest?.('[data-gh]')?.dataset.gh;
    const caret = active?.tagName === 'TEXTAREA' ? [active.selectionStart, active.selectionEnd] : null;
    const flip = !!active?.closest?.('[data-gh-resolve]');
    const review = !!active?.closest?.('[data-review]');
    draw();
    if (!active || active.isConnected) return;
    if (review) return document.querySelector('#status [data-review]')?.focus({ preventScroll: true });
    const box = key && document.querySelector(`[data-gh="${CSS.escape(key)}"]`);
    const target = flip ? box?.querySelector('[data-gh-resolve]') : box?.querySelector('textarea');
    if (!target || !target.offsetParent) return; // folded away with its thread
    target.focus({ preventScroll: true });
    if (caret && target.tagName === 'TEXTAREA') target.setSelectionRange(Math.min(caret[0], target.value.length), Math.min(caret[1], target.value.length));
    // A new message above it pushed it out of the view, or out of what the window shows.
    const room = scroller();
    const bottom = room?.contains(target) ? Math.min(innerHeight, room.getBoundingClientRect().bottom) : innerHeight;
    if (target.getBoundingClientRect().bottom > bottom) target.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Draws one thread again in its place, from the pull request as it is now. The rest of the page stays: its place on the screen, every fold
   * inside the thread and elsewhere, and the focus. `open`: true opens it, false folds it, undefined keeps it as it was.
   * A thread that folds while its top is above the view comes to the top of the view, so that he sees what he folded.
   */
  function redrawThread(thread, open) {
    const pull = shownRead()?.pull;
    if (!pull) return;
    keepFocus(() => {
      for (const el of document.querySelectorAll(`.conv [data-thread="${CSS.escape(thread.id)}"]`)) {
        const opened = [...el.querySelectorAll('[data-box]')].map((box) => box.classList.contains('open'));
        const [fresh] = nodesOf(threadHtml(thread, pull, mode === 'classic'));
        el.replaceWith(fresh);
        const boxes = [...fresh.querySelectorAll('[data-box]')];
        opened.forEach((on, index) => { if (on && boxes[index]) openBox(boxes[index]); });
        if (fresh.matches('[data-box]')) fresh.classList.toggle('open', open ?? el.classList.contains('open'));
        // In the window, the top of what it shows; the window moves, the page stays.
        const room = scroller();
        const top = room?.contains(fresh) ? Math.max(viewTop(), room.getBoundingClientRect().top) : viewTop();
        const place = fresh.getBoundingClientRect();
        if (place.bottom < top) {
          if (room?.contains(fresh)) room.scrollTop += place.top - top;
          else scrollBy(0, place.top - top);
        }
      }
    });
  }

  /** The send of a field: his words show at once where they belong, the field is empty and ready again, and GitHub answers in the background. */
  function sendField(box) {
    const key = box.dataset.gh;
    const field = box.querySelector('textarea');
    const body = field.value.trim();
    if (!body && !key.startsWith('review:')) return;
    const write = writeOf(key, body);
    if (write.problem) return showFailure(box, key, write.problem);
    delete failed[key];
    delete drafts[key];
    keepDrafts();
    if (write.kind === 'reply') return sendReply(write, key);
    redrawField(box, key, document.activeElement && box.contains(document.activeElement));
    if (write.kind === 'comment') return sendComment(write, key);
    return sendReview(write, key);
  }

  /** An answer stands as the last message of its thread, in place, marked "sending"; GitHub's answer takes its place, a failure takes it back. */
  function sendReply(write, key) {
    const pull = shownRead().pull;
    const thread = threadById(pull, write.threadId);
    const shown = sendingComment(pull, write.body);
    thread.comments.push(shown);
    redrawThread(thread);
    void inBackground(write, (result) => {
      thread.comments.splice(thread.comments.indexOf(shown), 1, answered(shown, result.comment));
      redrawThread(thread);
      if (pull.pending) { pull.pending.comments++; keepFocus(() => redrawStrip()); } // GitHub put it into his review that is not sent yet
    }, (problem) => {
      thread.comments.splice(thread.comments.indexOf(shown), 1);
      giveBack(key, write.body);
      failed[key] = problem;
      redrawThread(thread);
    });
  }

  /**
   * A new item of his at the end of the conversation, at once: a comment or a review, with a day line when the day before it is another.
   * Answers { line, nodes }: what it drew. As file in a browser and in VS Code alike.
   */
  function appendItem(item, pull, before) {
    const feed = document.querySelector('.conv .feed');
    if (!feed) return { line: [], nodes: [] };
    const was = atNewest();
    if (mode === 'classic') {
      const nodes = nodesOf(classicRow(item, pull));
      feed.querySelector('.tl')?.append(...nodes);
      cameAtEnd(was);
      return { line: [], nodes };
    }
    const line = !before || dayKey(before) !== dayKey(item.at) ? nodesOf(dayLine(item.at)) : [];
    const nodes = nodesOf(messageHtml(item, pull, false));
    feed.append(...line, ...nodes);
    cameAtEnd(was);
    return { line, nodes };
  }

  /** A comment at the end: it stands last at once, marked "sending"; GitHub's comment takes its place, a failure takes it back. */
  function sendComment(write, key) {
    const pull = shownRead().pull;
    const before = pull.items.at(-1)?.at;
    const item = { kind: 'comment', ...sendingComment(pull, write.body) };
    pull.items.push(item);
    const shown = appendItem(item, pull, before);
    void inBackground(write, (result) => {
      const made = { kind: 'comment', ...answered(item, result.comment) };
      pull.items.splice(pull.items.indexOf(item), 1, made);
      shown.nodes = swapNodes(shown.nodes, mode === 'classic' ? classicRow(made, pull) : messageHtml(made, pull, false));
    }, (problem) => {
      pull.items.splice(pull.items.indexOf(item), 1);
      [...shown.line, ...shown.nodes].forEach((node) => node.remove());
      giveBack(key, write.body);
      failed[key] = problem;
      const box = document.querySelector(`[data-gh="${CSS.escape(key)}"]`);
      if (box) redrawField(box, key, document.activeElement && box.contains(document.activeElement));
    });
  }

  /** A review: the panel closes and the review stands last at once, marked "sending"; a failure opens the panel again with the text and the reason. */
  function sendReview(write, key) {
    const pull = shownRead().pull;
    const before = pull.items.at(-1)?.at;
    const said = sendingComment(pull, write.body);
    const item = { kind: 'review', ...said, html: write.body ? said.html : '', state: { APPROVE: 'approved', REQUEST_CHANGES: 'changes requested', COMMENT: 'reviewed' }[write.verdict], threads: [] };
    const pending = pull.pending;
    pull.items.push(item);
    delete pull.pending;
    reviewOpen = false;
    redrawStrip(true);
    const shown = appendItem(item, pull, before);
    const drawn = (one) => (mode === 'classic' ? classicRow(one, pull) : messageHtml(one, pull, false));
    void inBackground(write, (result) => {
      const made = result.review ? { kind: 'review', ...result.review, threads: [] } : answered(item);
      pull.items.splice(pull.items.indexOf(item), 1, made);
      shown.nodes = swapNodes(shown.nodes, drawn(made));
    }, (problem) => {
      pull.items.splice(pull.items.indexOf(item), 1);
      if (pending) pull.pending = pending;
      [...shown.line, ...shown.nodes].forEach((node) => node.remove());
      giveBack(key, write.body);
      failed[key] = problem;
      reviewOpen = true;
      redrawStrip(true);
    });
  }

  function showFailure(box, key, text) {
    failed[key] = text;
    redrawField(box, key, document.activeElement === box.querySelector('textarea'));
  }

  /** Draws one field again in its state, and puts the cursor back in it when `focus`. */
  function redrawField(box, key, focus = false) {
    if (!box.isConnected) return;
    const field = box.querySelector('textarea');
    if (field) field.value = drafts[key] ?? '';
    box.querySelector('.gherr')?.remove();
    box.insertAdjacentHTML('beforeend', errorHtml(key));
    box.classList.toggle('on', !!(drafts[key] || failed[key]) || key.startsWith('review:'));
    if (focus) field?.focus();
  }

  /** The state of a thread that a resolve changes, to put back when it fails. */
  const flipState = (thread) => ({ resolved: thread.resolved, resolvedBy: thread.resolvedBy, canResolve: thread.canResolve, canUnresolve: thread.canUnresolve });

  /** Resolve or Unresolve: one click, one send. A resolved thread folds at once, as on GitHub; an unresolved one opens. A failure puts it back, open, with the reason. */
  function flipThread(link) {
    const key = link.closest('[data-gh]').dataset.gh;
    const threadId = key.slice('reply:'.length);
    const pull = shownRead()?.pull;
    const thread = pull && threadById(pull, threadId);
    if (!thread || flipping.has(threadId)) return;
    const kind = link.dataset.ghResolve;
    const before = flipState(thread);
    delete failed[key];
    flipping.add(threadId);
    Object.assign(thread, kind === 'resolve'
      ? { resolved: true, resolvedBy: me(pull), canResolve: false, canUnresolve: true }
      : { resolved: false, resolvedBy: undefined, canResolve: true, canUnresolve: false }, { sending: true });
    redrawThread(thread, kind === 'unresolve');
    void inBackground({ kind, threadId }, (result) => {
      flipping.delete(threadId);
      delete thread.sending;
      if (result.thread) Object.assign(thread, { resolvedBy: undefined }, result.thread);
      redrawThread(thread);
    }, (problem) => {
      flipping.delete(threadId);
      delete thread.sending;
      Object.assign(thread, before);
      failed[key] = problem;
      redrawThread(thread, true);
    });
  }

  /** The strip again, with the review panel open or closed; `focus` puts the cursor in its field, or on "Review" when it closed. */
  function redrawStrip(focus = false) {
    const el = document.getElementById('status');
    if (!el || !lastStrip) return;
    el.innerHTML = stripHtml(...lastStrip);
    bindStrip(el);
    if (focus) (el.querySelector('.review-panel textarea') ?? el.querySelector('[data-review]'))?.focus();
  }

  /** What of a thread shows: after a read in the background a thread is drawn again only when this differs. */
  const threadKey = (thread) => JSON.stringify([thread.resolved, thread.outdated, thread.resolvedBy?.login, thread.canReply, thread.canResolve, thread.canUnresolve,
    thread.comments.map((one) => [one.id, one.html, one.edited, one.hidden, one.reactions])]);

  /**
   * After a read of the pull request in the background (App.reread): only what differs from what shows changes, in place: the strip, each thread
   * whose comments or state changed, the state card. Nothing is drawn anew, so the place, the folds and the focus stay.
   * New items of others show at the next drawing of the conversation.
   */
  function refresh(before, after, shown) {
    keepFocus(() => {
      drawStrip();
      if (!shown || !document.querySelector('.conv')) return;
      const was = new Map(allThreads(before).map((thread) => [thread.id, threadKey(thread)]));
      for (const thread of allThreads(after)) if (was.has(thread.id) && was.get(thread.id) !== threadKey(thread)) redrawThread(thread);
      redrawCard();
    });
  }

  // ----- a suggested change: "Commit suggestion" and "Add suggestion to batch", as on GitHub -----

  const applied = {}; // the short commit of each thread whose suggestion he committed on this page, by thread id
  const batch = new Map(); // the suggestions in the batch: comment id → thread id

  /** The lines of a thread in the file at the head of the pull request, from the code of the thread; null when its code does not hold them all. */
  function oldLines(thread) {
    if (!thread.lines) return null;
    const [start, end] = thread.lines;
    const rows = thread.code.filter((row) => row.sign !== '-' && row.line >= start && row.line <= end);
    return rows.length === end - start + 1 ? rows.map((row) => row.text) : null;
  }

  /** True when a suggestion of another comment in the batch is on a line of this thread: GitHub applies one suggestion per line in a batch. */
  const overlapsBatch = (thread, comment, pull) => [...batch].some(([commentId, threadId]) => {
    const other = commentId !== comment.id && threadById(pull, threadId);
    return other && other.path === thread.path && other.lines[0] <= thread.lines[1] && thread.lines[0] <= other.lines[1];
  });

  /**
   * Why GitHub would not apply this suggestion now, in GitHub's own words; '' when it can. null: no button and no words, when he may not push
   * to the branch, the comment has more than one suggestion, or the lines that it replaces are not known.
   */
  function whyNot(thread, comment, pull) {
    if (applied[thread.id] !== undefined) return WRITE.applied(applied[thread.id]);
    if (!pull.canApply || !canWrite(pull) || comment.suggestions.length !== 1 || comment.sending) return null;
    if (!pull.open) return 'Suggestions cannot be applied while the pull request is closed.';
    if (pull.queued) return 'Suggestions cannot be applied while the pull request is queued to merge.';
    if (thread.outdated) return 'Outdated suggestions cannot be applied.';
    if (thread.resolved) return 'This suggestion has been applied or marked resolved.';
    if (thread.side === 'LEFT') return 'Applying suggestions on deleted lines is not supported.';
    if (comment.suggestions[0].pending) return 'Suggestions cannot be applied from pending reviews.';
    const old = oldLines(thread);
    if (!old) return null;
    if (old.join('\n') === comment.suggestions[0].lines.join('\n')) return 'This suggestion is invalid because no changes were made to the code.';
    if (overlapsBatch(thread, comment, pull)) return 'Only one suggestion per line can be applied in a batch.';
    return '';
  }

  /** The buttons of a suggestion: "Commit suggestion" and "Add suggestion to batch"; in a batch "Commit suggestions (2)" and "Remove from batch". */
  function suggestionActions(thread, comment, pull) {
    const why = whyNot(thread, comment, pull);
    if (why === null) return '';
    if (why) return `<span class="ghh">${esc(why)}</span>`;
    const inBatch = batch.has(comment.id);
    const commit = inBatch ? WRITE.commitBatch(batch.size) : batch.size ? '' : WRITE.commitSuggestion; // while a batch is open, only its own suggestions commit
    return `<span class="sga">${commit ? `<button class="ghs" data-suggest="commit">${esc(commit)}</button>` : ''}`
      + `<a class="ghr" data-suggest="${inBatch ? 'unbatch' : 'batch'}" tabindex="0">${esc(inBatch ? WRITE.unbatch : WRITE.batch)}</a></span>`;
  }

  /** A suggested change as a change of the lines of its thread: the lines as they are, removed, and the suggested lines, added; with its buttons. */
  function suggestionHtml(thread, comment, index, pull, actions) {
    const start = thread.lines?.[0] ?? 0;
    const rows = [...(oldLines(thread) ?? []).map((text, at) => ({ sign: '-', text, line: start + at })),
      ...comment.suggestions[index].lines.map((text, at) => ({ sign: '+', text, line: start + at }))];
    const head = actions && index === 0 && pull ? suggestionActions(thread, comment, pull) : '';
    return `<div class="sugg" data-sugg="${esc(thread.id)}"><div class="sgh"><span>${esc(WRITE.suggested)}</span>${head}</div><div class="tcode">${codeRows(rows)}</div></div>`;
  }

  /** The text of a comment on code: its suggested changes where GitHub had them, or after the text when GitHub's HTML had no place for them. */
  function commentText(comment, thread, pull, actions) {
    if (!comment.suggestions?.length) return comment.html;
    let index = 0;
    const html = comment.html.replace(/<div data-suggestion><\/div>/g, () => (index < comment.suggestions.length ? suggestionHtml(thread, comment, index++, pull, actions) : ''));
    return html + comment.suggestions.slice(index).map((_, at) => suggestionHtml(thread, comment, index + at, pull, actions)).join('');
  }

  /** The heads of the suggestions that show, after the batch changed. */
  function redrawSuggestions(pull) {
    for (const head of document.querySelectorAll('.conv .sc[data-said] .sugg .sgh')) {
      const thread = threadById(pull, head.closest('[data-sugg]').dataset.sugg);
      const comment = thread?.comments.find((one) => one.id === head.closest('[data-said]').dataset.said);
      if (comment) head.innerHTML = `<span>${esc(WRITE.suggested)}</span>${suggestionActions(thread, comment, pull)}`;
    }
  }

  /** A click on a button of a suggestion: into the batch, out of it, or commit. */
  function suggestAction(el) {
    const pull = shownRead()?.pull;
    const thread = pull && threadById(pull, el.closest('[data-sugg]').dataset.sugg);
    const comment = thread?.comments.find((one) => one.id === el.closest('[data-said]')?.dataset.said);
    if (!comment) return;
    const what = el.dataset.suggest;
    if (what === 'batch') batch.set(comment.id, thread.id);
    if (what === 'unbatch') batch.delete(comment.id);
    if (what !== 'commit') return redrawSuggestions(pull);
    const chosen = batch.size ? [...batch].map(([commentId, threadId]) => {
      const one = threadById(pull, threadId);
      return { thread: one, comment: one?.comments.find((said) => said.id === commentId) };
    }).filter((one) => one.comment) : [{ thread, comment }];
    commitSuggestions(chosen, pull);
  }

  /**
   * "Commit suggestion" (or the batch): one commit on the branch of the pull request with GitHub's message and the authors of the suggestions
   * as co-authors, then each thread resolved, as GitHub does. Each thread folds at once as applied, marked "sending"; a failure opens them again with the reason.
   */
  function commitSuggestions(chosen, pull) {
    const threads = [...new Set(chosen.map((one) => one.thread))];
    const coAuthors = [...new Set(chosen.filter((one) => !one.comment.mine).map((one) => one.comment.suggestions[0].coAuthor))];
    const write = {
      kind: 'suggestions', repo: pull.headRepo, branch: pull.head, headOid: pull.headOid, threadIds: threads.map((thread) => thread.id),
      changes: chosen.map(({ thread, comment }) => ({ path: thread.path, start: thread.lines[0], end: thread.lines[1], old: oldLines(thread), lines: comment.suggestions[0].lines })),
      message: { headline: chosen.length === 1 ? `${WRITE.one} ${baseName(threads[0].path)}` : WRITE.many, body: coAuthors.join('\n') },
    };
    const before = threads.map((thread) => [thread, flipState(thread)]);
    const kept = new Map(batch);
    batch.clear();
    for (const thread of threads) {
      delete failed[`reply:${thread.id}`];
      Object.assign(thread, { resolved: true, resolvedBy: me(pull), canResolve: false, canUnresolve: true, sending: true });
      applied[thread.id] = '';
      redrawThread(thread, false);
    }
    redrawSuggestions(pull);
    void inBackground(write, (result) => {
      if (result.commit) pull.headOid = result.commit.oid; // the branch has moved on: the next commit or comment on code starts from it
      for (const thread of threads) {
        delete thread.sending;
        applied[thread.id] = result.commit?.short ?? '';
        redrawThread(thread);
      }
    }, (problem) => {
      for (const [thread, state] of before) {
        delete thread.sending;
        delete applied[thread.id];
        Object.assign(thread, state);
        failed[`reply:${thread.id}`] = problem;
        redrawThread(thread, true);
      }
      kept.forEach((threadId, commentId) => batch.set(commentId, threadId));
      redrawSuggestions(pull);
    });
  }

  // ----- the example: a send in the page as a file in a browser goes nowhere; the example answers as GitHub does, and the page shows it as in VS Code -----

  let exampleCount = 0;
  function exampleWrite(write) {
    const failure = window.apostilExampleFailure; // a browser check makes one send fail with GitHub's sentence
    if (failure) { window.apostilExampleFailure = undefined; return { problem: failure }; }
    const pull = shownRead()?.pull;
    if (!pull) return { problem: 'The example has no pull request here.' };
    const said = (body) => ({
      id: `example-${++exampleCount}`, author: me(pull), at: new Date().toISOString(), edited: false,
      html: `<p>${esc(body).replace(/\n/g, '<br>')}</p>`, reactions: [], url: pull.url, example: true, mine: true,
    });
    if (write.kind === 'comment') return { ok: true, comment: said(write.body) };
    if (write.kind === 'reply') { // GitHub's next read lists an answer also as a later answer of the pull request, as the reader gives it
      const comment = said(write.body);
      pull.items.push({ kind: 'reply', at: comment.at, thread: threadById(pull, write.threadId), comment });
      return { ok: true, comment };
    }
    if (write.kind === 'resolve' || write.kind === 'unresolve') {
      const resolved = write.kind === 'resolve';
      return { ok: true, thread: { resolved, ...(resolved ? { resolvedBy: me(pull) } : {}), canReply: true, canResolve: !resolved, canUnresolve: resolved } };
    }
    if (write.kind === 'review') {
      const state = { APPROVE: 'approved', REQUEST_CHANGES: 'changes requested', COMMENT: 'reviewed' }[write.verdict];
      return { ok: true, review: { ...said(write.body), html: write.body ? said(write.body).html : '', state } };
    }
    if (write.kind === 'suggestions') return { ok: true, commit: { oid: `5e6f7a8${'0'.repeat(33)}`, short: '5e6f7a8' } };
    if (write.kind === 'merge') return { ok: true, merged: { at: new Date().toISOString(), by: me(pull), commit: '9c4e2a1' } };
    if (write.kind === 'update') return { ok: true, headOid: `4d8b0f3${'0'.repeat(33)}` };
    if (['close', 'reopen', 'ready', 'draft', 'delete-branch'].includes(write.kind)) return { ok: true };
    // A comment on code comes from another view: the example keeps it as GitHub would, and the conversation shows it when it is drawn.
    if (write.kind === 'lines' && pull.pending) pull.pending.comments++;
    if (write.kind === 'lines' && !pull.pending) {
      const { path, line, startLine } = write.lines;
      const comment = said(write.body);
      pull.items.push({ kind: 'thread', at: comment.at, thread: {
        id: `example-thread-${exampleCount}`, path, lines: [startLine ?? line, line], resolved: false, outdated: false, comments: [comment], cutComments: 0, code: [],
        wholeFile: false, fileRemoved: false, canReply: true, canResolve: true, canUnresolve: false,
      } });
    }
    return { ok: true };
  }

  // ----- the comment box on code: the choice "@github" -----

  /**
   * Whether a comment on code lines can go to the open pull request: { pull, side } when it can, { why } when it cannot, and null when there
   * is nothing to say (no open pull request, or not code lines). GitHub takes it only on lines of its diff, at its head commit.
   */
  function codeTarget(target) {
    if (target?.kind !== 'lines' || !target.file) return null;
    const read = shownRead();
    const pull = read?.pull;
    if (!pull?.open || !pull.id) return null;
    if (pull.locked) return { why: WRITE.lockedPull(pull.number) };
    if (!read.lines?.atHead) return { why: WRITE.notAtHead };
    if (read.lines.dirty.includes(target.file)) return { why: WRITE.dirty };
    const [first, last] = target.lines;
    const ranges = read.lines.files[target.file]?.[target.removed ? 'left' : 'right'] ?? [];
    if (!ranges.some(([from, to]) => from <= first && last <= to)) return { why: WRITE.notInDiff(pull.number, first === last) };
    return { pull, side: target.removed ? 'LEFT' : 'RIGHT' };
  }

  /** The quiet line of the comment box about "@github": that it exists, or why it is not offered; '' when there is nothing to say. */
  function codeLine(target) {
    const found = codeTarget(target);
    if (!found) return '';
    if (found.why) return found.why;
    return `${WRITE.githubHint(found.pull.number)}${found.pull.pending ? ` ${WRITE.intoReview}` : ''}`;
  }

  /** The choice "@github" for the list of "@", when a comment on these lines can go to the pull request. */
  function githubChoice(target) {
    const found = codeTarget(target);
    return found?.pull ? { app: 'github', kind: 'pull', name: 'github', does: WRITE.github(found.pull.number) } : null;
  }

  /** Sends a comment on code lines to the pull request. Answers { ok } or { problem }. */
  function sendCode(target, body) {
    const found = codeTarget(target);
    if (!found?.pull) return Promise.resolve({ problem: found?.why ?? 'There is no open pull request for these lines.' });
    const { pull, side } = found;
    const [first, last] = target.lines;
    const lines = { path: target.file, line: last, side, ...(first !== last ? { startLine: first, startSide: side } : {}) };
    return toGitHub({ kind: 'lines', pullId: pull.id, commit: pull.headOid, lines, body, ...(pull.pending ? { pendingId: pull.pending.id } : {}) })
      .then((result) => { if (result.ok && !vscodeApi) App.reread(); return result; });
  }

  // ----- a comment on a message of the conversation (the card of remarks.js): the choice "The pull request on GitHub" -----

  /** The thread on code that a message stands in, when he may answer there; undefined for a message of the conversation itself. */
  const messageThread = (pull, target) => (target.message?.thread ? threadById(pull, target.message.thread) : undefined);

  /** The choice "@github" for a comment on a message: an answer in its thread on code, else a comment on the pull request. Null when GitHub takes neither. */
  function messageChoice(target) {
    const pull = shownRead()?.pull;
    if (!pull?.open || !pull.id || pull.locked || target?.kind !== 'message') return null;
    const thread = messageThread(pull, target);
    if (target.message.thread && !thread?.canReply) return null;
    return { app: 'github', kind: 'pull', name: 'github', does: thread ? WRITE.githubThread : WRITE.github(pull.number) };
  }

  /**
   * Sends a comment on a message to the pull request, as its own fields send: an answer in its thread on code, or a comment at the end that quotes
   * the message. It shows at once and GitHub answers in the background; a failure gives the words back to that field with GitHub's sentence.
   */
  function sendOnMessage(target, body) {
    const pull = shownRead()?.pull;
    if (!messageChoice(target)) return Promise.resolve({ problem: 'GitHub does not take a comment here.' });
    const thread = messageThread(pull, target);
    if (thread) sendReply({ kind: 'reply', threadId: thread.id, body }, `reply:${thread.id}`);
    else sendComment({ kind: 'comment', pullId: pull.id, body: `> @${target.message.author}: ${target.message.words}\n\n${body}` }, `comment:${pull.id}`);
    return Promise.resolve({ ok: true });
  }

  // Typing keeps the text; Cmd+Enter sends; a click on a button sends; Resolve and Review take a click, or Enter on the keyboard.
  document.addEventListener('input', (event) => {
    const field = event.target.closest?.('[data-merge-field]');
    const pull = field && mergeStep && shownRead()?.pull;
    if (pull) { // his commit title and message, kept for this method while the page shows
      const key = `${pull.id}:${mergeStep.method}`;
      mergeEdits[key] = { ...(mergeEdits[key] ?? MergeCard.commitText(pull, mergeStep.method)), [field.dataset.mergeField]: field.value };
      return;
    }
    const box = event.target.closest?.('[data-gh]');
    if (!box || event.target.tagName !== 'TEXTAREA') return;
    drafts[box.dataset.gh] = event.target.value;
    if (!event.target.value) delete drafts[box.dataset.gh];
    keepDrafts();
  });
  document.addEventListener('change', (event) => {
    const radio = event.target.closest?.('.review-panel input[type="radio"]');
    if (radio) verdicts[radio.name.slice('verdict-'.length)] = radio.value;
    const method = event.target.closest?.('.pcway input[type="radio"]');
    if (method && mergeStep) {
      mergeStep.method = method.value;
      redrawCard();
      document.querySelector('#pcard .pcway input:checked')?.focus();
    }
  });
  document.addEventListener('keydown', (event) => {
    const box = event.target.closest?.('[data-gh]');
    if (box && event.target.tagName === 'TEXTAREA' && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); sendField(box); }
    if (event.key === 'Enter' && event.target.closest?.('[data-gh-resolve], [data-review], a[data-suggest], a[data-card-act], a[data-card-go], [data-merge-go]')) { event.preventDefault(); event.target.click(); }
    if (event.key === 'Escape' && event.target.closest?.('[data-merge-step]')) { mergeStep = null; redrawCard(); document.querySelector('#pcard [data-card-act="merge"]')?.focus(); }
  });
  document.addEventListener('click', (event) => {
    const send = event.target.closest('[data-gh-send]');
    if (send) return sendField(send.closest('[data-gh]'));
    const flip = event.target.closest('[data-gh-resolve]');
    if (flip) return flipThread(flip);
    const suggest = event.target.closest('[data-suggest]');
    if (suggest) return suggestAction(suggest);
    if (event.target.closest('[data-review]')) {
      reviewOpen = !reviewOpen;
      redrawStrip(true);
    }
    if (event.target.closest('[data-merge-go]')) return goMerge();
    const act = event.target.closest('[data-card-act]')?.dataset.cardAct;
    if (act === 'merge' || act === 'merge-admin') return openMerge(act === 'merge-admin');
    if (act === 'confirm') return confirmMerge();
    if (act === 'cancel') { mergeStep = null; return redrawCard(); }
    if (act) return changePull(act);
    const go = event.target.closest('[data-card-go]')?.dataset.cardGo;
    if (go) cardGo(go);
  });

  /** The press "Merge" of the strip: "Conversation" opens at the card, with its merge step open. */
  function goMerge() {
    if (App.state.view === 'conversation' && document.getElementById('pcard')) return openMerge();
    openAtCard = true;
    void App.go({ view: 'conversation' }).then(() => openMerge());
  }

  // ----- the whole view -----

  /** "14 messages over 2 days". */
  function spanWords(pull) {
    const messages = pull.items.filter((item) => item.kind === 'comment' || item.kind === 'review' || item.kind === 'thread').length;
    if (!pull.items.length) return plural(messages, 'message');
    const days = Math.round((new Date(pull.items[pull.items.length - 1].at) - new Date(pull.openedAt)) / DAY);
    return `${plural(messages, 'message')}${days >= 1 ? ` over ${plural(days, 'day')}` : ''}`;
  }

  /** The quiet lines that say what is not shown, each with the link to GitHub. Nothing when nothing is missing. */
  function cutLines(pull) {
    const lines = [];
    const link = `<a data-link="${esc(pull.url)}">GitHub</a>`;
    if (pull.notShown) lines.push(`${pull.notShown === 1 ? '1 event of an unknown kind is' : `${pull.notShown} events of unknown kinds are`} not shown. See them on ${link}.`);
    if (pull.cut.timeline) lines.push(`${number(pull.cut.timeline)} earlier items are on ${link}.`);
    if (pull.cut.threads) lines.push(`${plural(pull.cut.threads, 'review thread')} past the limit are not read. See them on ${link}.`);
    const commitItems = pull.items.filter((item) => item.kind === 'commit').length;
    if (!pull.cut.timeline && pull.commits > commitItems) lines.push(`GitHub lists ${commitItems} of the ${number(pull.commits)} commits here. See all on ${link}.`);
    return lines.map((line) => `<p class="cutline">${line}</p>`).join('');
  }

  /** The title, one line of facts that wraps between whole facts, and the description. A rule of the look names the facts that show, and opens, widens or leaves out the description. */
  function topHtml(pull) {
    const facts = {
      author: `<span class="fact">${avatar(pull.author, 's')}${name(pull.author)}<span>opened ${esc(ago(pull.openedAt))}</span></span>`,
      branches: `<span class="fact">${branchPill(pull.head)} → ${branchPill(pull.base)}${belowLink(pull)}</span>`,
      size: `<span class="fact"><i class="p">+${number(pull.added)}</i> <i class="m">−${number(pull.removed)}</i> in ${plural(pull.fileCount, 'file')}</span>`,
      github: `<span class="fact"><a class="gh" data-link="${esc(pull.url)}">GitHub ${ico('link-external')}</a></span>`,
    };
    const look = own('description');
    const width = look['window.width'] ? ` style="max-width:${Number(look['window.width'])}px"` : '';
    const about = mode === 'classic' || look['show.shown'] === false ? '' // Classic has the description as its first box
      : !pull.html ? '<p class="about-none quiet">No description</p>'
      : look['show.folded'] === false ? `<section class="about"${width}><div class="md">${pull.html}</div></section>`
      : `<section class="about" data-box${width}><div class="md folded">${pull.html}</div><a class="more" data-toggle><span class="show">Show more</span><span class="hide">Show less</span></a></section>`;
    const place = mode === 'messages' ? stackLine(pull) : pull.stack ? `<p class="splace">${ico('git-branch')}${esc(stackWords(pull))}</p>` : '';
    const shown = own('pull-facts').content?.fields ?? Object.keys(facts);
    // The state card stands under the facts line and above the description, in both looks: the state has this one place.
    return `<h1 class="ptitle">${esc(pull.title)} <span class="num">#${pull.number}</span></h1><div class="meta">${shown.map((one) => facts[one]).join('')}</div>${place}${mode === 'messages' ? factsLine(pull) : ''}${cardHtml(pull)}${about}`;
  }

  /**
   * The slim bar that holds the pull request in short; it shows at the top when the title is scrolled away.
   * It carries the switch of views of the page too, so that the way to "Diagram" and "Diffs" is never scrolled away.
   */
  const shortHtml = (pull) => `<div class="short" id="short">${icon(pull, false)}<span class="name"><i class="num">#${pull.number}</i> ${esc(pull.title)}</span>`
    + `${document.querySelector('.bar .switch')?.outerHTML ?? ''}</div>`;

  /**
   * Mermaid blocks of a description or a comment: drawn with the Mermaid of the page and its safe settings; the code stays when it does not parse.
   * Mermaid takes scripts and handlers out of the drawing; its own CSS (a "themeCSS" in the block) stays inside the box .mmd (contain:paint in look.css).
   */
  async function drawMermaidBlocks(root) {
    if (typeof mermaid !== 'object') return;
    for (const pre of root.querySelectorAll('pre[data-mermaid]')) {
      try {
        const { svg } = await mermaid.render(`pr-mermaid-${++threadCount}`, pre.textContent);
        const box = document.createElement('div');
        box.className = 'mmd';
        box.innerHTML = svg;
        lookColors(box.querySelector('svg')); // in the colours of the look, as every drawing (diagram-stage.js)
        pre.replaceWith(box);
      } catch { pre.removeAttribute('data-mermaid'); }
    }
  }

  /** Scrolls the window to its newest message, again for a few frames: a picture or a drawing near the end can change its height. */
  function toNewest(frames = 3) {
    const room = scroller();
    if (!room) return;
    room.scrollTop = room.scrollHeight;
    markNewest();
    if (frames > 0) requestAnimationFrame(() => toNewest(frames - 1));
  }

  /** Opens a fold of the window in place: what it holds stands where the fold stood, and the window does not jump. */
  function unfoldInPlace(fold, html) {
    const top = topInWindow(fold);
    const before = fold.previousElementSibling;
    const parent = fold.parentElement;
    fold.outerHTML = html;
    const first = before ? before.nextElementSibling : parent.firstElementChild;
    if (top !== null && first) scroller().scrollTop += topInWindow(first) - top;
  }

  /**
   * Draws the conversation into a box. `since` is when he last looked, or undefined. `progress` ({ read, total }) while a large pull request is read.
   * The page opens at its top: the strip, the title, the facts, the state card and the description. The conversation is a window of its own under them,
   * with its head at its top, the box to write at its bottom and its own scroll between. The window opens as a chat app opens a conversation: at the oldest
   * message that he has not seen, at its top edge (in "Messages" the line "New since you last looked", in "Classic" the first row that he has not seen);
   * at its first message when he never opened this pull request; at its newest message when he has seen it all.
   */
  function draw(into, pull, since, progress) {
    earlyRows.clear();
    // His last choice of "Messages" or "Classic" wins; with none, the look that a rule of the look puts first.
    mode = chosen === 'classic' || chosen === 'messages' ? chosen : own('conversation-look')['order.first']?.[0] === 'classic' ? 'classic' : 'messages';
    // The same pull request drawn again (the other look, more of a large read): the page stays where it is. Else it opens at its top.
    const again = into.querySelector(':scope > .conv')?.dataset.pull === pull.url;
    const pageAt = again ? scrollY : 0;
    const windowAt = again ? scroller()?.scrollTop : undefined;
    arrived = 0;
    const messages = mode === 'messages' ? messagesHtml(pull, since) : null;
    const reading = progress ? `<p class="reading">Reading the conversation: ${number(progress.read)} of about ${number(progress.total)} items</p>` : '';
    const feed = `${cutLines(pull)}${reading}<div class="feed">${messages ? messages.html : classicHtml(pull, since)}</div>`;
    const head = `<div class="head"><b>Conversation</b><span>${esc(spanWords(pull))}</span><span class="sp"></span>`
      + `<span class="toggle"><a data-mode="messages" class="${mode === 'messages' ? 'on' : ''}">Messages</a><span class="sep">·</span><a data-mode="classic" class="${mode === 'classic' ? 'on' : ''}">Classic</a></span></div>`;
    const win = `<section class="cwin" id="cwin">${head}<div class="cscroll" id="cscroll">${feed}</div><div class="cfoot"><a class="newest" id="newest">↓ Newest</a>${endHtml(pull)}</div></section>`;
    into.innerHTML = `<div class="conv ${mode}" data-pull="${esc(pull.url)}">${shortHtml(pull)}${topHtml(pull)}`
      + (mode === 'classic' ? `<div class="cwrap"><aside class="cside">${factsSections(pull)}</aside><div class="cmain">${classicTopHtml(pull)}${win}</div></div>` : win)
      + '</div>';
    const conv = into.firstElementChild;
    const room = conv.querySelector('#cscroll');
    const about = conv.querySelector('.about');
    const folded = about?.querySelector('.md.folded');
    if (folded && folded.scrollHeight <= folded.clientHeight + 4) { folded.classList.remove('folded'); about.querySelector('.more').remove(); }
    conv.querySelector('[data-earlier]')?.addEventListener('click', (event) => {
      unfoldInPlace(event.currentTarget, entriesHtml(messages.earlier, pull));
      void drawMermaidBlocks(conv);
    }, { once: true });
    conv.querySelector('[data-classic-more]')?.addEventListener('click', (event) => {
      unfoldInPlace(event.currentTarget.closest('.ev'), classicHidden.rows.map((item) => classicRow(item, classicHidden.pull)).join(''));
    }, { once: true });
    conv.querySelectorAll('[data-mode]').forEach((link) => link.addEventListener('click', () => {
      if (link.dataset.mode === mode) return;
      chosen = link.dataset.mode;
      keep({ conversationMode: chosen });
      draw(into, pull, since, progress);
    }));
    void drawMermaidBlocks(conv);
    // The slim bar shows when the title is out of view on the page; "↓ Newest" shows when the window is not at its newest message.
    const short = conv.querySelector('#short');
    const title = conv.querySelector('.ptitle');
    const onScroll = () => {
      if (!short.isConnected) return removeEventListener('scroll', onScroll);
      short.classList.toggle('on', title.getBoundingClientRect().bottom < 0);
    };
    addEventListener('scroll', onScroll, { passive: true });
    room.addEventListener('scroll', markNewest, { passive: true });
    const newest = conv.querySelector('#newest');
    newest.addEventListener('mousedown', (event) => event.preventDefault()); // the box keeps the keyboard: it would close, and move the button away from the pointer
    newest.addEventListener('click', () => toNewest());
    // The first unseen thing: the line or mark, or in Classic a new answer in its thread (its thread when that is folded).
    const said = mode === 'classic' && classicNew ? conv.querySelector(`[data-said="${CSS.escape(classicNew)}"]`) : null;
    const atCard = openAtCard && conv.querySelector('#pcard'); // the press "Merge" of the strip opened it
    openAtCard = false;
    const unseen = conv.querySelector('#new-line') ?? (said?.offsetParent ? said : said?.closest('.item'));
    if (unseen) unseen.dataset.firstUnseen = ''; // where the window opens
    // A picture or a drawing can change a height after the first frame, so the place of the window is set again for a few frames until it holds.
    const place = (frames) => {
      if (!conv.isConnected) return;
      if (atCard) { // the card is drawn again when its merge step opens
        const card = conv.querySelector('#pcard');
        const want = Math.min(Math.max(0, card.getBoundingClientRect().top + scrollY - 48), document.documentElement.scrollHeight - innerHeight);
        if (Math.abs(want - scrollY) > 1) scrollTo(0, want);
      }
      const end = room.scrollHeight - room.clientHeight;
      const want = unseen ? room.scrollTop + topInWindow(unseen) - 4 : since ? end : 0;
      room.scrollTop = Math.min(Math.max(0, want), end);
      onScroll();
      markNewest();
      if (frames > 0) requestAnimationFrame(() => place(frames - 1));
    };
    scrollTo(0, pageAt);
    if (progress) { // while it is read, the window stays where it is
      if (windowAt !== undefined) room.scrollTop = windowAt;
      onScroll();
      markNewest();
    } else place(6);
  }

  /** A failure in one plain line, and "Try again". */
  const problemHtml = (text) => `<div class="conv-problem"><p>${esc(text)}</p><a data-retry>Try again</a></div>`;

  // Folds: a click on [data-toggle] opens or closes its box. The folded code lines of a thread are drawn when he opens them.
  // A file of a thread or of a note of a check opens at its line. A picture opens large on a click.
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-link]')) return; // tools.js opens links
    if (event.target.closest('[data-tasks]')) {
      const about = document.querySelector('.conv .about');
      about?.classList.add('open');
      const task = about?.querySelector('input[type="checkbox"]');
      task?.closest('li')?.scrollIntoView({ block: 'center' });
      return;
    }
    const early = event.target.closest('[data-early]');
    if (early) {
      const box = early.closest('[data-box]');
      const rows = box.querySelector('.early');
      if (!rows.childElementCount && earlyRows.has(early.dataset.early)) rows.innerHTML = codeRows(earlyRows.get(early.dataset.early));
      return box.classList.toggle('open');
    }
    const other = event.target.closest('[data-stack-pull]');
    if (other) return Trail.take({ tab: 'pull', link: other.dataset.stackPull, name: `Pull request #${other.dataset.number}` }, true);
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) return toggle.closest('[data-box]').classList.toggle('open');
    const file = event.target.closest('[data-thread-file]');
    if (file) {
      const lines = file.dataset.lines ? file.dataset.lines.split(',').map(Number) : undefined;
      return tell({ type: 'openFileTab', path: file.dataset.threadFile, lines });
    }
    const picture = event.target.closest('.conv .md img');
    if (picture) {
      const frame = windowFrame({ title: picture.alt || 'Picture', width: Math.min(1200, innerWidth - 24), actions: '<a data-close>Close</a>' });
      frame.body.classList.add('pad');
      frame.body.innerHTML = `<img class="big" src="${esc(picture.src)}" alt="${esc(picture.alt)}">`;
      placeWindow(frame.el, { top: 12, bottom: 12, left: 12, right: 12 });
      const close = () => { frame.el.remove(); removeEventListener('mousedown', outside, true); };
      const outside = (inner) => { if (!frame.el.contains(inner.target) || inner.target.closest('[data-close]')) close(); };
      addEventListener('mousedown', outside, true);
    }
  });
  // A picture that does not load becomes its text and a link: never a broken icon.
  document.addEventListener('error', (event) => {
    const picture = event.target;
    if (picture.tagName !== 'IMG' || !picture.closest('.conv .md')) return;
    picture.outerHTML = `<a class="nopic" data-link="${esc(picture.src)}">Picture: ${esc(picture.alt || 'a picture')}</a>`;
  }, true);

  return { draw, refresh, writing, writesStarted, stripHtml, bindStrip, icon, problemHtml, ago, entriesOf, checksLine, codeLine, githubChoice, sendCode, messageChoice, sendOnMessage, WRITE };
})();
