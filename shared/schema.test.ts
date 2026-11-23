// Tests for a schema diagram: its tables and relations as things with code, what the change did to them, the sum line, and the checks of the save.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shapeProblems, type Diagram } from './change-file';
import { beforeProblems, diagramChange } from './diagram-change';
import { missingCode, thingCounts, thingsOf, thingWords, type FileChange } from './diagram-code';
import { diagramGraph, kindOfText } from './diagram-graph';
import { columnTotals, parseSchema, schemaDrawing } from './schema';
import { partDiagram } from './page-data';

// A made-up shop. The migration (db/0004_orders.sql) adds the table order_line, drops coupon, and changes the type of order.total.
const now = `erDiagram
  shop_order {
    integer id PK
    integer customer_id FK
    numeric total
    text note
  }
  order_line {
    integer id PK
    integer order_id FK
    integer qty
  }
  customer {
    integer id PK
  }
  order_line }o--|| shop_order : order_id
  shop_order }o--|| customer : customer_id`;
const before = `erDiagram
  shop_order {
    integer id PK
    integer customer_id FK
    integer total
    integer coupon_id FK
  }
  customer {
    integer id PK
  }
  coupon {
    integer id PK
    text code
  }
  shop_order }o--|| customer : customer_id
  shop_order }o--o| coupon : coupon_id`;

const shop = (more: Partial<Diagram> = {}): Diagram => ({
  id: 'shop-schema', kind: 'schema', title: 'The tables of the shop', part: 'db', file: 'db/0004_orders.sql', mermaid: now, before,
  nodeLines: { shop_order: [[20, 24], { file: 'db/0001_init.sql', lines: [3, 8] }], order_line: [1, 6], customer: 'outside', coupon: [10, 10] },
  edgeLines: [
    { from: 'order_line', to: 'shop_order', label: 'order_id', lines: [3, 3] },
    { from: 'shop_order', to: 'customer', label: 'customer_id', lines: { file: 'db/0001_init.sql', lines: [5, 5] } },
    { from: 'shop_order', to: 'coupon', label: 'coupon_id', lines: [22, 22] },
  ],
  ...more,
});

/** The migration: lines 1 to 24 are new (the table order_line, the drop of coupon, the change of shop_order); the older file is not changed. */
const migration: FileChange = { length: 24, added: [[1, 24]], removed: [], totals: { added: 24, removed: 0 } };
const old: FileChange = { length: 12, added: [], removed: [], totals: { added: 0, removed: 0 } };
const fileChange = (path: string): FileChange => (path === 'db/0004_orders.sql' ? migration : old);

test('a schema diagram: the Mermaid text with tables, columns and keys, an added table, a removed table through "before", an altered column, a relation, a context table, and the sum line', () => {
  assert.equal(kindOfText(now), 'schema');
  const { tables, relations } = parseSchema(`${now}\n  report }o--|| shop_order : ""\n  report {\n    text day\n  }`);
  assert.deepEqual(tables.map((table) => table.name), ['shop_order', 'order_line', 'customer', 'report']);
  assert.deepEqual(tables[0].columns[1], { name: 'customer_id', type: 'integer', keys: ['FK'] });
  assert.deepEqual(relations.at(-1), { from: 'report', to: 'shop_order' }); // a model that reads another model as a whole: no column at its end
  const graph = diagramGraph({ kind: 'schema', mermaid: now });
  assert.deepEqual(Object.keys(graph.nodes), ['shop_order', 'order_line', 'customer']);
  assert.deepEqual(graph.edges, [{ from: 'order_line', to: 'shop_order', label: 'order_id' }, { from: 'shop_order', to: 'customer', label: 'customer_id' }]);
  assert.deepEqual(parseSchema('erDiagram\n  model_a ||--|| model_b : "uses the table"\n  model_c').tables.map((table) => table.name), ['model_a', 'model_b', 'model_c']);

  // A schema diagram: an added table, a removed table through "before", an altered column, a relation, and the sum line.
  const diagram = shop();
  const { things, stray } = thingsOf(diagram);
  assert.deepEqual(stray, []);
  assert.deepEqual(things.map((thing) => `${thing.key}${thing.removed ? ' removed' : ''}`), ['shop_order', 'order_line', 'customer', 'coupon removed', 'edge:0', 'edge:1', 'gone:1 removed']);
  const counts = thingCounts(things, fileChange);
  const change = diagramChange(diagram, { counts })!;
  assert.deepEqual(change.nodes, { shop_order: 'changed', order_line: 'new', coupon: 'removed' });
  assert.deepEqual(change.edges.map((edge) => `${edge.from}>${edge.to}:${edge.change ?? ''}`), ['order_line>shop_order:new', 'shop_order>customer:', 'shop_order>coupon:removed']);
  assert.deepEqual(columnTotals(diagram), { new: 1, removed: 1, changed: 1 });
  assert.deepEqual(change.words, [
    [{ text: '+1 table', tone: 'p' }, { text: '−1 table', tone: 'm' }], [{ text: '+1 relation', tone: 'p' }, { text: '−1 relation', tone: 'm' }],
    [{ text: '+1 column', tone: 'p' }, { text: '−1 column', tone: 'm' }], [{ text: '2 changed', tone: '' }],
  ]);
  const drawing = schemaDrawing(diagram, change);
  assert.deepEqual(drawing.tables.map((table) => `${table.name}:${table.change ?? ''}`), ['shop_order:changed', 'order_line:new', 'customer:', 'coupon:removed']);
  assert.deepEqual(drawing.tables[0].columns.map((column) => `${column.name}:${column.change ?? ''}${column.was ? `:${column.was}` : ''}`), ['id:', 'customer_id:', 'total:changed:integer', 'note:new', 'coupon_id:removed']);
  assert.deepEqual(drawing.tables[1].columns.map((column) => column.change), [undefined, undefined, undefined]); // a new table: its head says it, not each row
  assert.deepEqual(drawing.relations.map((relation) => relation.column), ['order_id', 'customer_id', 'coupon_id']);
  assert.equal(thingWords('schema', things[3]), 'the removed table "coupon"');
  assert.equal(thingWords('schema', things[4]), 'the relation "order_id" from "order_line" to "shop_order"');

  // A context table has the reason "outside" or a place in the file that defines it; a relation from a whole table has no label.
  {
    const diagram = shop({ mermaid: `${now}\n  daily_sales }o--|| shop_order : ""`, nodeLines: { ...shop().nodeLines!, daily_sales: { file: 'models/daily_sales.sql' }, customer: { file: 'db/0001_init.sql', lines: [1, 2] } },
      edgeLines: [...shop().edgeLines!, { from: 'daily_sales', to: 'shop_order', lines: { file: 'models/daily_sales.sql', lines: [4, 4] } }] });
    assert.deepEqual(missingCode(diagram), []);
    const relation = thingsOf(diagram).things.find((thing) => thing.from === 'daily_sales')!;
    assert.deepEqual(relation.code, { places: [{ file: 'models/daily_sales.sql', lines: [4, 4] }] });
    assert.equal(schemaDrawing(diagram).relations.at(-1)!.column, undefined);
    const change = diagramChange(diagram, { counts: thingCounts(thingsOf(diagram).things, fileChange) })!;
    assert.equal(change.nodes.customer, undefined); // a table that the change does not touch is quiet
  }
});

