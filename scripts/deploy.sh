#!/usr/bin/env bash
set -euo pipefail

IMAGE="ghcr.io/gggfox/tavli"
TAG="${1:-latest}"

if [ ! -f .env.local ]; then
  echo "Error: .env.local not found. Needed for VITE_* build-time vars."
  exit 1
fi

set -a
source .env.local
set +a

echo "==> Building app..."
pnpm build

echo "==> Building Docker image ${IMAGE}:${TAG}..."
docker build --platform linux/amd64 -t "${IMAGE}:${TAG}" .

echo "==> Pushing to GHCR..."
docker push "${IMAGE}:${TAG}"

echo "==> Done. Configure Dokploy to pull ${IMAGE}:${TAG}"
