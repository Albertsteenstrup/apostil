// One step of the path that he followed in a window: a view of Apostil. The path itself is in view/trail.ts, its rules in view/media/trail.js.

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
