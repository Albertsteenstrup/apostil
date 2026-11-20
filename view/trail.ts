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
  | { tab: 'pull'; link: string; name: string } // a pull request with no stored change
  | { tab: 'branch'; name: string } // the open branch with no change file
  | { tab: 'page'; page: string; name: string }; // a page of the look of the repo

interface Rules {
  HOME: Step;
  start(step: Step): Step[];
  upTo(steps: Step[], step: Step): Step[];
  walk(steps: Step[], from: Step, to: Step): Step[];
  before(steps: Step[], own: Step): Step | null;
  goTo(steps: Step[], ahead: Step[], step: Step): { steps: Step[]; ahead: Step[] };
  next(steps: Step[], ahead: Step[], own: Step | null, way: -1 | 1): Step | null;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const TrailRules: Rules = require('../../view/media/trail.js');

/** The path of the window. `open` shows the view of a step in its tab; `told` gets the path each time that it changes. */
export class WindowTrail {
  steps: Step[] = [TrailRules.HOME];
  ahead: Step[] = []; // the steps that a way back left: forward goes to them, until he takes a new step

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

  /** To a step of a line, or of the steps ahead: the path ends there, the steps after it stay ahead, and its view opens. */
  back(to: Step): void {
    const { steps, ahead } = TrailRules.goTo(this.steps, this.ahead, to);
    this.set(steps, ahead);
    this.open(to);
  }

  /** One step back (-1) or forward (1) from the view of a page (none: a file tab): its view opens; nothing when there is no such step. */
  move(way: -1 | 1, from?: Step): void {
    const to = TrailRules.next(this.steps, this.ahead, from ?? null, way);
    if (to) this.back(to);
  }

  /** A new path or a new step has nothing ahead. */
  private set(steps: Step[], ahead: Step[] = []): void {
    this.steps = steps;
    this.ahead = ahead;
    this.told(steps);
  }
}
