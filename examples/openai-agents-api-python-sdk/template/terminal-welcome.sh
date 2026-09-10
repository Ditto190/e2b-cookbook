# Sourced as /home/user/.bash_aliases for the sandbox terminal.
export WORKBENCH_CONTROL_DIR=/home/user/.config/agents-api-workbench

# The workbench is token-protected (the :8000 proxy URL is public), so the
# link carries a single-use launch token the frontend redeems and strips from
# the address bar. Each call mints a fresh one — the old link is spent.
demo-url() {
  /opt/workbench/apps/backend/.venv/bin/python \
    /opt/workbench/apps/backend/auth.py
}

# The persistent token, for a browser that lost its cookie or a second person.
demo-token() {
  cat "$WORKBENCH_CONTROL_DIR/control-token"
}

if mkdir /tmp/.agents-api-workbench-welcome 2>/dev/null; then
  demo_url="$(demo-url)"

  printf '\n\033[1;38;5;208m  OPENAI & E2B - AGENTS API PYTHON SDK\033[0m\n'
  printf '  \033[1mOPEN THE DEMO:\033[0m \033[4;36m%s\033[0m\n\n' "$demo_url"
  printf '  1. Open the link above (it carries a single-use access token).\n'
  printf '  2. Paste your E2B API key and a scoped OpenAI project key in the gate.\n'
  printf '  3. Ask the agent to build or inspect something.\n'
  printf '  4. Watch activity and workspace files in the right-hand viewer.\n\n'
  printf '  The app is already running. Run \033[1mdemo-url\033[0m for a fresh link,\n'
  printf '  \033[1mdemo-token\033[0m for the reusable control token.\n\n'

  unset demo_url
fi
