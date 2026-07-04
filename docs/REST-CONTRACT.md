# REST contract — agentmemory endpoints this extension depends on

> **This document is the updatability anchor.** It records the exact HTTP
> surface `pi-agentmemory` calls. When agentmemory evolves, run
> `npm test` (see `test/contract.smoke.js`); if it fails, this contract drifted —
> update the code here to match.

- **Validated against:** `@agentmemory/agentmemory` **v0.9.27**
- **Default base URL:** `http://localhost:3111` (override with `AGENTMEMORY_URL`)
- **Auth:** optional bearer token via `AGENTMEMORY_SECRET` (only enforced for
  non-loopback HTTP — see `extensions/security.ts`)

## Endpoints

All paths are under `${AGENTMEMORY_URL}/agentmemory/`.

### 1. `GET /health`

Health probe. Polled on session start to set the pi status line.

**Response 200** (fields we read — the full payload is larger):
```jsonc
{
  "status": "healthy",            // top-level status string (also accepts "ok")
  "version": "0.9.27",
  "health": { "status": "healthy" } // nested form, used as fallback
}
```
**We consider healthy when:** `status === "healthy"` OR `health.status === "healthy"`.

### 2. `POST /smart-search`

Semantic + keyword recall. Called on every `before_agent_start` (top-5 by the
user's prompt) and by the `memory_search` tool.

**Request:**
```json
{ "query": "string", "limit": 5 }
```
**Response 200:**
```jsonc
{
  "results": [
    {
      "obsId": "obs_xxx",
      "score": 0.016,
      "title": "Memory title",
      "type": "conversation",
      "narrative": "optional body text",
      "sessionId": "...",
      "timestamp": "ISO-8601"
    }
  ],
  "mode": "compact",
  "lessons": []
}
```
We read `results[].{title, narrative, type, score}`. `combinedScore` is used as
a fallback for `score` when present.

### 3. `POST /remember`

Stores a durable memory. Called by the `memory_save` tool.

**Request:**
```json
{ "content": "string", "type": "fact" }
```
**Response 201 (Created):** any JSON object. We only check the HTTP status is
2xx (`response.ok`) and the body is non-null (null ⇒ failure).

### 4. `POST /observe`

Telemetry hook. Called fire-and-forget on `agent_end` to persist the turn.

**Request:**
```json
{
  "hookType": "post_tool_use",
  "sessionId": "string",
  "project": "string (cwd)",
  "cwd": "string",
  "timestamp": "ISO-8601",
  "data": {
    "tool_name": "conversation",
    "tool_input": "string (truncated 500 chars)",
    "tool_output": "string (truncated 4000 chars)"
  }
}
```
Response is not inspected (fire-and-forget).

## Versioning policy

When bumping the validated version:
1. Re-run `npm test`.
2. Update the **Validated against** line at the top.
3. Note any field additions/removals in the endpoint examples above.
4. Update `package.json` description / CHANGELOG if behaviour changed.
