// The steps of the one question in a repo with no map, with no VS Code in them, so that a test can call them.

import { homedir } from 'node:os';
import { SETUP_APPS, skillsSeen, thisInstall, type Machine } from '../store/setup';

/**
 * The agent apps that are connected: on the path, with the skills of Apostil for this repo or for all repos. Claude Code comes first,
 * so that it is the default action of the question.
 */
export function connectedApps(apps: string[], root: string, machine: Machine = { home: homedir(), path: process.env.PATH ?? '' }, install = thisInstall()): string[] {
  const sees = (id: string): boolean => {
    const app = SETUP_APPS.find((one) => one.id === id);
    return !!app && skillsSeen(app, install, machine, root).every((skill) => skill.there);
  };
  return apps.filter(sees).sort((a, b) => Number(b === 'claude-code') - Number(a === 'claude-code'));
}

/**
 * What comes next in a repo: nothing (it has a map, or it was asked before); the question that starts the map (an app is connected);
 * the question that connects the agent apps; or a wait, when the set-up question of the first start was asked a moment ago and no app
 * is connected: he is not asked the same thing twice in a row, and the next window asks.
 */
export function newRepoStep(state: { map: boolean; asked: boolean; connected: number; setUpAskedNow: boolean }): 'nothing' | 'map' | 'connect' | 'wait' {
  if (state.map || state.asked) return 'nothing';
  if (state.connected > 0) return 'map';
  return state.setUpAskedNow ? 'wait' : 'connect';
}
