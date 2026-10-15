# 🏘️ Claude Agent Town

Watch your Claude Code agents and sub-agents run around a little pixel town while they work.

Every main session is a crowned villager. Every sub-agent it spawns pops out of the **Spawn Portal**,
linked to its parent by a dashed line. Each agent walks to the building that matches what it's doing right now:

| Doing | Goes to |
| --- | --- |
| Read / Grep / Glob, `cat`, `rg`, `ls`… | 📚 Library |
| Edit / Write | 🛠️ Workshop |
| Bash (builds, scripts), MCP tools | 💻 Terminal Lab |
| Test commands (`npm test`, `dotnet test`, `pytest`…) | 🧪 Test Lab |
| `git` / `gh` | 📮 Git Post Office |
| WebSearch / WebFetch / browser tools | 🔭 Observatory |
| Thinking, planning, todos | 🌳 Thinking Garden |
| Replying, asking you questions, receiving a prompt | 🏛️ Town Hall |
| Launching a sub-agent (`Agent` / `Task`) | 🌀 Spawn Portal |
| Waiting for you, finished, idle | ☕ Lounge |

Click an agent (or a row in the side panel) to see its brief, model, context size, and a live log of what it's been doing.

## Run it

Needs Node 18+. No dependencies.

```bash
npm start            # watch your real sessions → http://localhost:4777
npm run demo         # simulated agents, to see it busy
node server.js --open --hours 24 --port 4777
```

Options:

- `--dir <path>`: Claude projects folder (default `~/.claude/projects`, or `$CLAUDE_CONFIG_DIR/projects`)
- `--hours <n>`: only load sessions touched in the last *n* hours (default 12)
- `--demo`: write fake transcripts to a temp folder and watch those instead
- `--open`: open the browser
- `--ado-org <org>`: list your open Azure DevOps pull requests in the side panel (or `AZURE_DEVOPS_ORG`). Auth uses `AZURE_DEVOPS_PAT` (Code: Read) if set, otherwise an `az` CLI token; pass `--ado-tenant` (or `AZURE_DEVOPS_TENANT`) if the org lives in a different tenant from your default `az` login. Refreshes every minute.

Any of these environment variables can go in a `.env` file next to `server.js` instead (it's gitignored): `cp .env.example .env` and fill it in.

The server binds to `127.0.0.1` only, since transcripts contain your prompts and code.

## Dashboard

`/dashboard` (or **Dashboard →** in the town's panel) shows the same live data as a table view:

- **Needs your attention**: sessions waiting on you, reviews you owe, PR nudges, stories whose board column doesn't match the work, and stale branches with local changes.
- **Run rate**: points done vs the rate still required per working day, with a cricket-style worm chart.
- **Sprint**: your backlog items in a team's current iteration (set `AZURE_DEVOPS_PROJECT` and `AZURE_DEVOPS_TEAM`), grouped by board column.
- **Pull requests**: yours, and the ones waiting on your review.
- **Team delivery**: the whole team's sprint by stage, blocked items, and a per-member breakdown.

Work item ids in branch names and PR titles (e.g. `story/76812-…`) link sessions, repos and PRs to their sprint story; the server also reads each Claude Code workspace's git state to spot board drift and stale branches.

## How it works

Claude Code writes every session as JSONL:

```
~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl                          main agent
~/.claude/projects/<encoded-cwd>/<sessionId>/subagents/agent-<id>.jsonl     sub-agent
~/.claude/projects/<encoded-cwd>/<sessionId>/subagents/agent-<id>.meta.json type, description, spawning tool call
```

`lib/watcher.js` tails those files, classifies each `tool_use` / `thinking` / `text` block into an activity,
and links sub-agents to their parent via the `Agent` tool result's `agentId` (falling back to the meta file's
`toolUseId`, then the session). `server.js` streams snapshots over SSE, and `public/app.js` draws the town on a canvas.

Agents with no writes for 3 minutes are shown as idle; finished sub-agents nap in the Lounge for 10 minutes
before leaving (tick **Show old sessions** to keep everyone).
