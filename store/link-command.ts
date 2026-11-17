// "apostil link" prints the https link that opens a pull request, or the change of this branch, in Apostil. "apostil links off|on|status" is the switch.
// Both print a line, not JSON. While the links are off, "apostil link" prints nothing.

import { isBranch, isRepo, linksOn, markdownLine, setLinks, webLink, type LinkTarget } from '../shared/apostil-link';
import { changeOfFolder } from '../shared/context';
import { tryGit } from '../shared/git';
import { githubRepoOf, parsePullRef } from '../shared/read-pull-request';
import { Store } from '../shared/store';

export const LINK_USAGE = {
  link: 'apostil link --pr [<number>] | --change [--markdown] (prints a line, not JSON; nothing while the links are off)',
  links: 'apostil links off|on|status (prints a line, not JSON)',
};

export interface Printed {
  line?: string; // nothing to print when undefined
  problem?: string; // for standard error, with exit code 1
}

/** The parts of the change of the branch of a folder, when it has a description. */
function partsOf(folder: string): number | undefined {
  let store: Store | undefined;
  try {
    store = new Store();
    return changeOfFolder(store, folder)?.file.parts.length || undefined;
  } catch {
    return undefined; // no store, or not a Git repo
  } finally {
    store?.close();
  }
}

/** "apostil link": --pr with a number or a link of a pull request, or with none for the pull request of this branch; --change for the change of this branch. */
export function linkCommand(words: string[], folder: string, env: NodeJS.ProcessEnv = process.env, parts = partsOf): Printed {
  const at = words.indexOf('--pr');
  if (at < 0 && !words.includes('--change')) return { problem: `Usage: ${LINK_USAGE.link}` };
  if (!linksOn(env)) return {};
  const asked = at >= 0 && words[at + 1] && !words[at + 1].startsWith('--') ? words[at + 1] : undefined;
  const repo = githubRepoOf(folder)?.slug;
  const ref = asked ? parsePullRef(asked, repo) : undefined;
  if (asked && !ref) return { problem: `"${asked}" is not the number or the link of a pull request${repo ? '' : ', and this folder has no remote on GitHub'}.` };
  let target: LinkTarget;
  if (ref) {
    target = { open: 'pull', repo: `${ref.owner}/${ref.name}`, number: ref.number };
  } else {
    const branch = tryGit(folder, 'branch', '--show-current') ?? '';
    if (!repo) return { problem: 'This folder has no remote on GitHub.' };
    if (!isBranch(branch)) return { problem: branch ? `The branch "${branch}" cannot be in a link.` : 'No branch is checked out.' };
    target = { open: at >= 0 ? 'pull' : 'change', repo, branch };
  }
  if (!isRepo(target.repo)) return { problem: `"${target.repo}" is not a repo on GitHub.` };
  const link = webLink(target);
  // The words after the link speak of the change of this branch, so only for a pull request of the repo of this folder.
  return { line: words.includes('--markdown') ? markdownLine(link, target.repo === repo ? parts(folder) : undefined) : link };
}

/** "apostil links off|on|status". */
export function linksCommand(word: string | undefined, env: NodeJS.ProcessEnv = process.env): Printed {
  if (word === 'off' || word === 'on') setLinks(word === 'on');
  else if (word !== 'status' && word !== undefined) return { problem: `Usage: ${LINK_USAGE.links}` };
  const why = env.APOSTIL_NO_LINKS === '1' ? 'APOSTIL_NO_LINKS=1 keeps them off in this shell.' : '"apostil links on" turns them on again.';
  return { line: linksOn(env) ? 'The links and nudges of Apostil are on.' : `The links and nudges of Apostil are off. ${why}` };
}
