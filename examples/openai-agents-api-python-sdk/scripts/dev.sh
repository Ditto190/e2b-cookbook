#!/usr/bin/env bash
# Single entry point: start backend + web together.
# Picks the first free backend port from $PORT/8000 upward (in case another
# process squats :8000) and wires it into both the backend (PORT) and the
# Vite proxy (BACKEND_PORT). Vite bumps its own port when :3000 is busy, so
# nothing to do on the web side.
set -euo pipefail
cd "$(dirname "$0")/.."

port="${PORT:-8000}"
while lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do
  echo "dev: port $port busy, trying $((port + 10))"
  port=$((port + 10))
done
export PORT="$port" BACKEND_PORT="$port"
echo "dev: backend → http://127.0.0.1:$port  (web: vite prints its port below)"
# --parallel excludes the workspace root by default, so this doesn't recurse
# into the root "dev" script that invoked us.
exec pnpm --parallel --stream dev
