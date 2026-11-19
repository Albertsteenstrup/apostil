// The one window of the page: a frame with a title bar, and the hover window that uses it.
// The list of files, the choice of a pull request and a large picture use the same frame.
'use strict';

/** A window frame: title, a quiet sub title (HTML), actions at the right (HTML), and a body. */
function windowFrame({ title, sub = '', actions = '', width: wanted = 420 }) {
  const width = Math.min(wanted, innerWidth - 24); // a narrow column gets a narrower window
  const el = html(`<div class="win" style="width:${width}px"><div class="tb"><b>${esc(title)}</b><span class="sub">${sub}</span><span class="act">${actions}</span></div><div class="wc"></div></div>`);
  document.body.append(el);
  const body = el.querySelector('.wc');
  // The wheel scrolls the content of the window while the pointer is in it; the page behind does not move.
  el.addEventListener('wheel', (event) => { event.preventDefault(); body.scrollBy(event.deltaX, event.deltaY); }, { passive: false });
  return { el, body };
}

/** Places a window beside a box, on the side with room, so it does not cover the neighbours of the box. */
function placeWindow(win, box) {
  const gap = 10;
  const room = { below: innerHeight - box.bottom, above: box.top, right: innerWidth - box.right, left: box.left };
  const width = win.offsetWidth;
  const tall = win.offsetHeight;
  const fits = {
    below: room.below >= tall + gap, above: room.above >= tall + gap,
    right: room.right >= width + gap, left: room.left >= width + gap,
  };
  const side = ['below', 'right', 'above', 'left'].find((name) => fits[name]) ?? Object.keys(room).sort((a, b) => room[b] - room[a])[0];
  // A window too tall for the room above or below gets shorter and scrolls, so it does not lie over the thing that it is about.
  const shorter = (side === 'below' || side === 'above') && !fits[side] && room[side] - gap - 12 >= 160;
  if (shorter) win.style.maxHeight = `${room[side] - gap - 12}px`;
  const height = shorter ? win.offsetHeight : tall;
  let left = side === 'right' ? box.right + gap : side === 'left' ? box.left - width - gap : box.left;
  let top = side === 'below' ? box.bottom + gap : side === 'above' ? box.top - height - gap : box.top;
  left = Math.max(12, Math.min(left, innerWidth - width - 12));
  top = Math.max(12, Math.min(top, innerHeight - height - 12));
  Object.assign(win.style, { left: `${left}px`, top: `${top}px` });
}

