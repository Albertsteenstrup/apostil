// The places that the answer of an agent names: code as a path, with or without lines ("shared/models.ts:246-257"), and a diagram or a node by its
// title in double quotes. remarks.js draws them as links in the card.
'use strict';

const AnswerLinks = (() => {
  const QUOTED = /["“]([^"“”\n]+)["”]/g;
  // Not inside a word, a link or an e-mail address; a folder alone ("store/") is no file.
  const PATH = /(?<![\w./:@-])(?:\.\/)?((?:[\w.-]+\/)*[\w.-]*\w)(?::(\d+)(?:[-–](\d+))?)?(?![\w/])/g;
  const EXTENSION = /\.\w+$/;

  /**
   * The text in parts, which joined give it back: words { text }, and a place { text, place }: code { file, lines } or a target of the page from
   * `known.titles`. Code is a file in `known.files`, or a path with a folder or lines and an extension, which VS Code opens or says is missing.
   */
  function parts(text, known) {
    const out = [];
    const words = (piece) => { if (piece) out.push({ text: piece }); };
    const code = (piece) => {
      let at = 0;
      for (const match of piece.matchAll(PATH)) {
        const [whole, file, from, to] = match;
        if (!known.files.has(file) && !(EXTENSION.test(file) && (file.includes('/') || from))) continue;
        words(piece.slice(at, match.index));
        out.push({ text: whole, place: { file, ...(from ? { lines: [Number(from), Number(to ?? from)] } : {}) } });
        at = match.index + whole.length;
      }
      words(piece.slice(at));
    };
    let at = 0;
    for (const match of text.matchAll(QUOTED)) {
      const place = known.titles.get(match[1]);
      if (!place) continue;
      const start = match.index + 1;
      code(text.slice(at, start));
      out.push({ text: match[1], place });
      at = start + match[1].length;
    }
    code(text.slice(at));
    return out;
  }

  return { parts };
})();

if (typeof module === 'object') module.exports = AnswerLinks; // for the tests in Node
