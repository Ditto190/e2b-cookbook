---
title: "Self-hosted Sandboxes"
slug: connect-to-a-sandbox
order: 4
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/connect-to-a-sandbox
---

# Self-hosted Sandboxes

An agent uses a sandbox to run commands, work with files, and execute code. You can connect a provider-hosted sandbox, a container in your infrastructure, or another isolated environment.

Isolate sandboxes by user or workload. Agents sharing an environment can access the same files, credentials, and other resources.

Tailor the sandbox to your application:

- A software engineering sandbox might include a GitHub repository and its dependencies.
- A legal sandbox might mount contracts and provide document-editing libraries.

## How it works

Choose [application-managed or webhook-managed provisioning](./05-manage-sandbox-lifecycle.md). Both use the connection protocol below.

When you first create a session, you will receive an environment ID.

**SDK**



**Python**

```python
session = await client.sessions.create(
    agent={"model": "gpt-5.6"},
    environment={
        "type": "self_hosted",
        "workspace_directory": "/workspace",
    },
)
```

**TypeScript**

```typescript
const session = await client.beta.agents.sessions.create({
  agent: { model: "gpt-5.6" },
  environment: {
    type: "self_hosted",
    workspace_directory: "/workspace",
  },
});
```

```json
{
  "type": "agent.session.created",
  "data": {
    "environment_id": "env_..."
  }
}
```

That environment ID is fixed for the session. To connect your sandbox, run this command in the sandbox environment:

```bash
CODEX_API_KEY="$OPENAI_EXECUTOR_API_KEY" \
  codex exec-server \
  --remote https://api.openai.com/v1/agents/api \
  --environment-id "$ENVIRONMENT_ID"
```

This will open a connection from the sandbox to the agent, and allow the agent to communicate with the sandbox. Until the sandbox is connected, the agent will not start running. Once the sandbox is connected and the agent has received some user input, it will start running.

Install the Codex CLI to make `codex exec-server` available:

```bash
npm install -g @openai/codex@alpha
```

![A Codex executor in an isolated sandbox establishes an outbound connection to an OpenAI-hosted agent.](https://preview-docs-git-agents-alpha-openai.vercel.app/images/agents-api/self-hosted-sandboxes-1.webp)

## Reuse sandbox configuration

Use a self-hosted [environment template](./32-api-reference.md#environment-templates) to reuse a workspace and capability directories across sessions. Pass its ID as `environment.environment_template_id`; each session still receives its own environment ID and sandbox executor.

## Required network access and authentication

### Network access

The sandbox must be able to connect to these hosts:

- `https://api.openai.com` registers the sandbox with its agent session.
- `wss://codex-cloud-environments.chatgpt.com` carries commands and results between the agent and sandbox.

### Authentication

Create a separate restricted executor key for the same organization, project, and user or service account that owns the session. Select **List models → Read** and set every other permission to **None**. Set it as `OPENAI_EXECUTOR_API_KEY`, and pass only that credential to the sandbox as `CODEX_API_KEY`.

Keep your broader application `OPENAI_API_KEY` outside the sandbox. Agent-generated code can read the executor credential, so keep it out of source code, container images, and logs, and rotate or revoke it when needed.

## Follow connection events

Use the session event stream to monitor the sandbox connection:

- `session.environment.pending`: Waiting for the sandbox to connect.
- `session.environment.connected`: The sandbox is ready, and the agent can start running.
- `session.environment.failed`: The sandbox failed to connect. Check the environment error and sandbox logs.

### What is codex exec-server?

`codex exec-server` is a lightweight worker that runs in the sandbox and connects it to an agent session.

It listens for commands from the agent, such as:

1.  Running shell commands.
2.  Navigating the filesystem and reading or writing files.
3.  Using MCP servers running in the sandbox.

The worker uses the environment ID and API key to register the sandbox, then opens a WebSocket connection to receive requests and return results. It automatically reconnects if interrupted. All connections are outbound, so no inbound access is required.
