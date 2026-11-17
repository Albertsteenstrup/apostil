# Apostil skills

These skills tell coding agents how to use Apostil. Each skill is a folder with a `SKILL.md` file.

| Skill | Use |
|---|---|
| `apostil-describe-change` | At the end of a task: a writer subagent writes the change file, and fresh subagents check it, one for each part. On `main` after a commit: "Describe the latest commit" describes it with `--base HEAD~1`. |
| `apostil-read-diagrams` | While working: read diagram titles and one diagram instead of a large file. |
| `apostil-review-remarks` | When the owner says "address my remarks": act on each remark and answer it. |
| `apostil-report-issue` | When a person asks to give feedback or create an issue about Apostil, or complains about a part of it: ask once, write the issue with made-up names and no private details, show all of it, and after a yes open GitHub's page with `apostil issue --open`. The person submits it. |
| `apostil-map-repo` | When the owner asks for the map of a repo, or Home has none: an overview writer on a medium or large model draws the top diagram, and a small-model writer draws the diagram of each large area, and then small-model notes writers, one for each group of about 900 lines, write the notes of every code file. These notes show beside the code also when no change is described. Then medium-model process writers, one for each area, write the processes of the repo: each job of the code from its start to its result, whose steps are those notes, across files. They correct wrong notes and add missing ones in the same save, and a last round puts each note that is left into a process or sets it aside with a reason. Then small-model service writers mark each line where the code reaches a service, with the service's own icon, so its icon stands on the nodes and notes that hold the line. The default look applies unless the owner asks for another one; then the main agent writes the look of the repo (`look-writer-prompt.md`), and a set of marks that the look adds gets its own mark writers (`mark-writer-prompt.md`). Later runs keep the look. A second run writes only the files that need notes or marks and the groups with work left. |
| `apostil-uninstall` | When the owner asks to uninstall, remove or get rid of Apostil: it runs `apostil uninstall` at once (with `--delete-data` only when he asked to delete his data too) and reports what it removed and what is left. With no `apostil` command, it uninstalls the extension, whose cleanup runs at the editor's next start. |

The skills use the command `apostil` and the helper tools. The `apostil` command must be on the path of the agent's shell. Section 4 of `docs/change-file-format.md` lists the commands.

## Set up in one step

In VS Code, answer the first question of Apostil with "This repo" or "All repos". Later, run "Apostil: Set up for agents". In a terminal, the same is:

    apostil setup          # for the repo of this folder
    apostil setup --all    # for every repo

Setup does two things:

- It puts the command `apostil` on the path (VS Code only; in a terminal the command is there already).
- It copies the skills to the folders where each agent app reads them. For one repo: `.claude/skills/` (Claude Code) and `.agents/skills/` (Codex) of the repo. For all repos: `~/.claude/skills/` and `~/.agents/skills/`. It does this only for an app that is on the computer: its command (`claude`, `codex`) is on the path, or its folder (`~/.claude`, `~/.codex`) is there.

Setup does not add the hook of Claude Code. That is a step of its own (`connect-claude-code.md`).

For one repo, Git does not show what setup adds: setup lists it in `.git/info/exclude`, which is not shared. When `.claude/skills` or `.agents/skills` is a link to another folder of the repo, the lines name that folder, where the copies really are.

Setup copies the skills; it does not link them. The folder of the extension gets a new name with each update, so a link would break. Each copy holds a file `.apostil-version`. After an update, VS Code makes the old copies new, and `apostil setup` does the same. A folder of the same name that Apostil did not put there stays as it is, and setup says so.

Then ask your agent: "Map this repo for Apostil." It draws the map on Home and writes notes beside the code. For a change at the end of a task, ask: "Describe this change for Apostil."

- `apostil doctor` says what is missing, and the step that corrects it. It writes nothing, and you can paste its output into feedback.
- To report a fault or say what you think: ask your agent, or run "Apostil: Report an Issue" in VS Code. Both open GitHub's page for a new issue with the versions filled in, and you submit it yourself.
- `apostil setup --undo` (or `apostil setup --all --undo`) takes away what setup added, and nothing else. It also takes away the hook, when Apostil added it, also with an earlier version.

## Open a change in Apostil

Apostil adds one quiet line where you meet a change. Nothing pops up.

- When the agent opens or updates a pull request, the first line of its description is "Read this change in Apostil", and the agent's report ends with "Read #12 in Apostil". After a larger change with no pull request, the report ends with "Read this change in Apostil". When you ask what changed, the agent answers in a few words and gives that link. `apostil link --pr` and `apostil link --change` print the links. A link opens VS Code. The browser may ask first, and VS Code asks once whether Apostil may open links.
- In VS Code, the title of Source Control has Apostil's icon. It opens the change of the branch.
- `apostil links off` turns these lines, links and the icon off, and `apostil links on` turns them on again. In VS Code the same is "Apostil: Turn off links and nudges". `APOSTIL_NO_LINKS=1` also turns them off.

