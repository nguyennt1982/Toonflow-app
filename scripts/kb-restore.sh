#!/usr/bin/env bash
# Restores the knowledge base from origin/kb-index, then rebuilds derived
# indexes. Run this in a fresh container before doing knowledge work.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ORIGIN_URL="$(git remote get-url origin)"
WORK="/tmp/kb-restore"

echo "[kb:restore] fetching snapshot from $ORIGIN_URL kb-index..."
rm -rf "$WORK"
mkdir -p "$WORK"
git -C "$WORK" init -q
git -C "$WORK" remote add origin "$ORIGIN_URL"
git -C "$WORK" fetch -q origin kb-index
git -C "$WORK" reset -q --hard FETCH_HEAD

mkdir -p "$ROOT/.opencode/index/embeddings"
cp -r "$WORK/.opencode/index/embeddings/." "$ROOT/.opencode/index/embeddings/"
cp "$WORK/.opencode/index/embeddings.manifest.json" "$ROOT/.opencode/index/" 2>/dev/null || true
cp "$WORK/.opencode/index/embeddings.meta.json" "$ROOT/.opencode/index/" 2>/dev/null || true

echo "[kb:restore] rebuilding derived indexes..."
yarn index:generate
yarn index:embed
yarn index:check