test('a table or a relation with no code and no reason is refused with a sentence that a writer can act on, and "before" must be an entity-relationship diagram that keeps the names of the tables', () => {
  assert.deepEqual(shapeProblems({ format: 1, title: 't', reason: 'r', parts: [{ id: 'db', name: 'DB', files: [] }], links: [], diagrams: [shop()] }), []);
  assert.deepEqual(missingCode(shop()), []); // "coupon" has [10, 10]: the line of now that drops it
  const { customer: _, ...nodeLines } = shop().nodeLines!;
  assert.deepEqual(missingCode(shop({ nodeLines, edgeLines: shop().edgeLines!.slice(1) })), [
    'Diagram "shop-schema": The table "customer" has no code. Give its lines, or a reason: outside, no-line.',
    'Diagram "shop-schema": The relation "order_id" from "order_line" to "shop_order" has no code. Give its lines, or a reason: outside, order, no-line.',
  ]);

  // "before" of a schema must be an entity-relationship diagram that keeps the names of the tables that are still there.
  assert.deepEqual(beforeProblems(shop()), []);
  assert.match(beforeProblems(shop({ before: 'flowchart TD\n  a --> b' }))[0], /entity-relationship diagram \("erDiagram"\), not a flow chart/);
  assert.match(beforeProblems(shop({ before: 'erDiagram\n  coupon {\n    integer id PK\n  }' }))[0], /every table looks new.*Keep the id of each table/);
});

test('the page data of a schema diagram: its tables to draw, the code and diff of each, and the sum beside its title; a diagram of another kind draws from its Mermaid text', () => {
  const page = partDiagram(shop(), { fileChange, text: () => [], fileIsNew: false, checked: false });
  assert.equal(page.draw, now); // the page draws the tables itself, from `schema`
  assert.equal(page.plain, undefined);
  assert.deepEqual(page.code.order_line.counts, { added: 6, removed: 0 });
  assert.deepEqual(page.schema!.tables.find((table) => table.name === 'order_line')!.counts, { added: 6, removed: 0 });
  assert.deepEqual(page.edges.map((edge) => edge.key), ['edge:0', 'edge:1', 'gone:1']);
  assert.equal(page.change!.words[0][0].text, '+1 table');

  // A diagram of another kind has no "schema" field and draws from its Mermaid text.
  {
    const flow: Diagram = { id: 'f', kind: 'flow', title: 'F', file: 'a.py', mermaid: 'flowchart TD\n  a["A"] --> b["B"]', nodeLines: { a: [1, 1], b: [2, 2] } };
    const page = partDiagram(flow, { fileChange, text: () => [], fileIsNew: false, checked: false });
    assert.equal(page.schema, undefined);
    assert.match(page.draw, /^flowchart TD/);
    assert.match(shapeProblems({ format: 1, title: 't', reason: 'r', parts: [{ id: 'p', name: 'P', files: [] }], links: [], diagrams: [{ ...flow, kind: 'tree' as never }] })[0], /flow, sequence, state or schema/);
  }
});