### The Claude mod

When a command of the agent opens or edits a pull request, the mod shows one band above the prompt of Claude Code: "#12 · Read it in Apostil", with a ×. It shows once for each pull request. It needs the command `apostil` on the path, and it follows the switch above. Install it at the prompt of Claude Code in a terminal:

    /plugin install apostil --marketplace Albertsteenstrup/apostil

Answer `y` to add the marketplace, then pick a scope. From a shell: `claude plugin install apostil --marketplace Albertsteenstrup/apostil`. In the desktop app: click + next to the prompt, then Plugins, Add marketplace with `Albertsteenstrup/apostil`, then Add plugin. This works once the repo is public. The mod is in `claude-mod/`.
## Uninstall

    apostil uninstall --dry-run      # lists what it would remove, and changes nothing
    apostil uninstall                # removes Apostil, and keeps your data
    apostil uninstall --delete-data  # removes your data too

It takes away, in this order: the setup of every repo where `apostil setup` or `apostil connect` ran (the store keeps a list of them, and `apostil doctor` shows it) and of the home folder, VS Code's storage of the extension, Apostil's settings in VS Code, the Claude mod, the command `apostil`, and the extension. It touches only what Apostil wrote, and prints one line for each place: removed, left (and why), kept or nothing. The store `~/.apostil` holds your maps, notes and described changes. It stays unless you add `--delete-data`.

In VS Code, "Apostil: Uninstall…" does the same after one question. You can also ask your agent: "Uninstall Apostil." Then restart VS Code and the agent apps.

An uninstall in the Extensions view of VS Code (or `code --uninstall-extension apostil.apostil`) also cleans up when VS Code starts again: everything except the data folder `~/.apostil`. After `code --uninstall-extension`, VS Code 1.145 runs the cleanup at its second start; the first start only marks the extension as removed.

## The manual way

### Make an agent app see the skills

Each app reads skills from fixed folders. Link the skill folders there. A link keeps one copy of each skill. Use the same steps for each app and replace `<folder>`.

    ln -s "$(pwd)/skills/apostil-describe-change" <folder>/apostil-describe-change
    ln -s "$(pwd)/skills/apostil-read-diagrams" <folder>/apostil-read-diagrams
    ln -s "$(pwd)/skills/apostil-review-remarks" <folder>/apostil-review-remarks
    ln -s "$(pwd)/skills/apostil-map-repo" <folder>/apostil-map-repo
    ln -s "$(pwd)/skills/apostil-report-issue" <folder>/apostil-report-issue
    ln -s "$(pwd)/skills/apostil-uninstall" <folder>/apostil-uninstall

`apostil-describe-change` and `apostil-map-repo` hold more files that their `SKILL.md` names. Link or copy the whole folder.

#### Claude Code

- Personal folder, all projects: `~/.claude/skills/<skill-name>/SKILL.md`.
- Project folder: `.claude/skills/<skill-name>/SKILL.md`.
- A skill entry can be a symlink to a folder elsewhere.
- Source: https://code.claude.com/docs/en/skills

#### Codex

- Repository folder: `.agents/skills`, read from the launch folder up to the repository root.
- User folder: `$HOME/.agents/skills`.
- Codex follows symlinked skill folders.
- Source: https://learn.chatgpt.com/docs/build-skills (the old address, https://developers.openai.com/codex/skills, redirects there).

#### Antigravity

- Workspace folder: `<workspace-root>/.agents/skills/<skill-folder>/`. Parent folders up to the repository root are read too. The older `.agent/skills` still works.
- Global folder: `~/.gemini/config/skills/<skill-folder>/`.
- The IDE also reads the older global folder `~/.gemini/antigravity/skills/`.
- Source: https://antigravity.google/docs/skills

## What I could not confirm

- Antigravity: its page does not mention symlinks. Copy the folders instead of linking them, or test a link first.
- Third-party pages give other global folders for Antigravity. Only the folders on the official page are listed above.
- The three docs pages were read on 10 November 2026 and may change.
- No app was tested with these skills. Nobody has checked yet that each app loads them.
- Setup handles Claude Code and Codex. For Antigravity and OpenCode, use the manual way.
- How each app starts the Apostil helper (MCP) is not covered here. The skills also work with the `apostil` command alone.
- The band of the Claude mod was checked with `claude plugin test` only, not yet in a real session. A press on its link is not seen by the mod, so the band stays until ×; it does not come back for that pull request.
