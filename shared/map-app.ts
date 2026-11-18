// Which agent app the press "Map this repo" starts: the app that Apostil started last, so that one press does what the owner did before.

/** One run that Apostil started: its app, when, and in which repo. */
export interface StartedRun {
  app: string;
  at: string; // an ISO time
  repoId: string;
}

/**
 * The app that the press starts. The app of the newest run that Apostil started in this repo; else of the newest in any repo; else the first connected
 * app (it has the skills of Apostil); else the first installed app. Only an installed app can be chosen. With no installed app: undefined.
 */
export function appToStart(runs: StartedRun[], repoId: string | undefined, installed: string[], connected: string[]): string | undefined {
  const newest = (list: StartedRun[]): string | undefined => list.filter((run) => installed.includes(run.app)).sort((a, b) => b.at.localeCompare(a.at))[0]?.app;
  return newest(runs.filter((run) => run.repoId === repoId)) ?? newest(runs) ?? installed.find((app) => connected.includes(app)) ?? installed[0];
}
