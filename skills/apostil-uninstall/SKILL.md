---
name: apostil-uninstall
description: Use when the person asks to uninstall Apostil, remove Apostil, get rid of Apostil, or stop using Apostil. It removes everything that Apostil put on the computer. Never use it for another tool.
---

# Uninstall Apostil

1. Run `apostil uninstall`. Do not run a dry run first, and do not ask first.
   - Add `--delete-data` only when the person asked, in their own words, to delete their Apostil data too. Otherwise the data stays: the command keeps it.
2. Report its lines in short words: what it removed, and what is left and why. Do not remove a `left` thing unless the person asks.
3. Tell the person to restart VS Code and the agent apps (Claude Code, Codex).

## When `apostil` is not on the path

Run `code --uninstall-extension apostil.apostil`, or the editor's own command (`cursor`, `code-insiders`, `codium`, `windsurf`, `antigravity`). The editor then runs Apostil's cleanup when it starts again; after this command VS Code runs it at its second start. Its data stays. Tell the person to restart the editor twice.

Only when no such command exists, remove these by hand, and only what Apostil wrote:

- The extension: in the editor, Extensions, Apostil, Uninstall.
- Skills: each folder in `~/.claude/skills`, `~/.agents/skills`, and in `.claude/skills` and `.agents/skills` of a repo, that holds a file `.apostil-version`.
- The hook: each entry with the command `apostil inbox --wait` in `~/.claude/settings.json` and in `.claude/settings.local.json` of a repo.
- Git: in `.git/info/exclude` of a repo, the lines of those skill folders, the lines that start with `/apostil-`, and `.claude/settings.local.json`.
- The command `apostil` in `/opt/homebrew/bin`, `/usr/local/bin` or `~/.local/bin`, when it is a link to `out/store/cli.js` or a script that says "Written by Apostil".
- The Claude mod: in Claude, Plugins, remove apostil and its marketplace.
- The data `~/.apostil`: only when the person asked. To delete it: `rm -r ~/.apostil`.
