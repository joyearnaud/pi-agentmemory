#!/usr/bin/env bash
# agentmemory-backup.sh — file-level backup of the agentmemory store.
#
# Genericized: all tunables via env vars. Bundled with pi-agentmemory.
# Archives data/ + .env + preferences.json (existing entries only) to a local
# tar.gz, rotates old local archives, then optionally rsyncs to a remote.
#
# Usage: agentmemory-backup.sh [--dry-run]
#
# Env vars (all optional):
#   AGENTMEMORY_BACKUP_SOURCE   source dir          (default: ~/.agentmemory)
#   AGENTMEMORY_BACKUP_DIR      local archive dir   (default: ~/Backups/agentmemory)
#   AGENTMEMORY_BACKUP_REMOTE   rsync target, empty = local only
#                               e.g. nasj:/volume1/docker/backups/agentmemory
#   AGENTMEMORY_BACKUP_KEEP     local archives to keep (default: 7)
#
# NOTE: hot backup — runs while the agentmemory server is up. The store is a
# directory of .bin files; a backup taken mid-write is best-effort. The daily
# 03:15 launchd window (see docs/BACKUP.md) mitigates write contention.
# .env may hold API keys — only set AGENTMEMORY_BACKUP_REMOTE to a trusted host.

set -euo pipefail

SOURCE_DIR="${AGENTMEMORY_BACKUP_SOURCE:-$HOME/.agentmemory}"
LOCAL_BACKUP_DIR="${AGENTMEMORY_BACKUP_DIR:-$HOME/Backups/agentmemory}"
REMOTE="${AGENTMEMORY_BACKUP_REMOTE:-}"
KEEP="${AGENTMEMORY_BACKUP_KEEP:-7}"
LOG_FILE="${LOCAL_BACKUP_DIR}/agentmemory-backup.log"

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

mkdir -p "${LOCAL_BACKUP_DIR}"

log() { echo "[$(date +%Y-%m-%dT%H:%M:%S)] $*" | tee -a "${LOG_FILE}" >&2; }

if [[ ! -d "${SOURCE_DIR}" ]]; then
  log "ERROR: source dir not found: ${SOURCE_DIR}"
  exit 1
fi

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE_NAME="agentmemory-${TIMESTAMP}.tar.gz"
LOCAL_ARCHIVE="${LOCAL_BACKUP_DIR}/${ARCHIVE_NAME}"

# Build the file list from only the entries that exist (data/ is required;
# .env / preferences.json are optional on a fresh install).
ITEMS=()
for item in data .env preferences.json; do
  [[ -e "${SOURCE_DIR}/${item}" ]] && ITEMS+=("${item}")
done

if [[ ${#ITEMS[@]} -eq 0 ]] || [[ ! -e "${SOURCE_DIR}/data" ]]; then
  log "ERROR: no data/ under ${SOURCE_DIR} — nothing to back up"
  exit 1
fi

if ${DRY_RUN}; then
  log "DRY RUN: archive ${ITEMS[*]} from ${SOURCE_DIR} -> ${LOCAL_ARCHIVE}"
  log "DRY RUN: rotate, keep ${KEEP}"
  [[ -n "${REMOTE}" ]] && log "DRY RUN: rsync to ${REMOTE}" || log "DRY RUN: no remote configured"
  exit 0
fi

log "=== agentmemory backup started ==="
log "Creating archive: ${ARCHIVE_NAME} (items: ${ITEMS[*]})"

tar -czf "${LOCAL_ARCHIVE}" -C "${SOURCE_DIR}" "${ITEMS[@]}" 2>&1 | tee -a "${LOG_FILE}" >&2 || {
  log "ERROR: tar failed"
  exit 1
}

# Rotate local: keep newest KEEP
log "Rotating local backups (keep ${KEEP})"
cd "${LOCAL_BACKUP_DIR}"
ls -t agentmemory-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -v 2>&1 | tee -a "${LOG_FILE}" >&2 || true

# Remote sync (non-fatal on failure)
if [[ -n "${REMOTE}" ]]; then
  log "Syncing to remote: ${REMOTE}"
  rsync -av --delete "${LOCAL_BACKUP_DIR}/" "${REMOTE}/" 2>&1 | tee -a "${LOG_FILE}" >&2 \
    || log "WARNING: remote sync failed (local backup still OK)"
fi

log "=== backup finished ==="
ls -lh "${LOCAL_ARCHIVE}" | tee -a "${LOG_FILE}" >&2
echo "${LOCAL_ARCHIVE}"   # last line of stdout = archive path (for tooling)
