---
title: "Blaxel Guide"
slug: blaxel
order: 29
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/blaxel
---

# Blaxel Guide

Run an Agents API session with a Blaxel sandbox.

See [Quickstart](./02-quickstart.md) for the general executor lifecycle.

Choose a provisioning mode:

- **[Application-managed](#before-you-begin):** Follow this guide to start and stop sandboxes from your application.
- **[Webhook-managed](https://github.com/OpenAI-Early-Access/agents-api-python-preview/tree/main/examples/self_hosted_sandbox/webhook_managed/blaxel):** Deploy a handler that starts or reconnects sandboxes from OpenAI webhooks.

See [Manage Sandbox Lifecycle](./05-manage-sandbox-lifecycle.md) to compare the two modes.

## Before you begin

You need the `agent_api_sdk` Python SDK, an OpenAI project API key, a Blaxel API key and workspace, and the Codex CLI package.

Set `OPENAI_API_KEY`, a separate restricted `OPENAI_EXECUTOR_API_KEY`, `BL_API_KEY`, and `BL_WORKSPACE` in your environment. Grant the application key **Responses (/v1/responses) → Write**, which includes `api.responses.write`, for model inference and session operations. When available, add **Managed Agents → Write** when managing vaults. Grant the executor key **List models → Read**, set every other permission to **None**, and use the same organization, project, and user or service account for both keys. Only the restricted executor key enters the sandbox. Optionally set `BL_REGION` to override the default `us-was-1` region.

**Install dependencies**

```bash
pip install "git+https://github.com/OpenAI-Early-Access/agents-api-python-preview.git" blaxel
```

## 1\. Set up the Blaxel environment

Save this code as `blaxel_setup.py`. It creates the sandbox, installs the Codex CLI and ripgrep, seeds a file in the workspace, and starts the executor inside it.

```python
import asyncio
import os

from blaxel.core.sandbox import SandboxInstance

WORKSPACE = "/workspace"

async def start_sandbox(executor_api_key: str, environment_id: str) -> SandboxInstance:
    sandbox = await SandboxInstance.create_if_not_exists(
        {
            "name": f"agents-api-{environment_id[-12:].lower()}",
            "image": "blaxel/node:latest",
            "region": os.environ.get("BL_REGION", "us-was-1"),
            "ttl": "5m",
            "labels": {"agents-api-environment-id": environment_id},
        }
    )

    try:
        setup = await sandbox.process.exec(
            {
                "command": "apk add --no-cache ripgrep && npm install --global @openai/codex@alpha",
                "working_dir": "/",
                "wait_for_completion": True,
                "timeout": 120,
            }
        )
        if setup.exit_code != 0:
            raise RuntimeError("Could not install Codex and ripgrep.")

        await sandbox.fs.mkdir(WORKSPACE)
        await sandbox.fs.write(
            f"{WORKSPACE}/brief.txt",
            "Migrate a synchronous Python service to an async API while preserving "
            "behavior.\n",
        )

        await sandbox.process.exec(
            {
                "name": "codex-exec-server",
                "command": (
                    "codex exec-server "
                    "--remote https://api.openai.com/v1/agents/api "
                    f"--environment-id {environment_id}"
                ),
                "working_dir": WORKSPACE,
                "env": {"CODEX_API_KEY": executor_api_key},
                "wait_for_completion": False,
                "keep_alive": True,
                "timeout": 300,
            }
        )
        return sandbox
    except BaseException as error:
        try:
            await asyncio.wait_for(sandbox.delete(), timeout=15)
        except BaseException as cleanup_error:
            error.add_note(
                f"Sandbox cleanup also failed: {cleanup_error}"
            )
        raise
```

The Blaxel Node image uses Alpine Linux, so install ripgrep with `apk`. Pass the restricted executor key as `CODEX_API_KEY` only to the executor process. Set `keep_alive=True` to prevent the sandbox from scaling to zero while the executor runs. Bounded setup, executor, and sandbox timeouts prevent abandoned resources from running indefinitely.

For regular use, build a Blaxel image with Codex and ripgrep already installed so the sandbox can connect sooner.

## 2\. Run the session

This code creates the session with your agent configuration, connects the Blaxel sandbox, runs the task, and streams the result.

```python
import asyncio
import os

from agent_api_sdk import AgentAPISDK
from blaxel_setup import start_sandbox

async def main():
    application_api_key = os.environ["OPENAI_API_KEY"]
    executor_api_key = os.environ["OPENAI_EXECUTOR_API_KEY"]
    sandbox = None
    session = None
    loop = asyncio.get_running_loop()
    overall_deadline = loop.time() + 300
    execution_deadline = overall_deadline - 30
    cleanup_errors: list[BaseException] = []
    primary_error: BaseException | None = None

    async with AgentAPISDK(api_key=application_api_key) as client:
        try:
            session = await asyncio.wait_for(
                client.sessions.create(
                    agent={
                        "model": "gpt-5.6-sol",
                        "instructions": "Work from files in /workspace and answer concisely.",
                    },
                    environment={
                        "type": "self_hosted",
                        "workspace_directory": "/workspace",
                    },
                ),
                timeout=max(0, execution_deadline - loop.time()),
            )

            try:
                sandbox = await asyncio.wait_for(
                    start_sandbox(
                        executor_api_key,
                        session.info.environment.environment_id,
                    ),
                    timeout=min(120, max(0, execution_deadline - loop.time())),
                )
            except TimeoutError as error:
                raise TimeoutError(
                    "The sandbox did not finish provisioning in time."
                ) from error

            events = session.stream(
                input="Read /workspace/brief.txt and produce a five-step migration plan."
            )
            try:
                progress_deadline = loop.time() + 30
                connected = False

                while True:
                    remaining = min(execution_deadline, progress_deadline) - loop.time()
                    try:
                        if remaining <= 0:
                            raise TimeoutError
                        event = await asyncio.wait_for(anext(events), timeout=remaining)
                    except TimeoutError as error:
                        if not connected:
                            raise TimeoutError(
                                "The sandbox executor did not connect in time."
                            ) from error
                        if loop.time() >= execution_deadline:
                            raise TimeoutError(
                                "The agent session exceeded its overall timeout."
                            ) from error
                        raise TimeoutError(
                            "The agent turn stopped making progress."
                        ) from error
                    except StopAsyncIteration as error:
                        raise RuntimeError(
                            "The event stream closed before the agent turn completed."
                        ) from error

                    if event.type in {
                        "session.environment.failed",
                        "session.failed",
                        "session.turn.failed",
                        "session.turn.cancelled",
                    }:
                        raise RuntimeError(event.data.get("error", event.type))
                    if not connected:
                        if (
                            event.type
                            not in {
                                "session.environment.connected",
                                "session.in_progress",
                                "session.turn.in_progress",
                            }
                            and event.output_text_delta is None
                        ):
                            continue
                        connected = True

                    progress_deadline = loop.time() + 60
                    if event.output_text_delta is not None:
                        print(event.output_text_delta, end="", flush=True)
                    if event.type == "session.turn.completed":
                        break
            finally:
                try:
                    await asyncio.wait_for(
                        events.aclose(),
                        timeout=max(0, overall_deadline - loop.time()) / 3,
                    )
                except BaseException as error:
                    cleanup_errors.append(error)
        except BaseException as error:
            primary_error = error
        finally:
            if sandbox is not None:
                try:
                    await asyncio.wait_for(
                        sandbox.delete(),
                        timeout=max(0, overall_deadline - loop.time()) / 2,
                    )
                except BaseException as error:
                    cleanup_errors.append(error)
            if session is not None:
                try:
                    await asyncio.wait_for(
                        session.delete(),
                        timeout=max(0, overall_deadline - loop.time()),
                    )
                except BaseException as error:
                    cleanup_errors.append(error)

            if primary_error is not None:
                if cleanup_errors:
                    primary_error.add_note(
                        "Cleanup also failed: "
                        + "; ".join(str(error) for error in cleanup_errors)
                    )
                    raise primary_error from BaseExceptionGroup(
                        "Session cleanup also failed.", cleanup_errors
                    )
                raise primary_error
            if cleanup_errors:
                if len(cleanup_errors) == 1:
                    raise cleanup_errors[0]
                raise BaseExceptionGroup(
                    "Session cleanup also failed: "
                    + "; ".join(str(error) for error in cleanup_errors),
                    cleanup_errors,
                )
```

Call `await main()` from your application’s existing async entry point.

Start the sandbox before submitting input. The turn waits for the environment to connect, and the session reports the connection through `session.environment.connected` on the event stream.

Use `session.turn.completed` to identify a successful turn. A failed or cancelled turn can also be followed by `session.idle`, so do not treat an idle session as proof that the turn succeeded.

## Optional: persist files between sessions

[Blaxel Agent Drive](https://docs.blaxel.ai/Agent-drive/Overview) can preserve files across sandboxes and sessions. Mount the same drive in each sandbox to share files; Agent Drive requires the `us-was-1` region and does not transfer conversation history or session state.

## References

- [Blaxel Sandbox documentation](https://docs.blaxel.ai/Sandboxes/Overview)
- [Blaxel Python SDK](https://docs.blaxel.ai/sdk-reference/sdk-python)
- [Blaxel TypeScript SDK](https://docs.blaxel.ai/sdk-reference/sdk-ts)
