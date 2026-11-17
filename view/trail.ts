// The path that he followed in this window. The extension keeps it, so that Home, the graphs tabs and the change page draw the same line.
// The rules of the path are in media/trail.js, which the pages use too. No `vscode` import.

/** Where a step of a change goes on its page: a level and its diagram, or "Diffs"; with the nodes that were lit. */
export interface ChangeGo {
  level?: 'change' | 'part' | 'broad';
  part?: string;
  diagram?: string;
  lit?: string[];
  view?: 'diffs' | 'conversation';
  pull?: number; // the conversation of this pull request of the branch
}

/** One view: a map diagram on Home ('' for the top map), the graphs of a path, or a view of a change. `name` is the title that the view shows. */
export type Step =
  | { tab: 'home'; diagram: string; lit?: string[]; name: string }
  | { tab: 'graphs'; path: string; name: string }
  | { tab: 'change'; change: number; go: ChangeGo; name: string }
  | { tab: 'pull'; link: string; name: string }; // a pull request with no stored change

interface Rules {
  HOME: Step;
  key(step: Step): string;
  start(step: Step): Step[];
  upTo(steps: Step[], step: Step): Step[];
  walk(steps: Step[], from: Step, to: Step): Step[];
  before(steps: Step[], own: Step): Step | null;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const TrailRules: Rules = require('../../view/media/trail.js');

/** The path of the window. `open` shows the view of a step in its tab; `told` gets the path each time that it changes. */
export class WindowTrail {
  steps: Step[] = [TrailRules.HOME];

  constructor(private open: (step: Step) => void, private told: (steps: Step[]) => void) {}

  /** A new path: he opened a view from outside a page. */
  start(step: Step): void {
    this.set(TrailRules.start(step));
  }

  /** A step that a page took by itself; with `open`, its view is in another tab, which opens. */
  walk(from: Step, to: Step, open = false): void {
    this.set(TrailRules.walk(this.steps, from, to));
    if (open) this.open(to);
  }

  /** Back to an earlier step of a line: the path ends there again, and its view opens. */
  back(to: Step): void {
    this.set(TrailRules.upTo(this.steps, to));
    this.open(to);
  }

  private set(steps: Step[]): void {
    this.steps = steps;
    this.told(steps);
  }
}
