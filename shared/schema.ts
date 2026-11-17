// A schema diagram: the tables of a database with their columns, and the relations between them, as Mermaid text of an entity-relationship diagram.
// A table is a node and a relation is an arrow, so a schema diagram has its code, its counts and its checks as the other kinds have them.

import type { DiagramChange, DrawnEdge, ThingChange } from './diagram-change';

export interface Column {
  name: string;
  type: string;
  keys: string[]; // "PK", "FK", "UK"
}

export interface Table {
  name: string;
  columns: Column[];
}

/** A relation from a table to the table that it points at. `label` is its text: the column of `from` when the code names one. */
export interface Relation {
  from: string;
  to: string;
  label?: string;
}

const NAME = '[A-Za-z_][\\w-]*';
const BLOCK = new RegExp(`^\\s*(${NAME})\\s*\\{\\s*(\\})?\\s*$`);
const BARE = new RegExp(`^\\s*(${NAME})\\s*$`);
const ATTRIBUTE = /^\s*([A-Za-z_][\w\-[\]().,]*)\s+([A-Za-z_*][\w-]*)\s*((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*)?\s*(?:"[^"]*")?\s*$/;
const RELATION = new RegExp(`^\\s*(${NAME})\\s*([|}o]{2})(?:--|\\.\\.)([|{o]{2})\\s*(${NAME})\\s*(?::\\s*(.*?))?\\s*$`);

/** Reads the tables and relations of the Mermaid text of an entity-relationship diagram ("erDiagram"). A table named only in a relation has no columns. */
export function parseSchema(mermaid: string): { tables: Table[]; relations: Relation[] } {
  const tables = new Map<string, Table>();
  const relations: Relation[] = [];
  const table = (name: string): Table => {
    if (!tables.has(name)) tables.set(name, { name, columns: [] });
    return tables.get(name)!;
  };
  let open: Table | undefined;
  mermaid.split('\n').forEach((line, at) => {
    if (at === 0 && /^\s*erDiagram\b/.test(line)) return;
    if (!line.trim() || /^\s*(%%|direction\b|title\b)/.test(line)) return;
    if (open) {
      if (/^\s*\}\s*$/.test(line)) { open = undefined; return; }
      const column = ATTRIBUTE.exec(line);
      if (column) open.columns.push({ name: column[2], type: column[1], keys: column[3] ? column[3].split(',').map((key) => key.trim()) : [] });
      return;
    }
    const block = BLOCK.exec(line);
    if (block) { const found = table(block[1]); if (!block[2]) open = found; return; }
    const relation = RELATION.exec(line);
    if (relation) {
      table(relation[1]);
      table(relation[4]);
      const label = (relation[5] ?? '').replace(/^"([\s\S]*)"$/, '$1').trim();
      relations.push({ from: relation[1], to: relation[4], ...(label ? { label } : {}) });
      return;
    }
    const bare = BARE.exec(line);
    if (bare) table(bare[1]);
  });
  return { tables: [...tables.values()], relations };
}

/** The column at the start of a relation: its label, when the table has a column of that name. A relation with none goes from the table as a whole. */
export const relationColumn = (table: Table | undefined, label?: string): string | undefined =>
  (label && table?.columns.some((column) => column.name === label) ? label : undefined);

// ----- what the page draws -----

export type ColumnChange = 'new' | 'removed' | 'changed';

export interface DrawnColumn extends Column {
  change?: ColumnChange; // known from "before" only, in a table that was there before
  was?: string; // the type before, for a column whose type changed
}

export interface DrawnTable {
  name: string;
  columns: DrawnColumn[];
  change?: ThingChange;
  counts?: { added: number; removed: number };
}

export type DrawnRelation = DrawnEdge & { column?: string };

/** The schema as the page draws it: the tables of now and the removed ones, each with its columns, and the relations of the drawing in its order. */
export interface SchemaDrawing {
  tables: DrawnTable[];
  relations: DrawnRelation[];
}

/** The columns of a table now, marked by what "before" says: new, changed, and the removed ones at the end. A table that is not in "before" has no marks. */
function markedColumns(now: Table | undefined, before: Table | undefined): DrawnColumn[] {
  if (!now) return before?.columns ?? [];
  if (!before) return now.columns;
  const old = new Map(before.columns.map((column) => [column.name, column]));
  const marked = now.columns.map((column): DrawnColumn => {
    const was = old.get(column.name);
    if (!was) return { ...column, change: 'new' };
    if (was.type !== column.type) return { ...column, change: 'changed', was: was.type };
    return was.keys.join() !== column.keys.join() ? { ...column, change: 'changed' } : column;
  });
  const names = new Set(now.columns.map((column) => column.name));
  return [...marked, ...before.columns.filter((column) => !names.has(column.name)).map((column) => ({ ...column, change: 'removed' as const }))];
}

/** The tables and relations of a schema diagram as the page draws them, with what the change did to each (shared/diagram-change.ts). */
export function schemaDrawing(diagram: { mermaid: string; before?: string }, change?: DiagramChange): SchemaDrawing {
  const now = parseSchema(diagram.mermaid);
  const before = diagram.before ? parseSchema(diagram.before) : undefined;
  const nowNames = new Set(now.tables.map((table) => table.name));
  const all = [...now.tables, ...(before?.tables.filter((table) => !nowNames.has(table.name)) ?? [])];
  const tables = all.map((table): DrawnTable => {
    const columns = markedColumns(now.tables.find((one) => one.name === table.name), before?.tables.find((one) => one.name === table.name));
    const thing = change?.nodes[table.name];
    const counts = change?.counts[table.name];
    return { name: table.name, columns, ...(thing ? { change: thing } : {}), ...(counts ? { counts } : {}) };
  });
  const edges: DrawnEdge[] = change?.edges ?? now.relations.map((relation, at) => ({ ...relation, key: `edge:${at}` }));
  const relations = edges.map((edge): DrawnRelation => {
    const column = relationColumn(tables.find((table) => table.name === edge.from), edge.label);
    return { ...edge, ...(column ? { column } : {}) };
  });
  return { tables, relations };
}

/** The columns that a change added, removed and changed in the tables that were there before and are still there. */
export function columnTotals(diagram: { mermaid: string; before?: string }): Record<ColumnChange, number> {
  const totals = { new: 0, removed: 0, changed: 0 };
  if (!diagram.before) return totals;
  const before = parseSchema(diagram.before).tables;
  for (const table of parseSchema(diagram.mermaid).tables) {
    for (const column of markedColumns(table, before.find((one) => one.name === table.name))) if (column.change) totals[column.change]++;
  }
  return totals;
}
