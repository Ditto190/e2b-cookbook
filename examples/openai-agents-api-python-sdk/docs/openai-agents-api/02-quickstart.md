---
title: "Quickstart"
slug: quickstart
order: 2
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/quickstart
---

# Quickstart

The Agents API lets you build agents that can take action on your behalf. Give an agent a task, and it can figure out how to complete it using the tools available in its environment.

OpenAI manages the agent and its conversation. You can run a conversation-only session without an execution environment, or provide a workspace where the agent runs commands and interacts with files.

This guide shows you how to create a coding assistant and ask it to write a useful Python script.

## Prerequisites

- An [OpenAI Platform account](https://platform.openai.com/).
- An approved OpenAI project with Agents API access and an [application API key](https://platform.openai.com/api-keys).

Direct HTTP requests to Agents API and Vaults endpoints include the `OpenAI-Beta: agents=v1` header.

Give the application key the permissions its requests require:

- Session creation, input, and deletion accept `api.agents.write` or `api.responses.write`; running model inference also requires `api.responses.write`. Session reads and event streams accept `api.agents.read`, `api.responses.read`, or `api.responses.write`.
- For restricted application keys, vault creation and credential changes require `api.agents.write`; vault reads require `api.agents.read`.
- Detailed trace retrieval is available only in the Platform dashboard with tracing access enabled; an application API key does not grant dashboard trace access.

Grant the application key **Responses (/v1/responses) → Write** to run model inference and session operations. When available, add **Managed Agents → Write** when your application manages vaults; this grants both `api.agents.read` and `api.agents.write`. A key with only `api.agents.write` cannot read sessions or run model inference.

For a self-hosted session, create a separate restricted `OPENAI_EXECUTOR_API_KEY` for the same organization, project, and user or service account that owns the session. Set **List models → Read**, set every other permission to **None**, and pass only this key to the executor as `CODEX_API_KEY`. Keep the application key outside the sandbox.

## Install the SDK

Install the OpenAI SDK for your preferred language:

**SDK**

**Python**

```bash
python -m pip install "git+https://github.com/OpenAI-Early-Access/agents-api-python-preview.git"
```

**TypeScript**

```bash
git clone https://github.com/OpenAI-Early-Access/agents-api-typescript-preview.git
cd agents-api-typescript-preview
npm install
npm run build
cd /path/to/your-application
npm install /path/to/agents-api-typescript-preview
```

Import the installed package as `@openai/agents-api-preview`. The TypeScript client exposes Managed Agents resources under `client.beta.agents`.

Set your API key:

```bash
export OPENAI_API_KEY="your-api-key"
```

## Run a conversation-only session

A conversation-only session runs the hosted agent harness without provisioning or connecting an executor. It can reason, use function tools and web search, call service-origin HTTP MCP tools, and use programmatic tool calling. It cannot run sandbox commands, access workspace files, or use stdio or environment-origin MCP tools.

Create and stream the session with its required initial input:

```python
import asyncio

from agent_api_sdk import AgentAPISDK

async def main() -> None:
    async with AgentAPISDK() as client:
        async for event in client.sessions.create_stream(
            agent={
                "model": "gpt-5.6",
                "instructions": "Answer clearly and concisely.",
            },
            environment={"type": "none"},
            input="Explain what a conversation-only agent session can do in two sentences.",
        ):
            if event.type == "session.turn.failed":
                message = (
                    event.error.message
                    if event.error is not None
                    else "The agent turn failed."
                )
                raise RuntimeError(message)
            if event.type == "session.turn.cancelled":
                raise RuntimeError("The agent turn was cancelled.")
            if event.type == "session.failed":
                raise RuntimeError(event.error or "The agent session failed.")
            if event.output_text_delta is not None:
                print(event.output_text_delta, end="", flush=True)

asyncio.run(main())
```

`create_stream()` submits the initial input atomically and streams the first turn without missing early events. Service-origin MCP credentials must be vault-backed.

For a complete runnable example, see [`examples/conversation_only/main.py`](https://github.com/OpenAI-Early-Access/agents-api-python-preview/blob/main/examples/conversation_only/main.py).

## Create your first agent

### 1\. Start a session

Create a session for your coding assistant:

**cURL**

```bash
curl https://api.openai.com/v1/agents/sessions \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agent":{"model":"gpt-5.6"},"environment":{"type":"self_hosted","workspace_directory":"/workspace"}}'
```

**SDK**

**Python**

```python
from agent_api_sdk import AgentAPISDK

client = AgentAPISDK()

session = await client.sessions.create(
    agent={
        "model": "gpt-5.6",
        "instructions": (
            "You are a helpful coding assistant. "
            "Write clean code and verify that it works."
        ),
    },
    environment={
        "type": "self_hosted",
        "workspace_directory": "/workspace",
    },
)

print(f"Session ID: {session.id}")
print(f"Environment ID: {session.info.environment.environment_id}")
```

**TypeScript**

```typescript
import { AgentAPISDK } from "@openai/agents-api-preview";

const client = new AgentAPISDK();

const session = await client.beta.agents.sessions.create({
  agent: {
    model: "gpt-5.6",
    instructions:
      "You are a helpful coding assistant. " +
      "Write clean code and verify that it works.",
  },
  environment: {
    type: "self_hosted",
    workspace_directory: "/workspace",
  },
});

console.log(`Session ID: ${session.id}`);
if (session.environment.type !== "self_hosted") {
  throw new Error("Expected a self-hosted environment.");
}
console.log(`Environment ID: ${session.environment.id}`);
```

Save the environment ID. You’ll use it to connect the agent’s workspace.

### 2\. Connect your environment

Your sandbox needs to reach OpenAI while the agent is working. Allow outbound access to `https://api.openai.com` for API requests and `https://codex-cloud-environments.chatgpt.com` to keep the agent connected over WebSocket.

If your sandbox uses a firewall or proxy, make sure it allows WebSocket upgrades and keeps the connection open. You don’t need to open any inbound ports.

The executor also needs an API key to authenticate with OpenAI. Pass only your separate restricted `OPENAI_EXECUTOR_API_KEY` into the sandbox as `CODEX_API_KEY`. Keep the broader application key outside the sandbox. Use your sandbox provider’s secret manager and keep the executor key out of your code and container image.

For setup and isolation guidance, see [Self-hosted Sandboxes](./04-connect-to-a-sandbox.md) and [Sandbox Security](./06-securing-your-sandbox.md).

Before running the executor directly, install the Codex CLI and make sure the configured workspace directory (`/workspace` in this guide) exists in the execution environment.

Start the executor inside your sandbox:

```bash
CODEX_API_KEY="$OPENAI_EXECUTOR_API_KEY" \
codex exec-server \
  --remote https://api.openai.com/v1/agents/api \
  --environment-id "$ENVIRONMENT_ID"
```

Replace `$ENVIRONMENT_ID` with the ID returned in the previous step.

The executor connects your sandbox to OpenAI and gives the agent access to its workspace.

**Optional: run the executor in Docker**

Docker is not required. If the Codex CLI is already installed, run the executor directly. Use Docker for a disposable local sandbox with additional process and filesystem isolation.

Create a `Dockerfile`:

```docker
FROM python:3.14-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        nodejs \
        npm \
        ripgrep \
    && npm install -g @openai/codex@alpha \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /workspace /codex-home

ENV CODEX_HOME=/codex-home

WORKDIR /workspace
```

Build the image:

```bash
docker build -t agent-codex-sandbox .
```

Start the executor:

```bash
CODEX_API_KEY="$OPENAI_EXECUTOR_API_KEY" docker run \
  --detach \
  --rm \
  --name agents-quickstart \
  --env CODEX_API_KEY \
  --volume "$(pwd):/workspace" \
  agent-codex-sandbox \
  codex exec-server \
    --remote https://api.openai.com/v1/agents/api \
    --environment-id "$ENVIRONMENT_ID"
```

The current directory is mounted at `/workspace`, so files created by the agent appear on your machine.

### 3\. Give the agent a task

Ask the agent to create a Python script that displays the files in its workspace:

**cURL**

```bash
curl -X POST "https://api.openai.com/v1/agents/sessions/$SESSION_ID/events" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"events":[{"type":"session.input.message","input":[{"role":"user","content":[{"type":"input_text","text":"Create tree.py and show the output."}]}]}]}'
```

**SDK**

**Python**

```python
async for event in session.stream(
    input=(
        "Create tree.py, a Python script that prints a readable tree of the "
        "files in the current directory. Run it and show me the output."
    )
):
    if event.type == "session.turn.failed":
        message = (
            event.error.message
            if event.error is not None
            else "The agent turn failed."
        )
        raise RuntimeError(message)
    if event.type == "session.turn.cancelled":
        raise RuntimeError("The agent turn was cancelled.")
    if event.type == "session.failed":
        raise RuntimeError(event.error or "The agent session failed.")
    if event.output_text_delta is not None:
        print(event.output_text_delta, end="", flush=True)
    elif event.type == "session.idle":
        print("\nAgent finished.")
```

**TypeScript**

```typescript
const events = await client.beta.agents.sessions.events.stream(session.id, {
  stream: true,
});

try {
  await client.beta.agents.sessions.events.create(session.id, {
    events: [
      {
        type: "session.input.message",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "Create tree.py, a Python script that prints a readable tree of the " +
                  "files in the current directory. Run it and show me the output.",
              },
            ],
          },
        ],
      },
    ],
  });

  for await (const event of events) {
    if (event.type === "session.turn.output_text.delta") {
      process.stdout.write(event.delta);
    } else if (event.type === "session.turn.failed") {
      throw new Error(event.error?.message ?? "The agent turn failed.");
    } else if (event.type === "session.turn.cancelled") {
      throw new Error("The agent turn was cancelled.");
    } else if (event.type === "session.failed") {
      throw new Error(event.session.error ?? "The agent session failed.");
    } else if (event.type === "session.idle") {
      console.log("\nAgent finished.");
      break;
    }
  }
} finally {
  events.controller.abort();
}
```

Open the live event stream before submitting input. The Python `stream(input=...)` helper submits the message after its stream connects; the TypeScript example connects explicitly before creating the input event. Close a TypeScript event stream when the turn finishes or input submission fails.

### 4\. Shut down your sandbox

A session can emit `session.idle` after a completed, failed, or cancelled turn. Check `session.turn.failed` and `session.turn.cancelled` before treating the turn as successful. If you don’t plan to send another message, stop the executor and release the sandbox.

**Stop a Docker sandbox**

Stop the container you started earlier:

```bash
docker rm --force agents-quickstart
```

Because the container was started with `--rm`, Docker removes it when it stops. Files in the mounted workspace remain on your machine.

## Next steps

To automate sandbox startup and reconnection, see [Webhook-managed sandboxes](./05-manage-sandbox-lifecycle.md#set-up-webhook-managed-sandboxes).
