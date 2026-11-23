// The tab "Map run": the chart of a map run (a MapRunChart of shared/map-run-chart.ts) on one time axis. The page only scales and draws it.
'use strict';

const RunChart = (() => {
  const KINDS = { diagram: 'Diagrams', notes: 'Notes', process: 'Processes', service: 'Services and marks', other: 'Other writers' };
  const TOP = 28; // room for the word "now" over the lead
  const LEAD = 14;
  const ROW = 7;
  const WRITERS = TOP + LEAD + 28;
  const MINUTE = 60_000;

  const minutes = (ms) => Math.max(1, Math.round(ms / MINUTE));
  const tokens = (count) => (count >= 1e6 ? `${(count / 1e6).toFixed(1)} M` : count >= 1000 ? `${Math.round(count / 1000)}k` : `${count}`);
  const runWords = (run) => States.runWords('claude-code', run);
  let held = false; // a chart came while a hover window was open: it is drawn when the window closes

  function stateHtml(chart) {
    if (chart.state === 'writing') {
      const left = chart.minutesLeft ? ` · about ${Math.round(chart.minutesLeft)} min left` : '';
      return `<span class="mr-state live"><i></i>Writing · ${minutes(chart.now)} min so far${left}</span>`;
    }
    if (chart.state === 'done') return `<span class="mr-state">Done in ${minutes(chart.now)} min</span>`;
    if (chart.state === 'stopped') return `<span class="mr-state">Stopped after ${minutes(chart.now)} min</span>`;
    return '';
  }

  function headHtml(chart) {
    const session = chart.session ? `Claude Code session ${esc(chart.session)}` : 'Claude Code session';
    const runs = chart.state === 'waiting' ? '' : ` · lead ${esc(runWords(chart.lead.run))}${chart.writersRun ? ` · writers ${esc(runWords(chart.writersRun))}` : ''}`;
    return `<div class="mr-head"><div><h1>Map run</h1><div class="mr-sub">${session}${runs}</div></div>${stateHtml(chart)}</div>`;
  }

  function numbersHtml(chart) {
    const { running, done, tokens: written } = chart.numbers;
    const writers = chart.state === 'writing'
      ? `<span><b>${running}</b> ${running === 1 ? 'writer runs' : 'writers run'} now</span><span><b>${done}</b> done</span>`
      : `<span><b>${chart.writers.length}</b> writers</span>`;
    return `<div class="mr-nums">${writers}<span>lead busy <b>${minutes(chart.lead.busy)} min</b> of ${minutes(chart.now)}</span><span><b>${tokens(written)}</b> tokens written</span></div>`;
  }

  function plotHtml(chart) {
    const live = chart.state === 'writing';
    const total = Math.max(MINUTE, chart.now + (live ? (chart.minutesLeft ?? 0) * MINUTE : 0));
    const x = (ms) => `${((ms / total) * 100).toFixed(3)}%`;
    const width = (span) => `${(((span.to - span.from) / total) * 100).toFixed(3)}%`;
    const bottom = WRITERS + chart.writers.length * ROW;
    const height = bottom + 26;
    const tall = bottom + 4 - (TOP - 6);
    const svg = [`<defs><pattern id="mr-ahead" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6"/></pattern></defs>`];
    for (const span of chart.alone) svg.push(`<rect class="mr-alone" x="${x(span.from)}" y="${TOP - 6}" width="${width(span)}" height="${tall}"/>`);
    if (live) svg.push(`<rect class="mr-ahead" x="${x(chart.now)}" y="${TOP - 6}" width="${width({ from: chart.now, to: total })}" height="${tall}"/>`);
    for (let minute = 0; minute * MINUTE <= total; minute += 5) {
      svg.push(`<line class="mr-grid" x1="${x(minute * MINUTE)}" x2="${x(minute * MINUTE)}" y1="${TOP - 6}" y2="${bottom + 4}"/><text class="mr-tick" x="${x(minute * MINUTE)}" y="${bottom + 20}">${minute} min</text>`);
    }
    svg.push(`<rect class="mr-track" x="0" y="${TOP}" width="${x(live ? chart.now : total)}" height="${LEAD}" rx="3"/>`);
    for (const span of chart.lead.thinks) svg.push(`<rect class="mr-think" x="${x(span.from)}" y="${TOP}" width="${width(span)}" height="${LEAD}"/>`);
    for (const span of chart.lead.commands) svg.push(`<rect class="mr-command" x="${x(span.from)}" y="${TOP}" width="${width(span)}" height="${LEAD}"/>`);
    chart.writers.forEach((writer, at) => {
      const y = WRITERS + at * ROW;
      const dot = writer.running ? `<circle class="k-${writer.kind}" cx="${x(writer.to)}" cy="${y + ROW / 2}" r="2.6"/>` : '';
      svg.push(`<g class="mr-writer" data-writer="${at}"><rect class="mr-hit" x="${x(writer.from)}" y="${y}" width="${width(writer)}" height="${ROW}"/>`
        + `<rect class="mr-bar k-${writer.kind}" x="${x(writer.from)}" y="${y + 1}" width="${width(writer)}" height="${ROW - 2}" rx="1.5"/>${dot}</g>`);
    });
    if (live) svg.push(`<line class="mr-now" x1="${x(chart.now)}" x2="${x(chart.now)}" y1="${TOP - 14}" y2="${bottom + 4}"/><text class="mr-nowword" x="${x(chart.now)}" y="${TOP - 18}">now</text>`);
    const label = (top, name, run) => `<div class="mr-label" style="top:${top}px"><b>${name}</b><span>${esc(run?.name ?? '')}</span></div>`;
    return `<div class="mr-plot"><div class="mr-labels" style="height:${height}px">${label(TOP - 4, 'Lead', chart.lead.run)}${chart.writers.length ? label(WRITERS - 4, 'Writers', chart.writersRun) : ''}</div>`
      + `<svg width="100%" height="${height}">${svg.join('')}</svg></div>`;
  }

  function keyHtml(chart) {
    const item = (cls, words) => `<span><i class="${cls}"></i>${words}</span>`;
    const kinds = Object.keys(KINDS).filter((kind) => chart.writers.some((writer) => writer.kind === kind));
    return `<div class="mr-key">${item('mr-think', 'Lead thinks and writes')}${item('mr-command', 'Lead runs a command')}${kinds.map((kind) => item(`k-${kind}`, KINDS[kind])).join('')}${chart.alone.length ? item('mr-alone', 'Lead alone') : ''}</div>`;
  }

  /** The hover window of a writer: its task, its model, effort and minutes, and its tokens. */
  const writerWindow = (writer) => () => ({
    title: writer.task || KINDS[writer.kind], width: 320, pad: true,
    body: `<div class="mr-win"><p>${esc(runWords(writer.run))} · ${writer.running ? 'running ' : ''}${((writer.to - writer.from) / MINUTE).toFixed(1)} min</p><p>${tokens(writer.tokens)} tokens written${writer.running ? ' so far' : ''}</p></div>`,
  });

  /** Draws the chart of Home.data; while a hover window is open the drawing stays, and the newest chart is drawn when it closes. */
  function draw() {
    if (document.querySelector('body > .win')) { held = true; return; }
    const chart = Home.data;
    const view = document.getElementById('view');
    document.getElementById('crumb').textContent = '';
    document.getElementById('summary').textContent = '';
    Overview.cards(document.getElementById('cards'), []);
    view.className = 'view mr';
    view.innerHTML = chart.state === 'waiting'
      ? `${headHtml(chart)}<p class="quiet">The session has not started to write yet.</p>`
      : `${headHtml(chart)}${numbersHtml(chart)}${plotHtml(chart)}${keyHtml(chart)}`;
    for (const row of view.querySelectorAll('.mr-writer')) Hover.attach(row, writerWindow(chart.writers[Number(row.dataset.writer)]));
    tell({ type: 'rendered', kind: 'run', nodes: chart.writers?.length ?? 0, panels: 0, drawn: 0 });
    window.apostilRendered = (window.apostilRendered ?? 0) + 1;
  }

  new MutationObserver(() => {
    if (held && !document.querySelector('body > .win')) { held = false; Home.render(); }
  }).observe(document.body, { childList: true });

  return { draw };
})();
