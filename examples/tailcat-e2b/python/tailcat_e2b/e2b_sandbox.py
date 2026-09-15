"""Small E2B adapters shared by the Tailcat demos."""

from dataclasses import dataclass
import time
from typing import Callable

from e2b import CommandExitException, Sandbox

from .template import TAILCAT_URL, TEMPLATE_ALIAS

INSTALL_TAILCAT_CMD = (
    f"curl -fsSL -o /tmp/tailcat.tgz {TAILCAT_URL} && mkdir -p /tmp/tc && tar xzf /tmp/tailcat.tgz -C /tmp/tc"
    " && sudo install -m 0755 $(find /tmp/tc -type f -name tailcat) /usr/local/bin/tailcat"
    " && rm -rf /tmp/tc /tmp/tailcat.tgz"
)


@dataclass
class CommandResult:
    exit_code: int
    output: str


CommandRunner = Callable[[str], CommandResult]


def create_sandbox(timeout_seconds: int = 600) -> Sandbox:
    """Create a sandbox from the Tailcat template, with a runtime-install fallback."""
    started_at = time.time()
    try:
        sandbox = Sandbox.create(TEMPLATE_ALIAS, timeout=timeout_seconds)
    except Exception as error:
        if "404" not in str(error):
            raise

        sandbox = Sandbox.create(timeout=timeout_seconds)
        sandbox.commands.run(INSTALL_TAILCAT_CMD, timeout=120)
        print(f"[{sandbox.sandbox_id}] template '{TEMPLATE_ALIAS}' not found; installed Tailcat at runtime")

    print(f"[{sandbox.sandbox_id}] sandbox ready in {time.time() - started_at:.1f}s")
    return sandbox


def run_sandbox_command(sandbox: Sandbox, command: str, timeout_seconds: int = 60) -> CommandResult:
    """Run a sandbox command and preserve non-zero exit details for assertions."""
    try:
        result = sandbox.commands.run(command, timeout=timeout_seconds)
        return CommandResult(result.exit_code, result.stdout + result.stderr)
    except CommandExitException as error:
        return CommandResult(error.exit_code, error.stdout + error.stderr)


def sandbox_command_runner(sandbox: Sandbox, timeout_seconds: int = 120) -> CommandRunner:
    return lambda command: run_sandbox_command(sandbox, command, timeout_seconds)


def assert_command_succeeded(result: CommandResult) -> None:
    if result.exit_code != 0:
        raise RuntimeError(f"command failed (exit {result.exit_code}):\n{result.output}")
