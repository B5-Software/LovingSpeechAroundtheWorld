#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

log "Stopping all pm2 processes..."
pm2 stop all || log "pm2 stop all reported an issue (continuing)."

log "Fetching latest origin/main..."
git fetch origin

log "Merging origin/main into current branch..."
git merge origin/main

log "Starting pm2 processes..."
pm2 start all

log "Saving pm2 process list..."
pm2 save

log "Update complete."