/** The hover window: opens after 0.3 seconds, stays while the pointer is on it or on its anchor, and has "Open" when its content can be opened. */
const Hover = (() => {
  let shown = null; // { el, anchor }
  let openTimer = 0;
  let waiting = null; // the element whose window the open timer waits for: each stop of the timer clears it, so no wait stays asked for with no timer
  let hideTimer = 0;
  const stopWait = () => { clearTimeout(openTimer); waiting = null; };
  // The pointer left the window or its thing: the window closes in 0.25 s, unless it comes back. Only one such wait runs, so the next enter stops it.
  const hideSoon = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 250); };
  let turn = 0; // goes up with each window that is asked for and each close from outside: content that comes late for an older turn opens no window
  // A tab that shows again gets pointer events at the place where the pointer was before, though the pointer is elsewhere now.
  // So after a close from outside no window opens until the pointer has really moved.
  let point = ''; // the last place of the pointer, as "x,y"
  let stale = null; // that place at the last close from outside; null when the pointer has moved since
  document.addEventListener('mousemove', (event) => { point = `${event.clientX},${event.clientY}`; if (point !== stale) stale = null; }, true);

  function hide() {
    if (!shown) return;
    shown.el.remove();
    shown.anchor.classList.remove('hot');
    shown = null;
  }

  /** `asked` true: a click or a key asked for this window, which opens also when the pointer is elsewhere (on the row of a menu). */
  async function show(anchor, load, around, asked = false) {
    const here = () => asked || anchor.matches(':hover');
    if (!anchor.isConnected || !here() || (stale !== null && !asked)) return; // the pointer left, the page drew something new, or the pointer did not move
    const mine = ++turn;
    const content = await load();
    const picking = document.body.classList.contains('picking'); // the pointer is a comment icon: the next click sticks a comment
    // A close that came while the content loaded wins: a tab that was hidden meanwhile still says that the pointer is on the anchor.
    if (!content || mine !== turn || !here() || picking) return;
    hide();
    // At the right of the title bar: "Open", when the content can be opened.
    const frame = windowFrame({ title: content.title, sub: content.sub, width: content.width, actions: content.open ? '<a data-open>Open</a>' : '' });
    if (typeof content.body === 'string') frame.body.innerHTML = content.body;
    else frame.body.append(content.body);
    if (content.pad) frame.body.classList.add('pad');
    shown = { el: frame.el, anchor };
    anchor.classList.add('hot');
    placeWindow(frame.el, (around ?? anchor).getBoundingClientRect());
    await content.ready?.(frame.body); // for a diagram that is drawn after the window opens
    placeWindow(frame.el, (around ?? anchor).getBoundingClientRect());
    frame.el.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    frame.el.addEventListener('mouseleave', hideSoon);
    // "Open" of the title bar only: a row of the body may carry data-open for a click of its own.
    if (content.open) frame.el.querySelector('.tb .act [data-open]')?.addEventListener('click', () => { hide(); content.open(); });
  }

  const anchors = new WeakSet(); // the elements that have a hover window or a hover action
  /** The innermost such element that an event is on: a move inside it also passes its outer ones, which must not take it. */
  const anchorOf = (event) => { let el = event.target; while (el && !anchors.has(el)) el = el.parentElement; return el; };

  /** Gives an element a hover window. `load` returns { title, sub, body, width, open, ready } when the window opens. */
  function attach(anchor, load, around) {
    let clicked = false; // a click opens the thing; its window is not wanted until the pointer has left
    anchors.add(anchor);
    const come = (event) => {
      if (waiting === anchor || clicked || shown?.anchor === anchor || anchorOf(event) !== anchor) return;
      stopWait();
      clearTimeout(hideTimer);
      waiting = anchor;
      openTimer = setTimeout(() => { waiting = null; show(anchor, load, around); }, 300);
    };
    anchor.addEventListener('mouseenter', come);
    // The pointer can be on the element already when the page draws it; then no "enter" comes, and its first real move counts as coming.
    // So also a close from outside during the wait leaves the next move free to ask again.
    anchor.addEventListener('mousemove', come);
    anchor.addEventListener('mouseleave', () => {
      clicked = false;
      stopWait();
      hideSoon();
    });
    anchor.addEventListener('click', () => { clicked = true; stopWait(); });
  }

  /**
   * Calls `enter` when the pointer rests on an element as long as a hover window waits, and `leave` when it leaves after that:
   * for a place where the thing is on screen already and no window opens. No window is open meanwhile.
   */
  function after(anchor, enter, leave = () => {}) {
    let timer = 0;
    let on = false;
    anchors.add(anchor);
    const come = (event) => {
      if (anchorOf(event) !== anchor) { clearTimeout(timer); timer = 0; return; } // on an inner element with its own action: that one waits
      if (timer || on) return;
      timer = setTimeout(() => {
        timer = 0;
        if (!anchor.isConnected || !anchor.matches(':hover') || stale !== null || document.body.classList.contains('picking')) return;
        hide();
        on = true;
        enter();
      }, 300);
    };
    anchor.addEventListener('mouseenter', come);
    anchor.addEventListener('mousemove', come); // as in attach: the pointer was on it when the page drew it
    anchor.addEventListener('mouseleave', () => {
      clearTimeout(timer);
      timer = 0;
      if (on) { on = false; leave(); }
    });
    anchor.addEventListener('click', () => { clearTimeout(timer); timer = 0; });
  }

  /**
   * Opens a window on an element at once, for a click that asks for it (the places of a mark); it stays while the pointer is on it or on the element.
   * `asked`: it opens also when the pointer is not on the element (the window of a target, from a row of a menu).
   */
  function now(anchor, load, around, asked = false) {
    stopWait();
    clearTimeout(hideTimer);
    return show(anchor, load, around, asked);
  }

  const close = () => { stopWait(); turn++; stale = point; hide(); };
  // Escape closes the window that is open, unless he types in a field.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && shown && !event.target.closest?.('[data-field], textarea, input')) close();
  });

  return { attach, after, now, hide: close };
})();
