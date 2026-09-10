---
title: "Daytona Guide"
slug: daytona
order: 28
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/daytona
---

# Daytona Guide

Run an Agents API session with a Daytona Sandbox.

See [Quickstart](./02-quickstart.md) for the general executor lifecycle.

Choose a provisioning mode:

- **[Application-managed](#application-managed):** Follow this guide to start and stop sandboxes from your application.
- **[Webhook-managed](#webhook-managed):** Deploy a handler that starts or reconnects sandboxes from OpenAI webhooks.

See [Manage Sandbox Lifecycle](./05-manage-sandbox-lifecycle.md) to compare the two modes.

## Webhook-managed

The [SDK example](https://github.com/OpenAI-Early-Access/agents-api-python-preview/tree/main/examples/self_hosted_sandbox/webhook_managed/daytona) includes a Python webhook handler, deployment script, and cleanup instructions. A dedicated controller verifies OpenAI deliveries and queues work; a separate worker sandbox runs each session’s executor.

Follow the example to deploy the controller, register its URL in **OpenAI project settings → Webhooks**, and install the signing secret.

The handler starts or reconnects workers on `environment_connection` requests and deletes them when a session fails. It does not stop compute on idle. Workers expire after 30 minutes; the controller expires after two hours. See the example for reconnection and cleanup instructions.

## Application-managed

### Before you begin

You need the `agent_api_sdk` Python SDK, an OpenAI project API key, a Daytona API key, and the Codex CLI package.

Set `OPENAI_API_KEY`, a separate restricted `OPENAI_EXECUTOR_API_KEY`, and `DAYTONA_API_KEY` in your environment. Grant the application key **Responses (/v1/responses) → Write**, which includes `api.responses.write`, for model inference and session operations. When available, add **Managed Agents → Write** when managing vaults. Grant the executor key **List models → Read**, set every other permission to **None**, and use the same organization, project, and user or service account for both keys. Only the restricted executor key enters the sandbox.

**Install dependencies**

```bash
pip install "git+https://github.com/OpenAI-Early-Access/agents-api-python-preview.git" daytona
```

### 1\. Set up the Daytona environment

Save this code as `daytona_setup.py`. It defines an image with the Codex CLI package, creates the Sandbox, seeds a file in the workspace, and starts the executor inside it.

```python
import asyncio

from daytona import (
    AsyncDaytona,
    AsyncSandbox,
    CreateSandboxFromImageParams,
    Image,
    SessionExecuteRequest,
)

EXEC_SESSION = "codex-exec-server"
WORKSPACE = "/home/daytona/workspace"

async def start_sandbox(
    daytona: AsyncDaytona,
    executor_api_key: str,
    environment_id: str,
) -> AsyncSandbox:
    image = Image.debian_slim("3.13").run_commands(
        "apt-get update && apt-get install -y --no-install-recommends "
        "ca-certificates curl file git nodejs npm poppler-utils ripgrep",
        "npm install --global @openai/codex@alpha",
    )

    sandbox = await daytona.create(
        CreateSandboxFromImageParams(
            name=f"agents-api-{environment_id[-12:].lower()}",
            image=image,
            env_vars={"CODEX_API_KEY": executor_api_key},
            labels={"agents-api-environment-id": environment_id},
            auto_stop_interval=0,
            ttl_minutes=5,
        ),
        timeout=120,
    )

    try:
        await sandbox.fs.create_folder(WORKSPACE, "755")
        await sandbox.fs.upload_file(
            b"Migrate a synchronous Python service to an async API while preserving "
            b"behavior.\n",
            f"{WORKSPACE}/brief.txt",
        )

        await sandbox.process.create_session(EXEC_SESSION)
        await sandbox.process.execute_session_command(
            EXEC_SESSION,
            SessionExecuteRequest(
                command=(
                    f"cd {WORKSPACE} && exec codex exec-server "
                    "--remote https://api.openai.com/v1/agents/api "
                    f"--environment-id {environment_id}"
                ),
                run_async=True,
            ),
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

The executor’s connection to OpenAI is outbound and long-lived, and Daytona’s inactivity tracking does not observe it. Set `auto_stop_interval=0` so the Sandbox is not stopped while the agent is working, and use `ttl_minutes` to bound its lifetime if a run is interrupted.

For regular use, put Codex and ripgrep in a Daytona snapshot so the Sandbox can connect sooner.

### 2\. Run the session

This code creates the session with your agent configuration, connects the Daytona Sandbox, runs the task, and streams the result.

```python
import asyncio
import os

from agent_api_sdk import AgentAPISDK
from daytona import AsyncDaytona
from daytona_setup import start_sandbox

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

    async with AgentAPISDK(api_key=application_api_key) as client, AsyncDaytona() as daytona:
        try:
            session = await asyncio.wait_for(
                client.sessions.create(
                    agent={
                        "model": "gpt-5.6-sol",
                        "instructions": (
                            "Work from files in /home/daytona/workspace and answer concisely."
                        ),
                    },
                    environment={
                        "type": "self_hosted",
                        "workspace_directory": "/home/daytona/workspace",
                    },
                ),
                timeout=max(0, execution_deadline - loop.time()),
            )

            try:
                sandbox = await asyncio.wait_for(
                    start_sandbox(
                        daytona,
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
                input=(
                    "Read /home/daytona/workspace/brief.txt and produce a five-step "
                    "migration plan."
                )
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

Start the Sandbox before submitting input. The turn waits for the environment to connect, and the session reports the connection through `session.environment.connected` on the event stream.

Use `session.turn.completed` to identify a successful turn. A failed or cancelled turn can also be followed by `session.idle`, so do not treat an idle session as proof that the turn succeeded. A session retrieval immediately after an event can briefly return the prior status.

## References

- [Daytona documentation](https://www.daytona.io/docs/en/)
- [Daytona Python SDK reference](https://www.daytona.io/docs/en/python-sdk/)
- [Daytona TypeScript SDK reference](https://www.daytona.io/docs/en/typescript-sdk/)
