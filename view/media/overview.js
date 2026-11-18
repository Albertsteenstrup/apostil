// The overview of a diagram (build 83), on Home and on "Diagram" of a change: the diagram of a level large on top, and under it one card for each
// node that leads somewhere, its own diagram drawn small or its files. A quiet icon at the top right of the frame shows the diagram alone, filling the
// tab; that choice holds for every diagram on every page until he picks the overview again with the same icon.
'use strict';

const FULL_KEY = 'apostil.diagramFull'; // as a file in a browser, the storage of the browser stands in for the state of VS Code
const GROW = 1.4; // in the overview a small diagram is drawn up to this much larger, so that it fills the width
const OVERVIEW_SHARE = 0.58; // the share of the height of the tab that the diagram takes, so that the cards show under it
const OVERVIEW_MOST = 0.85; // the share that it takes at most, for a drawing that would be smaller than its own size in the share above
const OVERVIEW_LEAST = 220; // the least height of its frame
const OVERVIEW_ROOM = 24; // the room between the drawing and each edge of its frame

const Overview = {
  full: null, // his choice from VS Code: the diagram alone (true) or the overview (false); null until VS Code sends it

  /** True when he chose the diagram alone. */
  isFull() {
    if (this.full !== null) return this.full;
    try { return localStorage.getItem(FULL_KEY) === '1'; } catch { return false; }
  },

  /** He picks the other form. VS Code keeps it for every page and window; as a file in a browser, the storage of the browser keeps it. */
  choose(full, redraw) {
    this.full = full;
    tell({ type: 'layout', full });
    if (!vscodeApi) try { localStorage.setItem(FULL_KEY, full ? '1' : '0'); } catch { /* no storage: the choice lasts while the page is open */ }
    redraw();
  },

  /** VS Code says what he chose, with the data or after he chose on another page. True when it differs from what the page shows. */
  heard(full) {
    if (typeof full !== 'boolean' || full === this.full) return false;
    this.full = full;
    return true;
  },

  /** The quiet icon at the top right of the frame: "Full screen" in the overview, "Overview" in full screen. */
  icon(frame, full, redraw) {
    frame.querySelector(':scope > .ovt')?.remove();
    const icon = html(`<a class="ovt ${full ? 'shrink' : 'grow'}" role="button" title="${full ? 'Overview' : 'Full screen'}" aria-label="${full ? 'Overview' : 'Full screen'}"></a>`);
    icon.addEventListener('click', (event) => { event.stopPropagation(); this.choose(!full, redraw); });
    frame.append(icon);
  },

  /** Drawn nodes in the reading order of the drawing: top to bottom, then left to right. Nodes whose middles lie within half a node apart stand in one row. */
  inReadingOrder(nodes) {
    const rows = [];
    const boxes = nodes.map((g) => ({ g, box: g.getBoundingClientRect() })).sort((a, b) => (a.box.top + a.box.bottom) - (b.box.top + b.box.bottom));
    for (const one of boxes) {
      const middle = (one.box.top + one.box.bottom) / 2;
      const row = rows.at(-1);
      if (row && Math.abs(middle - row.middle) <= Math.max(one.box.height, row.height) / 2) row.items.push(one);
      else rows.push({ middle, height: one.box.height, items: [one] });
    }
    return rows.flatMap((row) => row.items.sort((a, b) => a.box.left - b.box.left).map((one) => one.g));
  },

  /**
   * The cards under the diagram, into `holder`: one for each item, in its order. An item is { title, draw(box), open() } for a node with a diagram of
   * its own, drawn small and read only, or { title, files: [{ path, line?, folder?, count?, counts? }] } for a node that leads to files. A card is
   * filled when it comes into view, so a level with many nodes opens at once. A click on a card with a diagram goes one level down (open); a click on
   * a file row does what the page does for that row.
   */
  cards(holder, items) {
    holder.innerHTML = items.map((item, at) => `<div class="ovc${item.open ? ' go' : ''}" data-card="${at}"><div class="ovh" title="${esc(item.title)}">${esc(item.title)}</div><div class="ovb"></div></div>`).join('');
    holder.hidden = !items.length;
    const fill = async (card) => {
      const item = items[Number(card.dataset.card)];
      const body = card.querySelector('.ovb');
      if (item.files) body.innerHTML = `<div class="ovf">${item.files.map(fileRowHtml).join('')}</div>`;
      else await item.draw(body);
      card.dataset.drawn = '';
    };
    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries.filter((one) => one.isIntersecting)) {
        seen.unobserve(entry.target);
        fill(entry.target).catch((error) => console.error(error));
      }
    }, { rootMargin: '200px' });
    for (const card of holder.querySelectorAll('.ovc')) {
      seen.observe(card);
      const item = items[Number(card.dataset.card)];
      if (item.open) card.addEventListener('click', (event) => { if (!event.target.closest('[data-open], [data-tree], [data-open-file]')) item.open(event); });
    }
  },
};

/**
 * One file row of a card: the folder quiet before the name, cut at its left end, then its count or its counts. A folder of the map opens in the tree
 * "Files" and a file of the map in VS Code (data-tree, data-open, at its line); a file of a change opens its file tab (data-open-file).
 */
function fileRowHtml(file) {
  const folder = file.path.endsWith('/');
  const name = folder ? `${baseName(file.path.slice(0, -1))}/` : baseName(file.path);
  const at = folder ? folderOf(file.path.slice(0, -1)) : folderOf(file.path);
  const attrs = file.counts !== undefined ? `data-open-file="${esc(file.path)}"`
    : folder ? `data-tree="${esc(file.path)}"` : `data-open="${esc(file.path)}"${file.line ? ` data-line="${file.line}"` : ''}`;
  const count = file.counts !== undefined ? countsHtml(file.counts) : folder && file.count ? plural(file.count, 'file') : '';
  return `<a ${attrs} title="${esc(file.path)}"><span class="dir"><bdi dir="ltr">${esc(at)}</bdi></span><span class="nm">${esc(name)}</span><i class="c">${count}</i></a>`;
}

/**
 * Gives the frame of a diagram in the overview its height, also when the tab changes its size: the upper part of the tab, as large as the width
 * allows, and no taller than the drawing needs at that size. A drawing that would then be smaller than the diagram alone shows it may take more of
 * the tab, up to OVERVIEW_MOST, so that its words keep their size. `width` and `height` are the size of the drawing. The room is counted from the top
 * of the frame with nothing scrolled.
 */
function keepOverview(stage, width, height) {
  const set = () => {
    let top = stage.getBoundingClientRect().top + scrollY;
    for (let el = stage.parentElement; el; el = el.parentElement) top += el.scrollTop;
    const room = innerHeight - top;
    const across = (stage.clientWidth - 2 * OVERVIEW_ROOM) / width;
    const tall = (scale) => height * scale + 2 * OVERVIEW_ROOM; // the height of the frame for the drawing at this scale
    const most = Math.max(room * OVERVIEW_SHARE, Math.min(tall(Math.min(1, across)), room * OVERVIEW_MOST));
    stage.style.height = `${Math.round(Math.max(OVERVIEW_LEAST, Math.min(tall(Math.min(GROW, across)), most)))}px`;
  };
  set();
  const again = () => (stage.isConnected ? set() : removeEventListener('resize', again));
  addEventListener('resize', again);
}
