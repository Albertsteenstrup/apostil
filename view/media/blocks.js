// The blocks of a look: what a page of the look or a section of a window shows, drawn by Apostil in its own style, in both themes.
// The data comes from view/look-blocks.ts. Every text is escaped, a picture is an address of Apostil's store, and a link or a button goes to a
// target of the one list through Marks.act. One function draws a block wherever it stands: a page, a section of a window, the window of a target.
'use strict';

const Blocks = (() => {
  const NUMBER = /^[-+]?\d[\d,]*(?:\.\d+)?%?$/; // a cell that is a number stands at the right of its column
  const PLACES = ['place', 'graphs', 'change', 'pull', 'page', 'window', 'comment']; // a target inside Apostil: its link has an arrow; a file or a web address the arrow out

  /** The kind of a block: its one field besides the title and the facts of its file. */
  const kindOf = (block) => Object.keys(block).find((key) => !['title', 'from', 'more'].includes(key));

  /** The HTML of one block. A target of a link or a button goes into `targets` and the element names it by its number; a diagram into `panels`. */
  function blockHtml(block, targets, panels) {
    const kind = kindOf(block);
    const value = block[kind];
    const go = (target) => targets.push(target) - 1;
    let inner = '';
    switch (kind) {
      case 'quiet': inner = `<p class="bk-quiet">${esc(value)}</p>`; break;
      case 'text': inner = `<div class="bk-words">${String(value).split(/\n\s*\n/).map((part) => `<p>${esc(part.trim()).replace(/\n/g, '<br>')}</p>`).join('')}</div>`; break;
      case 'fields': inner = `<dl class="bk-pairs">${value.map(([name, one]) => `<dt>${esc(name)}</dt><dd>${esc(one)}</dd>`).join('')}</dl>`; break;
      case 'table': {
        const numeric = value.columns.map((name, at) => value.rows.length > 0 && value.rows.every((row) => row[at] === undefined || row[at] === '' || NUMBER.test(String(row[at]))));
        const cell = (tag, text, at) => `<${tag}${numeric[at] ? ' class="n"' : ''}>${esc(text ?? '')}</${tag}>`;
        inner = `<div class="bk-scroll"><table class="bk-grid"><thead><tr>${value.columns.map((name, at) => cell('th', name, at)).join('')}</tr></thead>`
          + `<tbody>${value.rows.map((row) => `<tr>${value.columns.map((name, at) => cell('td', row[at], at)).join('')}</tr>`).join('')}</tbody></table></div>`;
        break;
      }
      case 'bars': {
        const most = Math.max(0, ...value.map(([, count]) => Math.abs(count))) || 1;
        inner = `<div class="bk-bar-list">${value.map(([name, count]) => `<span class="bk-bar-name">${esc(name)}</span>`
          + `<span class="bk-bar-track"><i class="bk-bar" style="width:${((Math.abs(count) / most) * 100).toFixed(1)}%"></i></span><span class="bk-bar-n">${esc(number(count))}</span>`).join('')}</div>`;
        break;
      }
      case 'code': {
        let open = null;
        const lines = value.text.split('\n').map((line) => { const colored = colorLine(line, open); open = colored.open; return colored.html; });
        const where = value.from ? ` <i>${linesText([value.from, value.to])}</i>` : '';
        const head = value.file ? `<a class="bk-file" data-bk-go="${go({ file: value.file, ...(value.from ? { line: value.from } : {}) })}">${esc(value.file)}${where}</a>` : '';
        inner = `${head}<pre class="bk-lines">${lines.join('\n')}</pre>`;
        break;
      }
      case 'state': {
        const pair = value.color && Marks.lineColors(value.color);
        const color = pair ? ` style="--bk-dot-l:${pair.light};--bk-dot-d:${pair.dark}"` : '';
        inner = `<p class="bk-state"><i class="bk-dot"${color}></i><b class="bk-word">${esc(value.word)}</b>${value.text ? `<span class="bk-said">${esc(value.text)}</span>` : ''}</p>`;
        break;
      }
      case 'links':
        inner = `<p class="bk-links">${value.map((link) => `<a data-bk-go="${go(link.target)}" title="${esc(Marks.targetWords(link.target))}">`
          + `<span class="bk-arrow" aria-hidden="true">${PLACES.some((key) => link.target?.[key] !== undefined) ? '→' : '↗'}</span>${esc(link.name)}</a>`).join('')}</p>`;
        break;
      case 'button': inner = `<button class="bk-press" data-bk-go="${go(value.target)}" title="${esc(Marks.targetWords(value.target))}">${esc(value.name)}</button>`; break;
      case 'picture': inner = `<img class="bk-image" src="${esc(value)}" alt="${esc(block.title ?? '')}">`; break;
      case 'diagram':
        inner = `<a class="bk-panel" data-bk-go="${go({ place: { diagram: value.id } })}" data-bk-panel="${panels.push(value) - 1}" title="${esc(`Opens ${value.title} on Home.`)}">`
          + `<div class="bk-drawing"></div><span class="bk-caption">${esc(value.title)}</span></a>`;
        break;
      case 'row': inner = `<div class="bk-cols">${value.map((one) => blockHtml(one, targets, panels)).join('')}</div>`; break;
    }
    const title = block.title ? `<div class="bk-title">${esc(block.title)}</div>` : '';
    const from = block.from ? `<p class="bk-from">from ${esc(block.from)}${block.more ? ` · ${plural(block.more, 'more row')}` : ''} · <a data-bk-go="${go({ file: block.from })}">Open the file</a></p>` : '';
    return `<div class="bk block-${esc(kind)}">${title}${inner}${from}</div>`; // the class of its kind; the names of inner parts start with "bk-"
  }

  /**
   * Draws blocks into an element: a click on a link, a button, the name of a file or a diagram goes to its target (Marks.act), and a diagram is
   * drawn small by the function that draws a panel of the graphs page, when the page has it. Resolves when the diagrams are drawn.
   */
  async function show(holder, blocks) {
    const targets = [];
    const panels = [];
    const list = html(`<div class="bks">${blocks.map((block) => blockHtml(block, targets, panels)).join('')}</div>`);
    list.addEventListener('click', (event) => {
      const link = event.target.closest('[data-bk-go]');
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      Marks.act(targets[Number(link.dataset.bkGo)], link);
    });
    holder.replaceChildren(list);
    const drawing = typeof drawPanel === 'function' ? drawPanel : null; // the graphs page and Home have it
    await Promise.all([...list.querySelectorAll('[data-bk-panel]')].map((box) => drawing?.(box.querySelector('.bk-drawing'), panels[Number(box.dataset.bkPanel)])));
  }

  /** Asks the extension for the blocks of a ref (a section of its own, the window of a target) each time they open, and draws them. */
  async function fill(holder, ref) {
    const answer = await askAgain(`blocks:${ref}`);
    if (!holder.isConnected) return;
    if (!answer?.blocks) holder.innerHTML = `<p class="bk-quiet">${esc(answer?.gone ?? 'Nothing to show here.')}</p>`;
    else await show(holder, answer.blocks);
  }

  return { show, fill };
})();
