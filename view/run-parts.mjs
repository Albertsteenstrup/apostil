// Runs the parts of the checks as programs of their own and gives the count and the time of each part, for view/check.mjs and view/browser-check.mjs.
// A part prints a line "PASS  ..." or "FAIL  ..." for each check; the tests of Node print their own counts ("ℹ pass 12").

import { spawn } from 'node:child_process';

/** Starts one part and resolves when it ends, with its counts, its time in seconds, its exit code and all it printed. */
export function runPart(name, command, args, env = {}) {
  const start = Date.now();
  return new Promise((done) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    // A program that is not there (a dev dependency not installed) is a failed part with one line, not the end of the whole run: the other parts close their windows.
    child.on('error', (error) => done({ name, passed: 0, failed: 0, code: 1, seconds: (Date.now() - start) / 1000, output: `Could not start ${command}: ${error.message}. Run npm ci.`, ok: false }));
    child.on('close', (code) => {
      const lines = output.split('\n');
      const count = (word) => lines.filter((line) => new RegExp(`(^|\\s)${word}\\s`).test(line)).length;
      const node = (word) => Number(new RegExp(`^ℹ ${word} (\\d+)`, 'm').exec(output)?.[1] ?? 0);
      const passed = count('PASS') + node('pass');
      const failed = count('FAIL') + node('fail');
      done({ name, passed, failed, code: code ?? 1, seconds: (Date.now() - start) / 1000, output, ok: code === 0 && failed === 0 });
    });
  });
}

/** One line for each part: its name, its count, its time; then the lines of the checks that failed, and the whole output of a part that failed with no such line. */
export function summary(parts) {
  const lines = parts.map((part) => `${part.ok ? '  ' : '✗ '}${part.name.padEnd(18)} ${String(part.passed + part.failed).padStart(5)} ${part.seconds.toFixed(1).padStart(7)} s${part.failed ? `  (${part.failed} failed)` : ''}`);
  for (const part of parts.filter((one) => !one.ok)) {
    const failures = part.output.split('\n').filter((line) => /(^|\s)FAIL\s|^✖|not ok/.test(line));
    lines.push('', `--- ${part.name} (exit code ${part.code})`, ...(failures.length ? failures.slice(0, 30) : part.output.trim().split('\n').slice(-40)));
  }
  return lines.join('\n');
}
