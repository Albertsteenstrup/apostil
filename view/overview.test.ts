// Tests for the places of the cards of the overview (build 84, placeCards in media/overview.js): no hole in the block, no card narrower than its
// content, no card of files more than one unit taller than its rows need, a drawing card only at a size that its drawing fills, the first card at the
// top left, and the reading order kept where it can be. Given sizes; no browser.

import assert from 'node:assert/strict';
import { test } from 'node:test';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { placeCards, drawingUnits, fillOf } = require('../../view/media/overview.js');

type Place = { x: number; y: number; w: number; h: number };
/** What a card needs (Overview.sizeOf): a card of files with `most`, the most units it may have down; a drawing card with the other sizes it fills. */
type Card = { w: number; h: number; files?: boolean; most?: number; fits?: [number, number][] };

/**
 * The holes of the block: a cell that no card covers with a card under it in its column (the room under the bottom edge of a column is not a hole),
 * and the cells that two cards cover.
 */
function holes(places: Place[], columns: number): { empty: string[]; twice: string[] } {
  const bottom = Math.max(...places.map((one) => one.y + one.h));
  const over = (x: number, y: number): number => places.filter((one) => x >= one.x && x < one.x + one.w && y >= one.y && y < one.y + one.h).length;
  const empty: string[] = [];
  const twice: string[] = [];
  for (let x = 0; x < columns; x++) {
    let lowest = -1;
    for (let y = 0; y < bottom; y++) {
      if (over(x, y) > 1) twice.push(`${x},${y}`);
      if (over(x, y)) lowest = y;
    }
    for (let y = 0; y < lowest; y++) if (!over(x, y)) empty.push(`${x},${y}`);
  }
  return { empty, twice };
}

/** The cells under the bottom edge of the block that no card covers (0 when the block ends flush). */
function uneven(places: Place[]): number {
  const right = Math.max(...places.map((one) => one.x + one.w));
  const bottom = Math.max(...places.map((one) => one.y + one.h));
  const ends = Array.from({ length: right }, (_, x) => Math.max(0, ...places.filter((one) => x >= one.x && x < one.x + one.w).map((one) => one.y + one.h)));
  return ends.reduce((sum, end) => sum + bottom - end, 0);
}

/** What is wrong with the size of each card: narrower than its content, a card of files too tall, a drawing card at a size it does not fill. */
function sizes(cards: Card[], places: Place[], columns: number): string[] {
  return places.flatMap((place, at) => {
    const card = cards[at];
    const wrong: string[] = [];
    if (place.w < Math.min(card.w, columns, 3) || place.w > 3 || place.h < 1 || place.h > 3 || place.x < 0 || place.x + place.w > columns) wrong.push(`${at} out of its limits`);
    if (card.files && place.h > (card.most ?? card.h + 1)) wrong.push(`${at}: files ${place.h} high, at most ${card.most}`);
    if (!card.files && !(place.w === Math.min(card.w, columns) && place.h === card.h) && !card.fits?.some(([w, h]) => w === place.w && h === place.h)) wrong.push(`${at}: drawing ${place.w}x${place.h}`);
    return wrong;
  });
}

test('cards of the same size of build 83 stand in rows, in their order, with the first at the top left', () => {
  const places: Place[] = placeCards(Array.from({ length: 10 }, () => ({ w: 2, h: 2 })), 10);
  assert.deepEqual(places.slice(0, 6), [{ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 }, { x: 4, y: 0, w: 2, h: 2 }, { x: 6, y: 0, w: 2, h: 2 }, { x: 8, y: 0, w: 2, h: 2 }, { x: 0, y: 2, w: 2, h: 2 }]);
  assert.deepEqual(holes(places, 10), { empty: [], twice: [] });
  assert.equal(uneven(places), 0);
});

