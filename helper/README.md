# The Apostil helper

A small program that an agent app starts. It speaks MCP over standard input and output and has six tools:

| Tool | Gives |
|---|---|
| `answer_remark` | Stores the agent's answer to one remark and marks the remark done. |
| `review_context` | The open change, what the owner has open and selected, the unsent remarks, the open points. |
| `diagram_titles` | One short entry for each diagram of the repo. |
| `show_diagram` | One diagram in full, with its code lines. |
| `map_overview` | The plain text of `apostil overview`: the top diagram of the map, its other diagrams, the counts and the next commands. |
| `find_in_map` | The plain text of `apostil find <words>`: the notes, processes and diagrams of the map that match, best first (`limit`: the most notes, 20 by default). |

Each tool takes `folder`, the worktree of the agent. The agent calls a tool when it needs the answer; nothing is pushed.

Build first with `npm run build`. The program is then `out/helper/helper.js`. Use its absolute path below (`/path/to/apostil`). The helper reads the store in `~/.apostil`; set `APOSTIL_HOME` only to use another folder.

Try it by hand:

```
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}' | node out/helper/helper.js
```

## Which MCP version

The helper speaks the `initialize` handshake of MCP 2025-11-25 and earlier. The current version of the specification, 2026-07-28, has no handshake; it tells a client to try `server/discover` first and to fall back to `initialize` when a server answers with an error, which this helper does. A client that speaks only the new version cannot use the helper.

No agent app was tried with the helper yet. In a test folder with a `.mcp.json`, Claude Code 2.1.319 found the entry and waited for the owner's approval.

## Claude Code

Source: https://code.claude.com/docs/en/mcp

```
claude mcp add --transport stdio --scope user apostil -- node /path/to/apostil/out/helper/helper.js
```

`--scope user` makes the helper available in all projects. The same entry in a `.mcp.json` file:

```json
{
  "mcpServers": {
    "apostil": { "command": "node", "args": ["/path/to/apostil/out/helper/helper.js"] }
  }
}
```

Check with `claude mcp list`, or `/mcp` inside Claude Code.

## Codex

Source: https://learn.chatgpt.com/docs/extend/mcp?surface=cli

```
codex mcp add apostil -- node /path/to/apostil/out/helper/helper.js
```

The same entry in `~/.codex/config.toml`:

```toml
[mcp_servers.apostil]
command = "node"
args = ["/path/to/apostil/out/helper/helper.js"]
```

## Antigravity

Source: https://antigravity.google/docs/mcp/

The global file is `~/.gemini/config/mcp_config.json`. A file for one workspace is `<workspace>/.agents/mcp_config.json`. The page shows this entry for a local server:

```json
"apostil": {
  "command": "node",
  "args": ["/path/to/apostil/out/helper/helper.js"]
}
```

Not confirmed: the page example shows only the entry, not the object around it. Other guides wrap entries in `"mcpServers": { ... }`. Open the file in the app (Manage MCP Servers, View raw config) and follow the shape that is already there. I did not test this on a live install.
