# Update guide

How to keep `pi-agentmemory` working as `agentmemory` evolves.

## The 60-second check

```bash
agentmemory          # ensure the server is running
cd ~/Project/pi-agentmemory
npm test             # contract smoke test against the live server
```

- **Green** ⇒ the 4 endpoints we depend on still match `docs/REST-CONTRACT.md`. Ship on.
- **Red** ⇒ contract drift. See below.

## When agentmemory ships a new version

```bash
npm install -g @agentmemory/agentmemory@latest   # or: npx @agentmemory/agentmemory@latest
agentmemory                                       # restart server on the new version
cd ~/Project/pi-agentmemory && npm test
```

### If the smoke test fails

1. Open `docs/REST-CONTRACT.md` — that is the spec of what we call.
2. Probe the live server to see the new shape, e.g.:
   ```bash
   curl -s http://localhost:3111/agentmemory/health | jq
   curl -s -X POST http://localhost:3111/agentmemory/smart-search \
     -H 'Content-Type: application/json' -d '{"query":"test","limit":2}' | jq
   ```
3. Update `extensions/index.ts` to match the new shape.
4. Update `docs/REST-CONTRACT.md` examples + the **Validated against** version.
5. Re-run `npm test` until green.
6. Bump `package.json` version, commit, tag, push.

## When pi evolves

If pi's `ExtensionAPI` changes (event names, `registerTool` signature, `ctx.ui`):

1. Check the pi docs: `pi` packages → `extensions.md` (events, `ExtensionAPI`).
2. Update `extensions/index.ts`. The three hooks we use: `session_start`,
   `before_agent_start`, `agent_end`. The three tools: `memory_health`,
   `memory_search`, `memory_save`.
3. Smoke-test by running pi with the local package:
   ```bash
   pi -e ~/Project/pi-agentmemory
   ```
   then call `memory_health` from a session.

## Releasing a new pinned ref for users

```bash
git tag v0.X.0 && git push origin v0.X.0
```
Users update with:
```bash
pi install git:github.com/joyearnaud/pi-agentmemory@v0.X.0
```
