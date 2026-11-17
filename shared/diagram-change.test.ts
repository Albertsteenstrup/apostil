// Tests for what a change did to a diagram: from the text before, from the code lines of the nodes, and the text with the removed things put back.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Code, Lines } from './change-file';
import { diagramChange, paintOf, withRemoved } from './diagram-change';
import { thingCounts, thingsOf, type FileChange } from './diagram-code';
import { diagramGraph } from './diagram-graph';

const flowBefore = 'flowchart TD\n  load["Load the order"]\n  check{"Paid?"}\n  mail["Send a mail"]\n  done(["Done"])\n  load --> check\n  check -- yes --> mail\n  mail --> done\n  check -- no --> done';
const flowNow = 'flowchart TD\n  load["Load the order"]\n  check{"Paid in full?"}\n  pack["Pack the box"]\n  ship["Ship the box"]\n  done(["Done"])\n  load --> check\n  check -- yes --> pack\n  pack --> ship\n  ship --> done\n  check -- no --> done';

test('a flow chart against its text before: new, changed and removed steps, new and removed arrows, an arrow the same when its ends and label are, and the removed steps put back dashed', () => {
  const change = diagramChange({ kind: 'flow', mermaid: flowNow, before: flowBefore })!;
  assert.deepEqual(change.nodes, { check: 'changed', pack: 'new', ship: 'new', mail: 'removed' });
  assert.deepEqual(change.paint, { check: 'changed', pack: 'add', ship: 'add', mail: 'removed' });
  const flags = change.edges.map((edge) => `${edge.from}>${edge.to}:${edge.change ?? ''}`);
  assert.deepEqual(flags, ['load>check:', 'check>pack:new', 'pack>ship:new', 'ship>done:new', 'check>done:', 'check>mail:removed', 'mail>done:removed']);
  assert.deepEqual(change.words, [[{ text: '+2 steps', tone: 'p' }, { text: '−1 step', tone: 'm' }], [{ text: '1 changed', tone: '' }]]);

  // An arrow is the same arrow when its two ends and its label are the same.
  {
    const change = diagramChange({ kind: 'flow', mermaid: 'flowchart TD\n  a --> b\n  a -- no --> c', before: 'flowchart TD\n  a --> b\n  a -- yes --> c' })!;
    assert.deepEqual(change.edges.map((edge) => edge.change ?? ''), ['', 'new', 'removed']);
    assert.deepEqual(change.nodes, {});
  }

  // The removed steps put back: each removed step with its arrows, dashed, after the text of now.
  const drawn = withRemoved({ kind: 'flow', mermaid: flowNow, before: flowBefore }, change, flowNow)!;
  assert.equal(drawn, `${flowNow}\n  mail["Send a mail"]\n  check -.->|"yes"| mail\n  mail -.-> done`);
  // The drawing writes the arrows in the order of the drawn edges, so the page finds each one.
  assert.deepEqual(diagramGraph({ kind: 'flow', mermaid: drawn }).edges.map((edge) => `${edge.from}>${edge.to}`), change.edges.map((edge) => `${edge.from}>${edge.to}`));
});

test('a sequence against its text before: a new and a removed message, the removed one at its place without its activation mark, and a removed participant after the participants', () => {
  const before = 'sequenceDiagram\n  participant C as Clock\n  participant S as Service\n  C->>+S: tick\n  S->>S: load rows\n  S->>S: mail the owner\n  S-->>-C: counts';
  const now = 'sequenceDiagram\n  participant C as Clock\n  participant S as Service\n  C->>+S: tick\n  S->>S: load rows\n  S->>S: lock rows\n  S-->>-C: counts';
  const change = diagramChange({ kind: 'sequence', mermaid: now, before })!;
  assert.deepEqual(change.edges.map((edge) => `${edge.label}:${edge.change ?? ''}`), ['tick:', 'load rows:', 'mail the owner:removed', 'lock rows:new', 'counts:']);
  assert.deepEqual(change.words, [[{ text: '+1 message', tone: 'p' }, { text: '−1 message', tone: 'm' }]]);
  const drawn = withRemoved({ kind: 'sequence', mermaid: now, before }, change, now)!;
  assert.deepEqual(drawn.split('\n').slice(3), ['  C->>+S: tick', '  S->>S: load rows', '  S->>S: mail the owner', '  S->>S: lock rows', '  S-->>-C: counts']);
  // The drawing writes the messages in the order of the drawn edges.
  assert.deepEqual(diagramGraph({ kind: 'sequence', mermaid: drawn }).edges.map((edge) => edge.label), change.edges.map((edge) => edge.label));

  // A removed message loses its activation mark, and a removed participant comes back after the participants.
  {
    const before = 'sequenceDiagram\n  participant A\n  participant M as Mailer\n  A->>+M: send\n  A->>A: log';
    const now = 'sequenceDiagram\n  participant A\n  A->>A: log';
    const change = diagramChange({ kind: 'sequence', mermaid: now, before })!;
    assert.equal(change.nodes.M, 'removed');
    assert.equal(withRemoved({ kind: 'sequence', mermaid: now, before }, change, now), 'sequenceDiagram\n  participant A\n  participant M as Mailer\n  A->>M: send\n  A->>A: log');
  }
});

