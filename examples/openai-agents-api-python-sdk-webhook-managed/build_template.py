# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "e2b>=2.45.1",
# ]
# ///

"""Build the worker template: codex exec-server baked in, nothing else.

The handler creates one worker sandbox per Agents API session from this
template and launches ``codex exec-server`` inside it. Baking codex into the
image removes the per-worker ``npm install -g @openai/codex`` the upstream
example pays on every fresh worker, and pins the CLI version.

    uv run --env-file .env build_template.py
"""

from __future__ import annotations

import os

from e2b import Template, default_build_logger

TEMPLATE_NAME = os.environ.get("E2B_WORKER_TEMPLATE", "openai-agents-api-python-sdk-webhook-managed")
# Version the example was verified against (what @openai/codex@alpha resolved to
# on 2026-09-03). Bump deliberately, then rebuild.
CODEX_VERSION = os.environ.get("CODEX_VERSION", "0.154.0-alpha.1")

template = (
    Template()
    .from_base_image()
    # What the agent needs for real work in /workspace: git, python, ripgrep
    # (codex's search backend), file inspection. flock gates the executor.
    .apt_install(["ca-certificates", "curl", "file", "git", "python3", "python3-pip", "ripgrep", "util-linux"])
    .run_cmd(
        [
            f"sudo npm install --global @openai/codex@{CODEX_VERSION}",
            "sudo mkdir -p /workspace /codex-home",
            "sudo chown -R user:user /workspace /codex-home",
            "codex exec-server --help >/dev/null",
        ]
    )
    .set_envs({"CODEX_HOME": "/codex-home"})
    .set_workdir("/workspace")
)

if __name__ == "__main__":
    info = Template.build(
        template,
        TEMPLATE_NAME,
        cpu_count=2,
        memory_mb=4096,
        on_build_logs=default_build_logger(),
    )
    print(f"template: {info.name} ({info.template_id})")
