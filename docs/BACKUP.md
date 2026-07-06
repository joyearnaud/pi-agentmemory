# Backup strategy

`pi-agentmemory` ships a file-level backup of the agentmemory store, callable
two ways from any pi session:

- **Tool** `memory_backup` (LLM-callable; e.g. *"back up memory before this risky change"*)
- **Command** `/agentmemory-backup [--dry-run]`

Both spawn the bundled [`scripts/agentmemory-backup.sh`](../scripts/agentmemory-backup.sh).

## What it does

1. `tar -czf` of `~/.agentmemory/{data/, .env, preferences.json}` → `~/Backups/agentmemory/agentmemory-<timestamp>.tar.gz`
   (only entries that exist; `data/` is required).
2. Rotates local archives — keeps the newest **7**.
3. If `AGENTMEMORY_BACKUP_REMOTE` is set, `rsync -av --delete` the local backup
   dir to that target. **Remote failure is non-fatal** — the local archive still counts as success.

Runtime files (`iii.pid`, `worker.pid`, `engine-state.json`, `bin/`) are intentionally
excluded — they're machine/process-specific.

## Configuration (env vars, all optional)

| Var | Default | Purpose |
|---|---|---|
| `AGENTMEMORY_BACKUP_SOURCE` | `~/.agentmemory` | source dir |
| `AGENTMEMORY_BACKUP_DIR` | `~/Backups/agentmemory` | local archive dir |
| `AGENTMEMORY_BACKUP_REMOTE` | *(empty = local only)* | rsync target, e.g. `nasj:/volume1/docker/backups/agentmemory` |
| `AGENTMEMORY_BACKUP_KEEP` | `7` | local archives to keep |
| `AGENTMEMORY_BACKUP_SCRIPT` | *(empty = bundled)* | override: path to a custom script |

To set these permanently, put them in `~/.zshenv` (or your shell profile).

## Restore

```bash
agentmemory            # ensure the server is installed
# stop the running server first (avoids overwriting live files):
launchctl unload ~/Library/LaunchAgents/com.agentmemory.server.plist   # if you use the launchd server

mkdir -p /tmp/am-restore && tar -xzf ~/Backups/agentmemory/agentmemory-<timestamp>.tar.gz -C /tmp/am-restore
cp -R /tmp/am-restore/data ~/.agentmemory/
cp /tmp/am-restore/.env ~/.agentmemory/.env 2>/dev/null || true
cp /tmp/am-restore/preferences.json ~/.agentmemory/preferences.json 2>/dev/null || true

launchctl load ~/Library/LaunchAgents/com.agentmemory.server.plist   # restart
```

## Scheduling (optional, OS-specific)

The extension does **not** install a scheduler — that belongs to your OS/dotfiles.
On macOS, a `LaunchAgent` running the bundled script daily is the recommended setup:

```xml
<!-- ~/Library/LaunchAgents/com.arnaudjoye.agentmemory-backup.plist -->
<key>ProgramArguments</key>
<array>
  <string>/absolute/path/to/pi-agentmemory/scripts/agentmemory-backup.sh</string>
</array>
<key>StartCalendarInterval</key>
<dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>15</integer></dict>
```

Set `AGENTMEMORY_BACKUP_REMOTE` in the plist's `EnvironmentVariables` to enable the offsite copy.

## Caveats

- **Hot backup.** The script runs while the agentmemory server is up. The store is a
  directory of `.bin` files; a backup taken mid-write is best-effort. Schedule backups
  in a low-write window (e.g. 03:15) to mitigate. For a guaranteed-consistent snapshot,
  prefer agentmemory's native `memory_export` / `memory_snapshot_create` endpoints instead.
- **This is file-level, not the REST API** — it backs up the on-disk store directly,
  independent of the [REST contract](./REST-CONTRACT.md) the memory tools depend on.
- **`.env` may hold API keys.** Only set `AGENTMEMORY_BACKUP_REMOTE` to a host you trust.
- **Synology NAS:** if rsync fails with a missing-binary error, your rsync lives at
  `/usr/bin/rsync` — wrap with your own `--rsync-path` (the generic script doesn't hardcode it).
- **Windows:** needs WSL (`tar`/`rsync`).