test('a state diagram against its text before: a new state, a removed state and a removed transition, a state with another label is changed, and the start and end states are never counted', () => {
  const before = 'stateDiagram-v2\n  [*] --> draft\n  draft --> sent: send\n  sent --> archived: archive\n  sent --> draft: undo';
  const now = 'stateDiagram-v2\n  [*] --> draft\n  draft --> sent: send\n  sent --> read: open';
  const change = diagramChange({ kind: 'state', mermaid: now, before })!;
  assert.deepEqual(change.nodes, { read: 'new', archived: 'removed' });
  assert.deepEqual(change.edges.map((edge) => `${edge.from}>${edge.to}:${edge.change ?? ''}`), ['root_start>draft:', 'draft>sent:', 'sent>read:new', 'sent>archived:removed', 'sent>draft:removed']);
  assert.deepEqual(change.words, [[{ text: '+1 state', tone: 'p' }, { text: '−1 state', tone: 'm' }], [{ text: '+1 transition', tone: 'p' }, { text: '−2 transitions', tone: 'm' }]]);
  assert.equal(withRemoved({ kind: 'state', mermaid: now, before }, change, now), `${now}\n  sent --> archived: archive\n  sent --> draft: undo`);

  // A state that keeps its id and gets another label is changed; the start and end states are never counted.
  {
    const change = diagramChange({ kind: 'state', mermaid: 'stateDiagram-v2\n  state "Waiting for the owner" as wait\n  [*] --> wait\n  wait --> [*]', before: 'stateDiagram-v2\n  state "Waiting" as wait\n  wait --> [*]' })!;
    assert.deepEqual(change.nodes, { wait: 'changed' });
    assert.deepEqual(change.words, [[{ text: '+1 transition', tone: 'p' }], [{ text: '1 changed', tone: '' }]]);
  }
});


/** One file with added lines and removed lines; the removed line i stands before the line removedAt[i] and was line 1000 + i. */
const oneFile = (added: [number, number][], removedAt: number[], length = 100): FileChange =>
  ({ length, added, removed: removedAt.map((at, index) => ({ at, line: 1000 + index, text: '' })), totals: { added: 0, removed: 0 } });
const countsOf = (diagram: Parameters<typeof thingsOf>[0], file: FileChange) => thingCounts(thingsOf(diagram).things, () => file);

