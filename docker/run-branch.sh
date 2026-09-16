#!/bin/bash
# Per-branch isolation: 1 container per branch (max 3). Falls back to worktree if docker absent.
# Usage: run-branch.sh <repoDir> <branch> <cmd...>
set -e
REPO="$1"; BR="$2"; shift 2
if ! command -v docker >/dev/null; then echo "no-docker: run locally in $REPO"; exec "$@"; fi
TAG="pi-harness-$BR"
docker build -q -f "$(dirname "$0")/branch.Dockerfile" -t "$TAG" "$REPO" >/dev/null
exec docker run --rm -v "$REPO:/w" -w /w "$TAG" "$@"