test('a card of files is never more than one unit taller than its rows need, and never narrower than its file names: a drawing card grows or a later card moves up instead', () => {
  // 8 columns: two tall drawings that may grow, a card of 3 rows (1 unit, at most 2), a card of long names (3 units across), and small cards after them.
  const cards: Card[] = [
    { w: 2, h: 3, fits: [[3, 3]] }, { w: 3, h: 1, files: true, most: 2 }, { w: 2, h: 2, fits: [[2, 3], [3, 3]] }, { w: 3, h: 2, files: true, most: 3 },
    { w: 1, h: 1, files: true, most: 2 }, { w: 2, h: 1, files: true, most: 2 }, { w: 2, h: 2, fits: [[3, 2]] },
  ];
  const places: Place[] = placeCards(cards, 8);
  assert.deepEqual(places[0], { x: 0, y: 0, w: 2, h: 3 }); // the first card at the top left
  assert.deepEqual(holes(places, 8), { empty: [], twice: [] });
  assert.deepEqual(sizes(cards, places, 8), []);
  assert.ok(places[1].h <= 2 && places[3].w === 3, JSON.stringify(places));
  // The order of reading: each card starts at or after the start of the one before it, unless it closed a place further up.
  const starts = places.map((one) => one.y * 8 + one.x);
  assert.ok(starts.filter((start, at) => at > 0 && start < starts[at - 1]).length <= 2, JSON.stringify(places));
  // A last card alone in its row: the drawing above grows down to meet it, so the block ends flush.
  const alone: Card[] = [{ w: 2, h: 2, fits: [[2, 3]] }, { w: 2, h: 2, fits: [[2, 3]] }, { w: 2, h: 2 }, { w: 2, h: 2 }, { w: 2, h: 1, files: true, most: 2 }];
  const below: Place[] = placeCards(alone, 4);
  assert.deepEqual(holes(below, 4), { empty: [], twice: [] });
  assert.deepEqual(sizes(alone, below, 4), []);
  assert.equal(uneven(below), 0, JSON.stringify(below));
});

test('many made-up sets of cards on grids from 4 to 12 units wide: never a hole, never two cards on one cell, no card narrower than its content, no card of files more than one unit taller than its rows need, a drawing card only at a size that its drawing fills', () => {
  let seed = 84;
  const random = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const made = (): Card => {
    if (random() < 0.5) {
      const h = 1 + Math.floor(random() * 3);
      return { w: 1 + Math.floor(random() * 3), h, files: true, most: Math.min(3, h + (random() < 0.6 ? 1 : 0)) };
    }
    const shape = { nodes: 2 + Math.floor(random() * 12), ratio: 0.4 * Math.pow(10, random()) };
    const own = drawingUnits(shape);
    const fits: [number, number][] = [];
    for (let w = own.w; w <= 3; w++) for (let h = Math.max(shape.nodes <= 3 ? 1 : 2, own.h - 1); h <= 3; h++) if (fillOf(shape.ratio, w, h, 125, 26) >= 0.7) fits.push([w, h]);
    return { ...own, fits };
  };
  for (let round = 0; round < 1500; round++) {
    const columns = 4 + Math.floor(random() * 9);
    const cards: Card[] = Array.from({ length: 1 + Math.floor(random() * 16) }, made);
    const places: Place[] = placeCards(cards, columns);
    const said = `${columns} columns, cards ${JSON.stringify(cards)}: ${JSON.stringify(places)}`;
    assert.deepEqual(holes(places, columns), { empty: [], twice: [] }, said);
    assert.deepEqual(sizes(cards, places, columns), [], said);
    assert.deepEqual([places[0].x, places[0].y], [0, 0], said);
  }
});

test('the size of a card with a drawing follows its shape: a wide drawing more units across, a tall one more down, many nodes larger than three; a tall drawing does not fill a wide low card', () => {
  const wide = drawingUnits({ nodes: 3, ratio: 4 });
  const tall = drawingUnits({ nodes: 3, ratio: 0.4 });
  assert.ok(wide.w > wide.h && tall.h > tall.w, JSON.stringify({ wide, tall }));
  const many = drawingUnits({ nodes: 14, ratio: 1.3 });
  assert.ok(many.w * many.h > 4, JSON.stringify(many));
  assert.ok(fillOf(0.6, 3, 2, 125, 26) < 0.7 && fillOf(0.6, 2, 3, 125, 26) >= 0.7);
});
