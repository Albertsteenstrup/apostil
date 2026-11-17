# Connect Claude Code to Apostil

Apostil adds one entry to a settings file of Claude Code. It is a step of its own: `apostil setup` and "Apostil: Set up for agents" do not add it. The hook was not yet seen working in a session with a person. Three ways add the entry:

- the link "connect Claude Code" under a comment that waits for a session;
- the command "Apostil: Connect Claude Code" in VS Code;
- `apostil connect` in a terminal, in the folder of the repo (`--all-repos` for every repo).

Each asks or says where the entry goes: "This repo" is `.claude/settings.local.json` of the repo, your own file, which Apostil also keeps out of Git's list of new files; "All repos" is `~/.claude/settings.json`. Everything else in the file stays as it is. A session of Claude Code that starts after this uses the entry. To take it out, delete the two blocks from the file. `apostil setup --undo` takes it out together with the skills, also when an earlier version of Apostil added it.

This is the entry:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "apostil inbox --wait", "asyncRewake": true, "timeout": 3600 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "apostil inbox --wait", "asyncRewake": true, "timeout": 3600 }] }
    ]
  }
}
```

What it does: the hook waits in the background for remarks that the owner sent in Apostil. When one arrives, the hook exits with code 2 and its text wakes the session, even an idle one. The agent then follows the skill `apostil-review-remarks`.

The hook never waits in a run with no person. It ends at once when `APOSTIL_NO_WAIT` is set (every run that Apostil starts sets it), or when Claude Code says that nobody is there (`CLAUDE_CODE_SESSION_ATTENDED=0`, or the entry point `sdk-cli`, as in `claude -p`).

Codex and Antigravity have hooks of their own. They are not covered yet.
