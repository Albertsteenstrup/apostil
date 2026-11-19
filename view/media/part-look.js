// The look of a repo on the parts that a page draws as HTML: the rows of the list "Repo" and the parts of the page of a pull request.
// Which rule wins a slot of a part is decided as for a thing of a drawing (Marks.resolve in marks.js). This file reads the fields of a part, orders
// rows, and gives the colours and the icons of a rule as HTML. With no look, or no rule for a part, the part gets no slot and keeps its own style.
// Nothing here draws, so that the tests read it in Node.
'use strict';

const PartLook = (() => {
  const Look = typeof Marks === 'object' ? Marks : require('./marks.js');
  const Words = typeof States === 'object' ? States : require('./states.js');
  const quote = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /** The slots that the rules of a look give one part, by its kind and its fields (Marks.slotsIn); `more` adds what a pick reads beside them (paths, marks). */
  const slotsOf = (look, kind, fields = {}, more = {}) => Look.slotsIn(look, { kind, fields, ...more });

  // ----- colours and icons as HTML -----

  const NONE = { cls: '', style: '' };

  /** Colours on a part drawn as HTML, as paint() of marks.js sets them on a drawing: a class for each name and the colours of both themes (look.css picks one). */
  function colorAttrs(colors, marker) {
    const named = Object.entries(colors).filter(([, pair]) => pair);
    if (!named.length) return NONE;
    return {
      cls: ` ${marker} ${named.map(([name]) => `lk-${name}`).join(' ')}`,
      style: ` style="${named.map(([name, pair]) => `--lk-${name}-l:${quote(pair.light)};--lk-${name}-d:${quote(pair.dark)}`).join(';')}"`,
    };
  }

  /** A box in one colour of a rule (its fill, its words and its line) and a line colour of its own; nothing when the rule gives none. */
  function boxAttrs(color, line) {
    const box = color && Look.boxColors(color);
    return colorAttrs({
      fill: box && { light: box.light.fill, dark: box.dark.fill }, ink: box && { light: box.light.text, dark: box.dark.text },
      line: line ? Look.lineColors(line) : box && { light: box.light.line, dark: box.dark.line },
    }, 'lk-box');
  }

  /** Words in the colour of a rule, moved until they read on the page in both themes. */
  const wordsAttrs = (color) => (color ? colorAttrs({ words: Look.lineColors(color, Look.READS) }, 'lkw') : NONE);

  /** An icon of the look before words, or '' when the rule gives none or its file is gone. */
  const iconHtml = (look, name) => { const src = name && look?.files?.[name]; return src ? `<img class="lk-ic" src="${quote(src)}" alt="">` : ''; };

  /** A colour of a rule as the colour of a label of GitHub (six hex digits), or undefined. */
  const labelColor = (color) => (color ? { color: (color.length === 4 ? [...color.slice(1)].map((one) => one + one).join('') : color.slice(1)) } : undefined);

  /** True for each field that "content.fields" shows, or for all when the rule gives none. */
  const shows = (fields) => (name) => !fields || fields.includes(name);

  // ----- the list "Repo" -----

  /** The fields of a row of a change (LOOK_PARTS: "change-row"): what a pick "where", an order and "content.fields" read. */
  const rowFields = (row, pulls = []) => ({
    branch: row.branch, state: Words.rowState(row.remarks, row.phrase), age: Math.max(0, Math.round((Date.now() - Date.parse(row.savedAt)) / 60000)) || 0,
    commits: row.commits, files: row.files, added: row.added, removed: row.removed, app: row.agent?.app ?? '', author: pulls.find((pull) => pull.author)?.author.login ?? '',
  });

  /** The checks of a pull request of the list in one word, for the pick of its line: failed, running, passed or none. */
  const checksWord = (checks) => (checks.failed ? 'failed' : checks.pending ? 'running' : checks.passed ? 'passed' : 'none');

  /** The search that the list starts with: the one that VS Code keeps for the repo, else the words of a rule, else none. His own search always wins. */
  const startSearch = (kept, words) => kept ?? (words ? { text: words } : {});

  /** The order that a rule gives the rows of the list ("order" of "change-row"), or null when it gives none. */
  function rowOrder(look) {
    const own = slotsOf(look, 'change-row');
    const order = { by: own['order.by'], down: own['order.down'], group: own['order.group'], first: own['order.first'] };
    return order.by || order.group || order.first ? order : null;
  }

  /**
   * The rows of the list in the order of a rule, from the groups of the sessions (in their default order inside each): grouped by its field "group";
   * with "by" and no group in one group, as a sort makes one flat list; else under the heads of their sessions, the group of a row that comes first first.
   * Returns [{ by, value, agent, rows }]: `by` is the field of the groups ("session", another field, or none).
   */
  function rowGroups(groups, pullsOf, order) {
    const by = order.group ?? (order.by ? undefined : 'session');
    const rows = groups.flatMap((group, at) => group.rows.map((row) => ({ id: row.branch, row, fields: { ...rowFields(row, pullsOf(row)), session: at } })));
    return Look.orderRows(rows, { ...order, group: by }).map((one) => ({
      by, value: one.group, agent: by === 'session' ? groups[one.group]?.agent : undefined, rows: one.rows.map((wrapped) => wrapped.row),
    }));
  }

  // ----- the page of a pull request -----

  const CHECK_STATE = { failed: 'failed', 'timed out': 'failed', 'needs action': 'failed', cancelled: 'failed', waiting: 'waiting', running: 'running', passed: 'passed', neutral: 'passed', skipped: 'skipped' };
  /** The fields of a check (LOOK_PARTS: "check"); its state in the five words of a look. */
  const checkFields = (check) => ({ name: check.name, workflow: check.group, state: CHECK_STATE[check.state] ?? 'waiting', time: check.seconds ?? 0 });
  /** True when no rule leaves the check out. The status strip counts every check either way. */
  const checkShown = (look, check) => slotsOf(look, 'check', checkFields(check))['show.shown'] !== false;

  /** The checks in the groups and the order of a rule ([{ title, checks }], by their workflow unless it groups by another field), or null with no rule. */
  function checkGroups(look, checks) {
    const own = slotsOf(look, 'check');
    if (!own['order.by'] && !own['order.group']) return null;
    const rows = checks.map((check) => ({ check, fields: checkFields(check) }));
    return Look.orderRows(rows, { by: own['order.by'], down: own['order.down'], group: own['order.group'] ?? 'workflow' })
      .map((one) => ({ title: String(one.group ?? ''), checks: one.rows.map((row) => row.check) }));
  }

  /** The bits of the status strip in their order: the rule's, else the reviewers (or the review in words when none is asked), the checks and the blocker. */
  const stripBits = (look, pull) => slotsOf(look, 'status-strip', { state: pull.state }).content?.fields ?? [pull.reviewers.length ? 'reviewers' : 'review', 'checks', 'blocker'];

  /** The sections of the side column that show, in their order: the ones of "order.first" first, then the others in their default order (Marks.shownInOrder). */
  const sideSections = (look, ids) => Look.shownInOrder(ids.map((id) => ({ kind: 'side-section', id, fields: { id } })), look).map((one) => one.id);

  // The kind of an event (EVENT_KINDS in shared/look.ts), by the icon that the reader gives it (shared/read-pull-request.ts).
  const EVENT_OF = {
    rocket: 'deployment', tag: 'label', milestone: 'milestone', person: 'assignee', eye: 'review', x: 'review', 'git-merge': 'merge', 'git-merge-queue': 'merge',
    'git-pull-request': 'state', 'git-pull-request-closed': 'state', 'git-pull-request-draft': 'state', pencil: 'title', 'cross-reference': 'mention', 'git-commit': 'mention', stop: 'lock', comment: 'comment',
  };
  /** The kind of an event or a commit of the conversation. */
  const eventOf = (item) => (item.kind === 'commit' ? 'commit' : item.icon === 'git-branch' ? (/^force-pushed/.test(item.text) ? 'push' : 'branch') : EVENT_OF[item.icon] ?? 'other');
  /** The kind of a message: a review, a comment of a bot or a product, or a comment. */
  const messageType = (item, author = item.author) => (item.kind === 'review' ? 'review' : author?.bot ? 'bot' : 'comment');

  return {
    slotsOf, boxAttrs, wordsAttrs, iconHtml, labelColor, shows, NONE,
    rowFields, checksWord, startSearch, rowOrder, rowGroups,
    checkFields, checkShown, checkGroups, stripBits, sideSections, eventOf, messageType,
  };
})();

if (typeof module === 'object') module.exports = PartLook; // for the tests in Node
