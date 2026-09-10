---
title: "Vercel Guide"
slug: vercel
order: 27
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/vercel
---

# Vercel Guide

Run an Agents API session with a Vercel Sandbox.

See [Quickstart](./02-quickstart.md) for the general executor lifecycle.

Choose a provisioning mode:

- **[Application-managed](#before-you-begin):** Follow this guide to start and stop sandboxes from your application.
- **[Webhook-managed](https://github.com/OpenAI-Early-Access/agents-api-python-preview/tree/main/examples/self_hosted_sandbox/webhook_managed/vercel):** Deploy a handler that starts or reconnects sandboxes from OpenAI webhooks.

See [Manage Sandbox Lifecycle](./05-manage-sandbox-lifecycle.md) to compare the two modes.

## Before you begin

Use a Vercel project with Sandbox access. How the Vercel Sandbox SDK authenticates depends on where this application is running:

- **Running locally:** set `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID` in your environment.
- **Deployed on Vercel:** use Vercel OIDC.

Set `OPENAI_API_KEY` for application requests and a separate restricted `OPENAI_EXECUTOR_API_KEY` for sandbox registration. Grant the application key **Responses (/v1/responses) → Write**, which includes `api.responses.write`, for model inference and session operations. When available, add **Managed Agents → Write** when managing vaults. Grant the executor key **List models → Read**, set every other permission to **None**, and use the same organization, project, and user or service account for both keys. Only the restricted executor key enters the sandbox.

**Install dependencies**

```bash
pip install "git+https://github.com/OpenAI-Early-Access/agents-api-python-preview.git" vercel
```

## 1\. Set up the Vercel environment

Save this as `vercel_setup.py`. It creates a short-lived sandbox and starts the executor inside it.

```python
import asyncio

from vercel.sandbox import AsyncSandbox

async def start_sandbox(executor_api_key, environment_id):
    sandbox = await AsyncSandbox.create(
        runtime="node24",
        timeout=5 * 60 * 1000,
        env={"CODEX_API_KEY": executor_api_key},
    )

    try:
        setup = await sandbox.run_command(
            "sh",
            ["-lc", "npm install -g @openai/codex@alpha"],
            sudo=True,
        )
        if setup.exit_code != 0:
            raise RuntimeError(await setup.stderr())

        await sandbox.write_files(
            [
                {
                    "path": "/vercel/sandbox/brief.txt",
                    "content": b"Migrate a synchronous Python service to an async API while preserving behavior.\n",
                }
            ]
        )

        await sandbox.run_command_detached(
            "codex",
            [
                "exec-server",
                "--remote",
                "https://api.openai.com/v1/agents/api",
                "--environment-id",
                environment_id,
            ],
            cwd="/vercel/sandbox",
        )
        return sandbox
    except BaseException as error:
        try:
            await asyncio.wait_for(sandbox.stop(), timeout=15)
        except BaseException as cleanup_error:
            error.add_note(
                f"Sandbox cleanup also failed: {cleanup_error}"
            )
        raise
```

For regular use, put Codex in a Vercel snapshot so the sandbox can connect sooner.

## 2\. Run the session

```python
import asyncio
import os

from agent_api_sdk import AgentAPISDK
from vercel_setup import start_sandbox

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
                        "instructions": "Work from files in /vercel/sandbox and answer concisely.",
                    },
                    environment={
                        "type": "self_hosted",
                        "workspace_directory": "/vercel/sandbox",
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
                input=(
                    "Read /vercel/sandbox/brief.txt and produce a five-step migration plan."
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
                        sandbox.stop(blocking=True),
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

## References

- [Vercel Sandbox documentation](https://vercel.com/docs/sandbox)
- [Vercel Sandbox Python SDK reference](https://vercel.com/docs/sandbox/python-sdk-reference)
- [Vercel Sandbox JavaScript/TypeScript SDK reference](https://vercel.com/docs/sandbox/sdk-reference)
