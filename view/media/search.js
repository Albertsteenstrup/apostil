// The search of the list in the side bar: one parser for the field, which rows match, their order, and the values of the menu of sort and filter.
// A filter is a word in the field, as on GitHub: author:<login>, reviewer:<login>, label:<name>, state:<state word>, agent:<app>; a name with a space
// is quoted. Every other word is text that a row must hold. Nothing here draws: list.js draws, and the tests read it in Node.
'use strict';

const Search = (() => {
  const Words = typeof States === 'object' ? States : require('./states.js');
  const KEYS = ['author', 'reviewer', 'label', 'state', 'agent'];
  const SORTS = ['modified', 'created', 'author', 'size'];
  const DEFAULT = { text: '', sort: 'modified', reverse: false };
  const NO_PULL = 'no pull request'; // the state word of a row with no pull request

  /** The words of the field: a quote keeps a name with a space together, also after a key (`label:"needs review"`); a quote that is not closed yet runs to the end. */
  const tokens = (text) => String(text ?? '').match(/(?:[^\s"]+:)?"[^"]*"?|[^\s"]+/g) ?? [];
  const unquote = (text) => text.replace(/^"|"$/g, '').trim();
  /** A value as it stands in the field: quoted when it has a space or a quote. */
  const quote = (value) => (/[\s"]/.test(value) ? `"${value.replace(/"/g, '')}"` : value);
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();

  /**
   * Reads the field: { words: [{ key, value }], free: [text] }, the free text in lower case. A word with a key that is not a filter
   * ("foo:bar") is plain text. A key with no value yet ("author:") filters nothing while it is typed.
   */
  function parse(text) {
    const query = { words: [], free: [] };
    for (const token of tokens(text)) {
      const match = /^([a-z]+):(.*)$/i.exec(token);
      if (match && KEYS.includes(match[1].toLowerCase())) {
        const value = unquote(match[2]);
        if (value) query.words.push({ key: match[1].toLowerCase(), value });
      } else if (unquote(token)) {
        query.free.push(unquote(token).toLowerCase());
      }
    }
    return query;
  }

  /** True when the field holds something that filters. */
  const active = (query) => query.words.length > 0 || query.free.length > 0;
  /** True while the sort is the default one: modified, newest first. */
  const defaultSort = (search) => (search.sort ?? DEFAULT.sort) === DEFAULT.sort && !search.reverse;
  /** True when the word is in the field. */
  const isOn = (query, key, value) => query.words.some((word) => word.key === key && same(word.value, value));

  /** The field with the word added, or taken away when it is there. The rest of the field stays. */
  function toggle(text, key, value) {
    const all = tokens(text);
    const kept = all.filter((token) => !isOn(parse(token), key, value));
    return (kept.length < all.length ? kept : [...all, `${key}:${quote(value)}`]).join(' ');
  }

  // ----- what a row and its pull requests can be found by -----

  /** The words of an agent app: the word of its mention ("claude") and its id ("claude-code"). */
  const agentWords = (agent) => (agent ? [...new Set([Words.MENTION_WORDS[agent.app] ?? agent.app, agent.app])] : []);
  /** The values of each filter that a pull request has. */
  const factsOf = (pull) => ({
    author: pull.author ? [pull.author.login] : [],
    reviewer: (pull.reviewers ?? []).map((one) => one.person.login),
    label: (pull.labels ?? []).map((one) => one.name),
    state: [pull.state],
  });
  const holds = (texts, word) => texts.some((text) => String(text).toLowerCase().includes(word));
  /** What the free text looks for in a pull request: its number, its title, its author, its reviewers and its labels. */
  const pullTexts = (pull) => { const facts = factsOf(pull); return [`#${pull.number}`, pull.title, ...facts.author, ...facts.reviewer, ...facts.label]; };

  /**
   * Whether a row matches, and which of its pull requests show: null when it does not match.
   * Words of one key are "or", keys are "and". A filter on pull requests (author, reviewer, label, state) keeps the pull requests that fit it.
   * A free word that the branch or the agent app holds keeps the row as it is; one that only pull requests hold keeps those pull requests.
   */
  function match(row, pulls, query) {
    let kept = pulls;
    for (const key of KEYS) {
      const values = query.words.filter((word) => word.key === key).map((word) => word.value.toLowerCase());
      if (!values.length) continue;
      if (key === 'agent') {
        if (!agentWords(row.agent).some((word) => values.includes(word))) return null;
      } else if (key === 'state' && !pulls.length) {
        if (!values.includes(NO_PULL)) return null;
      } else {
        kept = kept.filter((pull) => factsOf(pull)[key].some((value) => values.includes(value.toLowerCase())));
        if (!kept.length) return null;
      }
    }
    for (const word of query.free) {
      if (holds([row.branch, ...agentWords(row.agent)], word)) continue;
      kept = kept.filter((pull) => holds(pullTexts(pull), word));
      if (!kept.length) return null;
    }
    return kept;
  }

  // ----- the dates and the order -----

  const time = (iso) => { const at = Date.parse(iso ?? ''); return Number.isFinite(at) ? at : undefined; };
  const known = (values) => values.map(time).filter((at) => at !== undefined);
  /** Modified: the latest of the last save of the change and the last update of its pull requests. */
  const modifiedOf = (row, pulls) => { const all = known([row.savedAt, ...pulls.map((pull) => pull.updatedAt)]); return all.length ? Math.max(...all) : undefined; };
  /** Created: the first save of the change, else the creation of its oldest pull request, else the first commit of the branch. */
  const createdOf = (row, pulls) => { const opened = known(pulls.map((pull) => pull.createdAt)); return time(row.firstSavedAt) ?? (opened.length ? Math.min(...opened) : undefined) ?? time(row.firstCommitAt); };
  /** The author of a row: the author of its newest pull request. */
  const authorOf = (row, pulls) => pulls.find((pull) => pull.author)?.author.login;
  const VALUES = { modified: modifiedOf, created: createdOf, author: authorOf, size: (row) => row.added + row.removed };

  /**
   * The rows in the order of a sort: modified and created newest first, author A to Z, size the largest first; `reverse` turns it round.
   * A row with no value for the sort stands at the end either way. Equal rows keep the order of modified, then their order before.
   */
  function sortRows(rows, pullsOf, sort = DEFAULT.sort, reverse = false) {
    const by = SORTS.includes(sort) ? sort : DEFAULT.sort;
    const facts = rows.map((row, at) => ({ row, at, value: VALUES[by](row, pullsOf(row)), modified: modifiedOf(row, pullsOf(row)) ?? -Infinity }));
    const step = (a, b) => (by === 'author' ? a.localeCompare(b, undefined, { sensitivity: 'base' }) : b - a);
    const order = (a, b) => {
      if (a.value === undefined || b.value === undefined) return a.value === b.value ? 0 : a.value === undefined ? 1 : -1;
      return (reverse ? -1 : 1) * step(a.value, b.value);
    };
    return facts.sort((a, b) => order(a, b) || b.modified - a.modified || a.at - b.at).map((fact) => fact.row);
  }

  // ----- the menu -----

  /**
   * The values of each filter that the rows have, each with the number of rows that have it, the most first; a filter with no value has an empty list.
   * An author and a reviewer carry the person (for the avatar), a label its colour, a state its look, an agent its app.
   */
  function menuValues(rows, pullsOf) {
    const found = Object.fromEntries(KEYS.map((key) => [key, new Map()]));
    for (const row of rows) {
      const pulls = pullsOf(row);
      const seen = new Set();
      const add = (key, value, extra) => {
        const id = value.toLowerCase();
        if (seen.has(`${key}:${id}`)) return; // a row counts once for each value
        seen.add(`${key}:${id}`);
        const one = found[key].get(id) ?? { value, count: 0, ...extra };
        one.count += 1;
        found[key].set(id, one);
      };
      for (const pull of pulls) {
        if (pull.author) add('author', pull.author.login, { person: pull.author });
        for (const one of pull.reviewers ?? []) add('reviewer', one.person.login, { person: one.person });
        for (const one of pull.labels ?? []) add('label', one.name, { color: one.color });
        add('state', pull.state, { look: pull.look });
      }
      if (!pulls.length) add('state', NO_PULL, {});
      if (row.agent) add('agent', agentWords(row.agent)[0], { agent: row.agent });
    }
    return Object.fromEntries(KEYS.map((key) => [key, [...found[key].values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))]));
  }

  return { KEYS, SORTS, DEFAULT, NO_PULL, parse, active, defaultSort, isOn, toggle, match, modifiedOf, createdOf, sortRows, menuValues };
})();

if (typeof module === 'object') module.exports = Search; // for the tests in Node
