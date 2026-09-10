---
title: "Runloop Guide"
slug: runloop
order: 31
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/runloop
---

# Runloop Guide

Run code and work with files in a Runloop devbox while OpenAI runs the agent and maintains session state.

This guide uses **application-managed** provisioning: your application starts the devbox, connects its executor, and shuts it down when finished. See [Manage Sandbox Lifecycle](./05-manage-sandbox-lifecycle.md) for the lifecycle behavior.

## Before you begin

You need Python 3.11 or later, [uv](https://docs.astral.sh/uv/), and access to the [Agents API Python SDK](https://github.com/OpenAI-Early-Access/agents-api-python-preview).

Set `RUNLOOP_API_KEY`, `OPENAI_API_KEY`, and a separate restricted `OPENAI_EXECUTOR_API_KEY`. The OpenAI keys must have the same owner, organization, and project. Only the executor key enters the devbox. See [executor authentication](./04-connect-to-a-sandbox.md#authentication).

## Application-managed

The [complete example](https://github.com/OpenAI-Early-Access/agents-api-python-preview/tree/main/examples/self_hosted_sandbox/application_managed/runloop) creates a session, starts a Runloop devbox, and asks the agent to read `brief.txt` and write a migration plan to `plan.md`. It prints the result and cleans up both resources.

From a checkout of the SDK repository, run:

```bash
uv run examples/self_hosted_sandbox/application_managed/runloop/main.py
```

The script declares its dependencies inline. The Runloop-specific connection code creates the devbox with the executor key and starts `codex exec-server` in the background:

```python
devbox = await runloop.devbox.create(
    environment_variables={"CODEX_API_KEY": executor_key},
    launch_parameters={"keep_alive_time_seconds": 600},
)
await devbox.cmd.exec(
    "mkdir -p /home/user/workspace && "
    "npm install --prefix /home/user/.codex-runtime @openai/codex@alpha"
)
await devbox.cmd.exec_async(
    "cd /home/user/workspace && exec "
    + shlex.join([
        "/home/user/.codex-runtime/node_modules/.bin/codex", "exec-server",
        "--remote", "https://api.openai.com/v1/agents/api",
        "--environment-id", session.info.environment.environment_id,
    ])
)
```

The full example checks installation and turn completion, reads the generated file, and calls `devbox.shutdown()` and `session.delete()` in cleanup. It allows five minutes for setup and execution; the devbox has a ten-minute lifetime as a fallback if the application exits unexpectedly.

Keep the session and devbox alive if your application needs follow-up turns. Use one provisioning owner per session; do not attach a provisioning webhook handler to sessions managed by this example.

## References

- [Runloop documentation](https://docs.runloop.ai/)
- [Runloop Python SDK](https://runloopai.github.io/api-client-python/)
- [Runloop TypeScript SDK](https://runloopai.github.io/api-client-ts/stable/)
