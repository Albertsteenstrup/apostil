---
name: apostil-describe-change
description: Use at the end of each task that changed files in a Git repo. It makes subagents write and check a change file that tells the owner what the change does, in parts, notes and diagrams. Also use it when you open or update a pull request, and when the owner asks what changed: it gives the one line that links to Apostil.
---

# Describe a change

Apostil shows the owner a change as parts, notes beside code lines, and diagrams. A change file holds that description. You do not write it yourself. A writer subagent writes it. Fresh subagents check it, one for each part. The command `apostil` does the saving and the checks.

Do this at the end of each task that changed files. Skip it when no file changed.

## On a main branch with nothing uncommitted

On `main` (or `master`), the change is only what is not committed yet. After a commit, nothing is left. Then:

- When the user names a commit, or says "the latest commit": describe from the commit before it. For the latest commit, that is `HEAD~1`. Put this line in the brief: "Add `--base HEAD~1` to `apostil material`, `apostil check` and `apostil save`." Use the commit before the one that the user named in place of `HEAD~1`.
- When the user asks for notes, or for notes and diagrams, and names no commit: notes do not need a change. Notes on the code as it is come with the map. Use the skill `apostil-map-repo`. Do not ask him for a commit.
- When the user asks to describe a change and names no commit: tell him "No file changed, so there is no change to describe. Shall I describe the latest commit?" Write nothing.

## Step 1: Write a brief

Write 3 to 6 lines for the writer. Include:

- The reason for the change. This is the one thing the writer cannot find in the code.
- The broader diagrams that the change alters. Find them with the skill `apostil-read-diagrams`. Name each by its id. If none changes, write "No broader diagram changes."
- The name of your session, when your app shows one (the title of the chat). The writer saves it with `--session-name`.

Do not paste code or the chat into the brief.

## Step 2: Start the writer subagent

Use the newest small model that the app offers. Do not use a fixed model name. Notes and the diagram of one function are local work: the writer reads the changed code line by line, and a small model does that well. The overview of the whole repo is the work of the skill `apostil-map-repo`, which uses a medium or large model for it.

Give the writer:

- the brief,
- the full text of `writer-prompt.md` and of `text-rules.md` (both in this folder),
- the path of the worktree.

The writer writes its JSON to `apostil-draft.json` in the top folder of the repo, and saves it with `apostil save apostil-draft.json`. The command removes the file when the save worked. Wait until it reports that the file is saved.

## Step 3: Start the fresh checkers

The writer's report names the parts that have notes and the parts that a link leaves. Start one checker for each of those parts, all at the same time. Each checker is a new subagent with fresh context, on the same small model. One part for each checker keeps its input small, and the checks finish sooner.

The fresh check must stay fresh. Give each checker these things and nothing else:

- the full text of `fresh-check-prompt.md` (in this folder),
- the path of the worktree,
- the id of its part.

Do not give it the brief, the writer's report, the chat, or your own opinion of the change. It must judge the notes against the code alone. Do not start it as a fork of your context. A checker that knows your reasons will excuse a wrong note.

Each checker saves its open points with `apostil open-points`, and marks each diagram it read, and the links that leave its part, with `apostil checked`. The owner sees them in Apostil.

The fresh check is a part of every description, not an extra. Each node and arrow of a diagram, and each link between parts, points at code, but the save only checks that the lines exist, not that they do what the diagram says. Only a reader who did not write the diagram can say that. The page says beside the title of each diagram, also of the diagram of the change, whether it was checked, so a description with no fresh check says "not checked yet".

## Which agent made the change

`apostil save` stores the agent's session with the change, so that the owner can open the session from Apostil. In Claude Code it reads the session from the environment. An app other than Claude Code passes `--agent <app>` (`codex`, `antigravity` or `opencode`), `--session <id>` and `--account <name>` to `apostil save` when it knows them. The writer needs no change to do this.

## Step 4: Report

Tell the owner in 2 or 3 lines: the change is saved, what the writer left open (if anything), and how many open points the checkers stored. Do not repeat the change file. End with the line of "Links to Apostil", when it asks for one.

## Links to Apostil

One quiet line takes the owner from a pull request or a report to Apostil. Write it at most once for one pull request or change in a session. When `apostil link` prints nothing, the owner turned the links off: write no line.

- **A pull request.** When you open or update a pull request, the first line of its description is what `apostil link --pr --markdown` prints, then an empty line, then the rest. With no number the link names the pull request of this branch, so it works before the pull request exists. When the description already starts with a line that holds "Read this change in Apostil", replace that line. Never add a second one. Pass the description with `--body-file` to `gh pr create` or `gh pr edit`.
- **The end of your report.** After you open or update a pull request: one line `[Read #12 in Apostil](<link>)`, with the link that `apostil link --pr 12` prints. After a change with no pull request of 3 or more files or 150 or more changed lines (`git diff --shortstat` against the base, uncommitted work included): one line `[Read this change in Apostil](<link>)`, with the link that `apostil link --change` prints. After a smaller change: no line.
- **"What changed?"** When the owner asks what changed, for the diff or for a review: answer in a few short sentences, then give the link that `apostil link --change` prints. Do not paste a long diff.

## When the app has no subagents

Tell the owner: "This app has no subagents, so I did not write the change file." Do not write it yourself. Do not run the fresh check in your own context: a check by the agent that wrote the code is not fresh.

## Rules for the text

All text in a change file follows `text-rules.md` (in this folder).