test('the counts of a thing come from its places: added lines inside it, removed lines that stood there, the sum over a second file and a whole file, and a removed transition counts its removed lines', () => {
  const diagram = { kind: 'flow' as const, file: 'x.py', mermaid: 'flowchart TD\n  a --> b\n  b --> c\n  c --> d', nodeLines: { a: [10, 14] as Lines, b: [20, 22] as Lines, c: [30, 31] as Lines } };
  const counts = countsOf(diagram, oneFile([[12, 13], [20, 22]], [11, 25, 31]));
  assert.deepEqual([counts.a, counts.b, counts.c], [{ lines: 5, added: 2, removed: 1 }, { lines: 3, added: 3, removed: 0 }, { lines: 2, added: 0, removed: 1 }]);
  const change = diagramChange(diagram, { counts })!;
  assert.deepEqual(change.nodes, { a: 'changed', b: 'new', c: 'changed' });
  assert.deepEqual(change.counts, { a: { added: 2, removed: 1 }, b: { added: 3, removed: 0 }, c: { added: 0, removed: 1 } });
  assert.deepEqual(change.paint, { a: 'both', b: 'add', c: 'del' });
  assert.deepEqual(change.edges.map((edge) => edge.change), [undefined, undefined, undefined]); // arrows with no text only say what comes next
  assert.equal(withRemoved({ kind: 'flow', mermaid: 'flowchart TD\n  a --> b' }, change, 'x'), undefined); // only "before" can say "removed"

  // The diff of a thing is the sum over its places, also in a second file and for a whole file.
  {
    const diagram = {
      kind: 'sequence' as const, file: 'shop.py', mermaid: 'sequenceDiagram\n  participant S as Shop\n  participant T as Table\n  S->>T: lock',
      nodeLines: { T: { file: 'db/table.sql' } },
      edgeLines: [{ from: 'S', to: 'T', label: 'lock', lines: [[3, 4], { file: 'db/table.sql', lines: [7, 8] }] as Code }],
    };
    const files: Record<string, FileChange> = {
      'shop.py': oneFile([[4, 4]], [3]),
      'db/table.sql': { length: 20, added: [[1, 20]], removed: [], totals: { added: 20, removed: 0 } },
    };
    const counts = thingCounts(thingsOf(diagram).things, (path) => files[path]);
    assert.deepEqual(counts['edge:0'], { lines: 4, added: 3, removed: 1 });
    assert.deepEqual(counts.T, { lines: 20, added: 20, removed: 0 });
  }

  // A removed transition counts its removed lines, and they no longer count on the thing that stands there now.
  {
    const before = 'stateDiagram-v2\n  open --> paid: pay\n  paid --> open: refund\n  paid --> held: dispute';
    const now = 'stateDiagram-v2\n  open --> paid: pay\n  paid --> held: dispute';
    // The change removed old lines 1000 (the refund) and 1001 (a line of the dispute); both stood before line 20 of the file now.
    const diagram = {
      kind: 'state' as const, file: 'order.py', mermaid: now, before,
      edgeLines: [
        { from: 'open', to: 'paid', lines: [10, 12] as Code },
        { from: 'paid', to: 'held', lines: [19, 21] as Code },
        { from: 'paid', to: 'open', label: 'refund', lines: { lines: [1000, 1000], removed: true } as Code },
      ],
      nodeLines: { open: 'no-line', paid: 'no-line', held: 'no-line' } as Record<string, Code>,
    };
    const counts = countsOf(diagram, oneFile([[21, 21]], [20, 20]));
    const change = diagramChange(diagram, { counts })!;
    const dispute = change.edges.find((edge) => edge.label === 'dispute')!;
    const refund = change.edges.find((edge) => edge.label === 'refund')!;
    assert.deepEqual([dispute.counts, refund.counts, refund.change, refund.key], [{ added: 1, removed: 1 }, { added: 0, removed: 1 }, 'removed', 'gone:1']);
  }
});

