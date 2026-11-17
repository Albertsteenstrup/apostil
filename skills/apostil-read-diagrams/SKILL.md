---
name: apostil-read-diagrams
description: Use before you read a large file or a whole folder in a repo that Apostil describes. List the diagram titles and open one diagram instead of loading the code.
---

# Read diagrams instead of large files

Apostil keeps diagrams of the code: flow charts, sequence diagrams and state diagrams. Each one is small and shows how a function, a part or a setup works. A diagram costs far less context than the file it describes. Read the diagram first. Read the file only when the diagram does not answer your question.

## Steps

1. Before you open a large file, list the diagram titles for its folder.
   - Command: `apostil diagrams --path <folder>` (the path is a prefix of repo paths).
   - Helper tool: `diagram_titles` with `folder` set to your worktree.
   - You get one short line for each diagram: its id, its kind, its title and what it explains.
2. Pick the one diagram whose title matches your question.
   - Command: `apostil diagram <id>`.
   - Helper tool: `show_diagram` with `folder` and the diagram id.
   - You get the diagram and the code lines of its function.
3. Answer from the diagram. Open the file only for the lines that you still need.

## Rules

- Open at most 2 or 3 diagrams for one question. Never load all diagrams at once. The list of titles exists so that you do not have to.
- Do not list titles for the whole repo when you know the folder. Use `--path`.
- If the list is empty, or no title fits, read the file as you would without Apostil.
- A diagram can be out of date when the code changed after it was saved. Check its code lines when the answer matters.

## Why

The owner reviews with these diagrams. When you use the same diagrams, your picture of the code matches his. You also spend less context on code that your task does not touch.

## Broader diagrams and a change

At the end of a task, the skill `apostil-describe-change` asks you which broader diagrams your change alters. Use this skill to find them: list the titles for the folders that you changed and open the ones that your change touches.
