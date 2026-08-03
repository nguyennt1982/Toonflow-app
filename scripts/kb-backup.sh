#!/usr/bin/env bash
# Backs up the knowledge base (embedding stores + manifest) to origin/kb-index.
# Survives container teardown: a fresh container can restore with kb:restore.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ORIGIN_URL="$(git remote get-url origin)"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

echo "[kb:backup] ensuring embeddings are fresh..."
yarn index:embed

SNAPSHOT_DIR="/tmp/kb-wt"
rm -rf "$SNAPSHOT_DIR"
git clone -q "$ROOT" "$SNAPSHOT_DIR"
cd "$SNAPSHOT_DIR"

git checkout -q --orphan kb-index
git rm -rfq . >/dev/null 2>&1 || true

mkdir -p .opencode/index/embeddings
cp -r "$ROOT/.opencode/index/embeddings/." .opencode/index/embeddings/
cp "$ROOT/.opencode/index/embeddings.manifest.json" .opencode/index/ 2>/dev/null || true
cp "$ROOT/.opencode/index/embeddings.meta.json" .opencode/index/ 2>/dev/null || true

git add -f .opencode/index
git commit -q -m "kb-index snapshot $TS"
git push -q --force "$ORIGIN_URL" kb-index

echo "[kb:backup] pushed $(git rev-parse --short HEAD) -> $ORIGIN_URL kb-index"