test('what is new and its colour: new wins over changed, the colour comes from the counts, a diagram of new things or of a new file is new in each step, and a diagram with no "before" and no code lines says nothing', () => {
  const change = diagramChange({ kind: 'flow', mermaid: 'flowchart TD\n  a["One"] --> b["Two"]', before: 'flowchart TD\n  a["One"] --> b["Old two"]' }, { counts: { a: { lines: 2, added: 2, removed: 0 } } })!;
  assert.deepEqual(change.nodes, { a: 'new', b: 'changed' });

  // The colour of a thing comes from its counts: added only green, removed only red, both, and none from "before" alone.
  assert.equal(paintOf('changed', { added: 3, removed: 0 }), 'add');
  assert.equal(paintOf('changed', { added: 0, removed: 2 }), 'del');
  assert.equal(paintOf('changed', { added: 1, removed: 1 }), 'both');
  assert.equal(paintOf('changed', { added: 0, removed: 0 }), 'changed'); // the same id, another label, no lines: the green border
  assert.equal(paintOf('changed'), 'changed');
  assert.equal(paintOf('new'), 'add');
  assert.equal(paintOf('removed', { added: 2, removed: 0 }), 'removed');
  assert.equal(paintOf(undefined), undefined);

  // A diagram whose every judged node is new paints each of them and counts them as any diagram does.
  {
    const change = diagramChange({ kind: 'flow', mermaid: 'flowchart TD\n  a --> b\n  b --> c' }, { counts: { a: { lines: 3, added: 3, removed: 0 }, c: { lines: 1, added: 1, removed: 0 } } })!;
    assert.deepEqual(change.nodes, { a: 'new', c: 'new' });
    assert.deepEqual(change.paint, { a: 'add', c: 'add' });
    assert.deepEqual(change.words, [[{ text: '+2 steps', tone: 'p' }]]);
    assert.ok(change.edges.every((edge) => !edge.change));
  }

  // A flow chart of a file that the change added is new in each step, also a step with no code lines.
  {
    const change = diagramChange({ kind: 'flow', mermaid: 'flowchart TD\n  a --> b{"Ok?"}\n  b -- yes --> c' }, { counts: { a: { lines: 2, added: 2, removed: 0 } }, fileIsNew: true })!;
    assert.deepEqual(change.paint, { a: 'add', b: 'add', c: 'add' });
    assert.deepEqual(change.counts, { a: { added: 2, removed: 0 } });
    assert.deepEqual(change.words, [[{ text: '+3 steps', tone: 'p' }]]);
    // A sequence or a state diagram of a new file is judged by its lines only: its participants and states may live elsewhere.
    assert.equal(diagramChange({ kind: 'state', mermaid: 'stateDiagram-v2\n  [*] --> a' }, { fileIsNew: true }), undefined);
  }

  // A diagram with no "before" and no code lines says nothing about the change, as an old change file.
  assert.equal(diagramChange({ kind: 'flow', mermaid: flowNow }), undefined);
  assert.equal(diagramChange({ kind: 'state', mermaid: 'stateDiagram-v2\n  [*] --> a' }), undefined);
  assert.equal(diagramChange({ kind: 'flow', mermaid: flowNow, before: flowNow }), undefined); // the same text: nothing changed
});

test('a transition or a message with code lines: added lines make it new, removed lines red, both green and red, none leaves it alone, and "before" still says what is new', () => {
  const mermaid = 'stateDiagram-v2\n  [*] --> open\n  open --> paid: pay\n  open --> gone: cancel\n  paid --> open: refund\n  paid --> done: ship';
  const edgeLines = [
    { from: 'open', to: 'paid', label: 'pay', lines: [10, 11] as Code },
    { from: 'open', to: 'gone', lines: [14, 15] as Code },
    { from: 'paid', to: 'open', label: 'refund', lines: [20, 22] as Code },
    { from: 'paid', to: 'done', label: 'ship', lines: [30, 30] as Code },
  ];
  const counts = countsOf({ kind: 'state', file: 'x.py', mermaid, edgeLines }, oneFile([[10, 11], [21, 21]], [15, 22]));
  assert.deepEqual(['edge:1', 'edge:2', 'edge:3', 'edge:4'].map((key) => [counts[key].added, counts[key].removed]), [[2, 0], [0, 1], [1, 1], [0, 0]]);
  const change = diagramChange({ kind: 'state', mermaid }, { counts })!;
  assert.deepEqual(change.edges.map((edge) => `${edge.label ?? ''}:${edge.change ?? ''}:${edge.paint ?? ''}`), ['::', 'pay:new:add', 'cancel:changed:del', 'refund:changed:both', 'ship::']);
  assert.deepEqual(change.edges[3].counts, { added: 1, removed: 1 });
  assert.deepEqual(change.nodes, {});
  assert.deepEqual(change.words, [[{ text: '+1 transition', tone: 'p' }], [{ text: '2 changed', tone: '' }]]);

  // A message with code lines shows its diff, and "before" still says what is new.
  {
    const before = 'sequenceDiagram\n  participant S as Shop\n  participant T as Table\n  S->>T: load\n  T-->>S: rows';
    const now = 'sequenceDiagram\n  participant S as Shop\n  participant T as Table\n  S->>T: load\n  S->>T: lock\n  T-->>S: rows';
    const edgeLines = [{ from: 'S', to: 'T', label: 'load', lines: [5, 6] as Code }, { from: 'S', to: 'T', label: 'lock', lines: [8, 8] as Code }];
    const counts = countsOf({ kind: 'sequence', file: 'x.py', mermaid: now, before, edgeLines }, oneFile([[6, 6]], [8]));
    const change = diagramChange({ kind: 'sequence', mermaid: now, before }, { counts })!;
    assert.deepEqual(change.edges.map((edge) => `${edge.label}:${edge.change ?? ''}:${edge.paint ?? ''}`), ['load:changed:add', 'lock:new:del', 'rows::']);
  }
});



