// The things that a comment can be stuck on, and where each one is on the page.
// A drawing marks each thing with its target (data-remark) and a key (data-rk); the same thing has the same key in every drawing.
// The code says "remark", as the store does; the page says "comment".
'use strict';

const Places = (() => {
  const page = () => App.page;
  const diagramOf = (id) => page().diagrams.find((diagram) => diagram.id === id);
  const partOf = (id) => page().parts.find((part) => part.id === id);
  const KIND_WORDS = { flow: ['Node', 'Arrow'], sequence: ['Participant', 'Message'], state: ['State', 'Transition'], schema: ['Table', 'Relation'] };

  /** "+634 −2" for a changed file, as plain text. */
  const counts = (path) => {
    const file = page().files.find((candidate) => candidate.path === path);
    return [file?.added ? `+${number(file.added)}` : '', file?.removed ? `−${number(file.removed)}` : ''].filter(Boolean).join(' ');
  };
  const ofPart = (id) => (partOf(id) ? `part "${partOf(id).name}"` : 'in no part');

  /** The label of a node of a diagram: its text in the Mermaid source, or for the diagram of the change the name of its part. */
  const nodeName = (target, id) => (target.diagram ? diagramOf(target.diagram)?.graph.nodes[id] ?? id : partOf(id)?.name ?? id);

  /** The words that name a target in the comment box and on its card. */
  function label(target) {
    const diagram = diagramOf(target.diagram);
    const [nodeWord, edgeWord] = KIND_WORDS[diagram?.kind ?? 'flow'];
    const inDiagram = diagram ? `, diagram "${diagram.title}"` : '';
    switch (target.kind) {
      case 'part': return `Part "${partOf(target.part)?.name ?? target.part}"`;
      case 'file': {
        const more = counts(target.file);
        return `File ${baseName(target.file)}${more ? ` (${more})` : ''}, ${ofPart(target.part)}`;
      }
      case 'more-files': {
        const paths = target.part ? partOf(target.part)?.files ?? [] : page().checks.filesInNoPart;
        return `${plural(Math.max(0, paths.length - 3), 'more file')}, ${ofPart(target.part)}`;
      }
      case 'no-part': return 'The files in no part';
      case 'diagram': return `Diagram "${diagram?.title ?? page().title}"`;
      case 'node': return `${nodeWord} "${nodeName(target, target.node)}"${inDiagram}`;
      case 'edge': {
        const [from, to] = target.edge.map((id) => `"${nodeName(target, id)}"`);
        if (diagram?.kind === 'flow' || !diagram) return `${edgeWord} ${from} to ${to}${target.name ? `, "${target.name}"` : ''}`;
        return `${edgeWord}${target.name ? ` "${target.name}"` : ''} from ${from} to ${to}`;
      }
      case 'note': {
        const note = page().notes.find((candidate) => candidate.file === target.file && candidate.lines[0] === target.lines[0] && !candidate.removed === !target.removed);
        return `Note "${note?.title ?? ''}", ${target.file}, ${target.removed ? 'removed ' : ''}${whereText(note ?? target)}`;
      }
      case 'test': return `Test ${target.name}, ${baseName(target.file)}`;
      case 'message': return `Message of ${target.message?.author ?? '?'}`;
      default: return `${target.file}, ${linesText(target.lines)}`;
    }
  }

  /** A whole target from what a drawing knows: the kind and the ids. It gets its part and its words. */
  function target(thing) {
    const part = thing.part ?? (thing.file && page().parts.find((one) => one.files.includes(thing.file))?.id) ?? diagramOf(thing.diagram)?.part;
    const whole = { ...thing, ...(part ? { part } : {}) };
    for (const key of Object.keys(whole)) if (whole[key] === undefined) delete whole[key];
    return { ...whole, label: label(whole) };
  }

  /** The key of a target: the same thing has the same key in every drawing. Code lines have none; the code view lights them. */
  function keyOf(target) {
    const { kind, part = '', file = '', diagram = '' } = target;
    if (kind === 'part' || kind === 'more-files') return `${kind}:${part}`;
    if (kind === 'file') return `file:${file}`;
    if (kind === 'no-part') return 'no-part';
    if (kind === 'diagram') return `diagram:${diagram}`;
    if (kind === 'node') return `node:${diagram}:${target.node}`;
    if (kind === 'edge') return `edge:${diagram}:${target.edge.join('>')}:${target.name ?? ''}`;
    if (kind === 'note') return `note:${file}:${target.removed ? 'removed:' : ''}${target.lines[0]}`;
    if (kind === 'test') return `test:${file}:${target.name}`;
    if (kind === 'message') return `message:${target.message?.id ?? ''}`;
    return '';
  }

  /** Marks an element as a thing that can hold a comment. */
  function mark(el, thing) {
    const whole = target(thing);
    el.dataset.remark = JSON.stringify(whole);
    el.dataset.rk = keyOf(whole);
  }

  /** The same mark as HTML attributes, for an element that is written as text. */
  const attrs = (thing) => {
    const whole = target(thing);
    return `data-remark="${esc(JSON.stringify(whole))}" data-rk="${esc(keyOf(whole))}"`;
  };

  const sameTitle = (now, kept) => now === kept || now.startsWith(`${kept} `);

  /** True when the change file that the page shows no longer holds the thing: the change was saved again. */
  function isGone(target) {
    const diagram = target.diagram && diagramOf(target.diagram);
    if (target.diagram && !diagram) return true;
    if (target.kind === 'part' || (target.kind === 'more-files' && target.part)) return !partOf(target.part);
    if (target.kind === 'file') return !page().files.some((file) => file.path === target.file) && !page().parts.some((part) => part.files.includes(target.file));
    // A node whose id now names another thing (the map was written again) is as gone as one with no id; a box that holds steps adds their count to its title.
    if (target.kind === 'node') return !(target.node in (diagram ? diagram.graph.nodes : {})) || (!!target.kept && !sameTitle(diagram.graph.nodes[target.node], target.kept.title));
    if (target.kind === 'edge' && diagram) return !diagram.graph.edges.some((edge) => edge.from === target.edge[0] && edge.to === target.edge[1]);
    if (target.kind === 'edge') return !page().links.some((link) => link.from === target.edge[0] && link.to === target.edge[1]);
    return false;
  }

  /** The nearest thing that is still there: its part, else its diagram, else the diagram of the change. */
  function nearest(target) {
    if (target.part && partOf(target.part) && target.kind !== 'part') return { kind: 'part', part: target.part };
    if (target.diagram && diagramOf(target.diagram) && target.kind !== 'diagram') return { kind: 'diagram', diagram: target.diagram };
    return { kind: 'diagram' };
  }

  /** The view that shows a target: "code" for code lines, notes and tests, "diffs", "conversation" for a message of a pull request, or a move for App.go. On Home: the diagram of the map. */
  function viewOf(target) {
    if (target.kind === 'message') return 'conversation';
    if (page().map) return { diagram: target.diagram };
    if (['lines', 'note', 'open-point', 'test'].includes(target.kind)) return 'code';
    if (target.view === 'diffs') return 'diffs';
    const diagram = diagramOf(target.diagram);
    if (diagram?.broad) return { level: 'broad', diagram: diagram.id };
    if (diagram?.part) return { level: 'part', part: diagram.part, diagram: diagram.id };
    return { level: 'change' };
  }

  /** The drawn elements of a target on the page and in the comment box's view: none when it is not drawn now. */
  function find(target) {
    const key = keyOf(target);
    return key ? [...document.querySelectorAll(`.paper [data-rk="${CSS.escape(key)}"]`)] : [];
  }

  return { target, mark, attrs, keyOf, isGone, nearest, viewOf, find };
})();
