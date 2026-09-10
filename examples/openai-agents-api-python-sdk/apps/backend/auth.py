"""Control-token auth for the workbench backend.

An E2B sandbox's port proxy (https://8000-<id>.e2b.app) is public: anyone who
learns the sandbox id can drive the workbench, spend the operator's OpenAI
budget and read the workspace. This module gates every /api/* route behind a
token the sandbox mints for itself at boot.

Two token kinds, the same shape as the Cursor self-hosted-agents dispatcher:

  control token   Persistent, one per sandbox. Written to
                  <control dir>/control-token by template/start.sh (or forced
                  with WORKBENCH_CONTROL_TOKEN). Doubles as the HMAC key for
                  session cookies, so rotating it invalidates every session.
                  Share it with a teammate and they get their own session.

  launch token    Single-use, 10 minutes. Only its SHA-256 digest is stored
                  (as a filename), so the token itself never touches disk.
                  Minted by template/terminal-welcome.sh for the one-click
                  `#token=` URL and by POST /api/auth/invite for sharing.

Auth is OFF when no control token resolves — that is local development
(`make dev`), where the backend is bound to loopback anyway.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path

SESSION_COOKIE = "agents_workbench_session"
SESSION_TTL_SECONDS = 12 * 60 * 60
LAUNCH_TOKEN_TTL_SECONDS = 10 * 60
# Bounds the work an unauthenticated caller can make us do.
MAX_TOKEN_LENGTH = 4096

CONTROL_DIR = Path(
    os.environ.get("WORKBENCH_CONTROL_DIR")
    or Path.home() / ".config" / "agents-api-workbench"
)
LAUNCH_TOKEN_DIR = CONTROL_DIR / "launch-tokens"


def control_token() -> str:
    """The sandbox's persistent token, or "" when auth is disabled.

    Read on every call rather than cached: start.sh writes the file before the
    backend boots, but a redeploy may rewrite it under a running process.
    """
    from_env = os.environ.get("WORKBENCH_CONTROL_TOKEN", "").strip()
    if from_env:
        return from_env
    try:
        return (CONTROL_DIR / "control-token").read_text().strip()
    except OSError:
        return ""


def auth_enabled() -> bool:
    return bool(control_token())


# --- launch tokens ------------------------------------------------------------


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_launch_token(ttl_seconds: int = LAUNCH_TOKEN_TTL_SECONDS) -> str:
    """Mint a single-use token and return the plaintext (the only copy)."""
    LAUNCH_TOKEN_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    token = secrets.token_urlsafe(24)
    path = LAUNCH_TOKEN_DIR / _digest(token)
    # "x" so a digest collision can never silently overwrite a live token.
    with open(path, "x", opener=lambda p, f: os.open(p, f, 0o600)) as handle:
        json.dump({"expires_at": time.time() + ttl_seconds}, handle)
        handle.flush()
        os.fsync(handle.fileno())
    return token


def consume_launch_token(candidate: str) -> bool:
    """Claim a launch token exactly once.

    The atomic rename is the claim: two parallel logins race on it and only
    the winner sees the file, so a leaked URL cannot be replayed.
    """
    if len(candidate) > MAX_TOKEN_LENGTH:
        return False
    source = LAUNCH_TOKEN_DIR / _digest(candidate)
    claimed = source.with_suffix(".claim")
    try:
        os.rename(source, claimed)
    except OSError:
        return False
    try:
        expires_at = json.loads(claimed.read_text()).get("expires_at")
        return isinstance(expires_at, (int, float)) and expires_at > time.time()
    except (OSError, ValueError):
        return False
    finally:
        try:
            claimed.unlink()
        except OSError:
            pass


def prune_launch_tokens() -> None:
    """Drop expired token files. Cheap and best-effort — the directory only
    ever holds a handful of entries."""
    try:
        entries = list(LAUNCH_TOKEN_DIR.iterdir())
    except OSError:
        return
    now = time.time()
    for entry in entries:
        try:
            expires_at = json.loads(entry.read_text()).get("expires_at")
            if not isinstance(expires_at, (int, float)) or expires_at <= now:
                entry.unlink()
        except (OSError, ValueError):
            pass


# --- session cookie -----------------------------------------------------------


def _sign(payload: str, key: str) -> str:
    return hmac.new(key.encode("utf-8"), payload.encode("utf-8"), "sha256").hexdigest()


def verify_token(candidate: object) -> bool:
    """Accept the persistent control token or a single-use launch token."""
    if not isinstance(candidate, str) or not candidate or len(candidate) > MAX_TOKEN_LENGTH:
        return False
    token = control_token()
    if not token:
        return True  # auth disabled
    if hmac.compare_digest(candidate, token):
        return True
    return consume_launch_token(candidate)


def issue_session() -> str:
    """Cookie value for a freshly authenticated browser: v1.<expiry>.<hmac>.

    Stateless on purpose — nothing to store, and rotating the control token
    (the HMAC key) revokes every outstanding session at once.
    """
    expires = int(time.time()) + SESSION_TTL_SECONDS
    payload = f"v1.{expires}"
    return f"{payload}.{_sign(payload, control_token())}"


def session_valid(cookie: str | None) -> bool:
    if not cookie or len(cookie) > MAX_TOKEN_LENGTH:
        return False
    try:
        version, expires_raw, signature = cookie.split(".")
    except ValueError:
        return False
    if version != "v1" or not expires_raw.isdigit():
        return False
    if int(expires_raw) <= time.time():
        return False
    return hmac.compare_digest(
        signature, _sign(f"v1.{expires_raw}", control_token())
    )


if __name__ == "__main__":
    # `python auth.py` prints a one-click login URL: a fresh single-use launch
    # token in the fragment, which the frontend redeems and strips. Used by
    # template/terminal-welcome.sh so the banner link works without anyone
    # copying the control token by hand.
    prune_launch_tokens()
    launch_token = create_launch_token()
    sandbox_id = os.environ.get("E2B_SANDBOX_ID", "")
    if sandbox_id:
        domain = os.environ.get("E2B_DOMAIN") or "e2b.app"
        port = os.environ.get("PORT", "8000")
        print(f"https://{port}-{sandbox_id}.{domain}/#token={launch_token}")
    else:
        print(launch_token)
