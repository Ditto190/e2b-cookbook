#!/bin/sh
# Template start command: Flask backend serving the built React frontend on
# :8000. HOST=0.0.0.0 so the E2B port proxy (https://8000-<id>.e2b.app) can
# reach it. No API credentials here — the UI key gate supplies them at runtime.
export HOST=0.0.0.0 PORT=8000 PYTHONDONTWRITEBYTECODE=1
export STATIC_DIR=/opt/workbench/apps/web/dist

# Control token. That port proxy URL is public, so the backend refuses every
# /api route without a session cookie minted from this token. Owned by `user`
# (not root, which is what runs this script) so the sandbox terminal can read
# it and mint launch URLs; the backend reads it as root either way.
export WORKBENCH_CONTROL_DIR=/home/user/.config/agents-api-workbench
install -d -m 700 -o user -g user "$WORKBENCH_CONTROL_DIR"
# Pre-create as `user` so both writers work: the terminal mints launch
# tokens here, and so does the backend via POST /api/auth/invite.
install -d -m 700 -o user -g user "$WORKBENCH_CONTROL_DIR/launch-tokens"
token_file="$WORKBENCH_CONTROL_DIR/control-token"
if [ -n "$WORKBENCH_CONTROL_TOKEN" ]; then
  # Explicit override: pass the same token to every sandbox in a fleet and one
  # link works for all of them.
  printf '%s\n' "$WORKBENCH_CONTROL_TOKEN" > "$token_file"
elif [ ! -s "$token_file" ]; then
  # Survives a pause/resume — the file is part of the snapshot, so a resumed
  # sandbox keeps honouring links handed out before it was paused.
  head -c 32 /dev/urandom | base64 | tr -d '\n=' > "$token_file"
  printf '\n' >> "$token_file"
fi
chown user:user "$token_file"
chmod 600 "$token_file"

cd /opt/workbench/apps/backend
exec /opt/workbench/apps/backend/.venv/bin/python app.py "$@"
