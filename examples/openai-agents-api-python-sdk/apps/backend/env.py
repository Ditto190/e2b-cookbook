# env.py — importing this module loads the local .env and puts the vendored
# agent_api_sdk on sys.path.
from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv

_HERE = Path(__file__).resolve().parent
ENV_FILE = _HERE / ".env"

# vendored Agents API preview SDK snapshot (@ bdb3190)
sys.path.insert(0, str(_HERE / "vendor"))

# override=True: this .env is the source of truth for the backend's keys.
# Shell exports often carry an OpenAI key WITHOUT Agents API preview access,
# which silently breaks every /v1/agents call with a bare 404.
load_dotenv(ENV_FILE, override=True)


def mask(secret: str) -> str:
    """First 12 chars + ellipsis — the only way a key may ever be shown."""
    return secret[:12] + "…"
