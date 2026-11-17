// Finds Playwright for the check scripts and the mock renderers. Playwright is not a dependency of Apostil.
import { createRequire } from 'node:module';
import path from 'node:path';

const HOW = 'Playwright was not found. Set APOSTIL_PLAYWRIGHT to a folder that has node_modules/playwright, or run this from a folder that has it.';

/** The `chromium` of Playwright: from the folder that APOSTIL_PLAYWRIGHT names, then from the working directory (its "frontend" folder first). Says how to give it, and stops, when there is none. */
export function findChromium() {
  const folders = [process.env.APOSTIL_PLAYWRIGHT, 'frontend', '.'].filter(Boolean);
  for (const folder of folders) {
    try {
      return createRequire(path.resolve(folder, 'package.json'))('playwright').chromium;
    } catch { /* not there: try the next folder */ }
  }
  console.error(HOW);
  process.exit(1);
}
