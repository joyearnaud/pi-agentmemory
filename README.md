# pi-agentmemory

A [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) extension that bridges
[`agentmemory`](https://github.com/rohitg00/agentmemory) — giving any pi session persistent,
cross-session memory.

> **Unofficial.** agentmemory ships first-class plugins for Claude Code, Codex, and OpenCode,
> but **not for pi**. This extension fills that gap by talking to agentmemory's local REST API
> (`:3111`). It is community-maintained, not affiliated with either project.

## What it does

- Registers three pi tools: `memory_health`, `memory_search`, `memory_save`.
- On `before_agent_start`, recalls top-5 relevant memories and injects them into the system prompt.
- On `agent_end`, persists the turn (fire-and-forget) so future sessions can recall it.
- Sets a pi status line: 🧠 `agentmemory` (on) / `agentmemory off` (unreachable).
- Adds a `/agentmemory-status` command.

## Requirements

- Pi Coding Agent installed.
- `agentmemory` running locally:
  ```bash
  npm install -g @agentmemory/agentmemory
  agentmemory     # starts the memory server on http://localhost:3111
  ```
  Validated against agentmemory **v0.9.27**. See [docs/REST-CONTRACT.md](docs/REST-CONTRACT.md).

## Install

### From git (recommended)

```bash
pi install git:github.com/joyearnaud/pi-agentmemory@v0.1.0
```

### Local path (for development)

```bash
pi install ~/Project/pi-agentmemory
# or run without installing:
pi -e ~/Project/pi-agentmemory
```

Verify inside a pi session: call the `memory_health` tool, or run `/agentmemory-status`.

## Configuration

Environment variables (read at session start):

| Variable | Default | Purpose |
|---|---|---|
| `AGENTMEMORY_URL` | `http://localhost:3111` | agentmemory server base URL |
| `AGENTMEMORY_SECRET` | unset | Bearer token for non-loopback / remote servers |
| `AGENTMEMORY_REQUIRE_HTTPS` | unset | Set `1` to **error** (not just warn) when a secret is sent over plaintext HTTP to a non-loopback host |

> Security: bearer tokens and memory payloads are sent in cleartext over HTTP.
> For remote servers, use HTTPS or an SSH tunnel. The extension warns once if it
> detects a plaintext bearer setup; set `AGENTMEMORY_REQUIRE_HTTPS=1` to make it fatal.

## How it works

```
pi session ──extension──► agentmemory REST (:3111) ──► iii-engine (:49134) ──► SQLite store
                                ▲
                  local Ollama (embeddings + graph extraction)
```

The extension depends on four REST endpoints: `GET /health`, `POST /smart-search`,
`POST /remember`, `POST /observe`. Full contract: [docs/REST-CONTRACT.md](docs/REST-CONTRACT.md).

## Updating

agentmemory evolves fast. The 60-second compatibility check:

```bash
cd ~/Project/pi-agentmemory && npm test
```

Green ⇒ compatible. Red ⇒ contract drift — see [docs/UPDATE-GUIDE.md](docs/UPDATE-GUIDE.md).

To move users to a new version:
```bash
git tag v0.X.0 && git push origin v0.X.0
pi install git:github.com/joyearnaud/pi-agentmemory@v0.X.0
```

## Layout

```
extensions/
  index.ts        # the extension (tools, hooks, status)
  security.ts     # plaintext-bearer auth guard
docs/
  REST-CONTRACT.md   # the HTTP surface we depend on (updatability anchor)
  UPDATE-GUIDE.md    # procedure when agentmemory or pi evolves
test/
  contract.smoke.js  # canary: exercises the 4 endpoints, fails on drift
```

## License

Apache-2.0 — matching upstream agentmemory.
