---
title: "Architectures"
slug: architecture-concepts
order: 3
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/architecture-concepts
---

# Architectures

OpenAI runs the agent harness. Your application supplies the execution environment, connects external systems, and decides how to handle session lifecycle events.

An integration typically includes three components:

1.  **Harness** is the OpenAI-hosted orchestrator that decides what the agent does and manages its session.
2.  **Sandbox** is the computer where the agent runs commands, executes code, edits files, uses MCP servers, and creates artifacts.
3.  **Application server** is the bridge between the hosted agent and the rest of your system. It surfaces events to your user-facing product, manages the sandbox lifecycle, and can run function tools inside your VPC.

A [webhook handler](./05-manage-sandbox-lifecycle.md#set-up-webhook-managed-sandboxes) can manage sandbox provisioning for both live SSE sessions and background tasks.

![A hosted agent exchanges events with an application server or webhook handler and executes tools in a connected sandbox.](https://preview-docs-git-agents-alpha-openai.vercel.app/images/agents-api/architectures-1.webp)

## Ways to run the Agents API

### Application server orchestration

![An application server creates an agent, runs function tools, and starts and stops a connected sandbox.](https://preview-docs-git-agents-alpha-openai.vercel.app/images/agents-api/architectures-2.webp)

In this setup, OpenAI runs the agent’s brains while your application server monitors the session and acts as the bridge to the rest of your system.

Your server keeps your app up to date on what the agent is doing and responds when the agent needs something. It starts and connects the sandbox when work begins, shuts it down when appropriate, and runs function tools when the orchestrator requests them.

Once those connections are in place, the orchestrator can use remote MCPs, executor MCPs, and Bash commands directly. Your application server coordinates the integration without proxying every action.

This is a good fit when you want to show the agent’s real-time progress in your app or give the agent access to function tools in your own systems.

The tradeoff is that your application server has to stay available. If it goes down, your product can lose visibility into the agent’s progress, the sandbox lifecycle can get out of sync, and the agent can be left waiting for a function tool to run.

For more on managing the sandbox, see [Manage Sandbox Lifecycle](./05-manage-sandbox-lifecycle.md). For application-hosted tools, see [Function Tools](./08-function-call-tools.md).

### Background mode

![A background agent emits lifecycle events to a webhook handler that starts, connects, and stops its sandbox.](https://preview-docs-git-agents-alpha-openai.vercel.app/images/agents-api/architectures-3.webp)

Instead of keeping an application server connected while the agent works, you can give the orchestrator a task and let it run in the background. This is useful when you do not need to surface every update in your product or keep a server running for the entire task.

A webhook handler can follow the few session-state changes that matter. It can start and connect the sandbox, shut it down when the work is finished, and let you know when the result is ready or something goes wrong.

The orchestrator can still use remote MCPs, executor MCPs, and commands available in the sandbox once everything is connected. Since there is no application server standing by, it cannot call function tools unless you provide a separate handler.

The session remains available for follow-up work after the task finishes. If you shut down the sandbox, you will need to reconnect it before the agent can use it again and save any files you want to keep.

For webhook setup, see [Webhooks](./20-webhooks.md).

### No sandbox mode

![An application server provides function tools and an optional virtual runtime without a separate sandbox.](https://preview-docs-git-agents-alpha-openai.vercel.app/images/agents-api/architectures-4.webp)

Some agents do not need a sandbox. Others can use a virtual filesystem and a Bash-like shell inside your application instead of a separate instance. In either case, set the environment type to `none`.

```json
{
  "environment": {
    "type": "none"
  }
}
```

**SDK**



**Python**

```python
session = await client.sessions.create(
    agent={"model": "gpt-5.6"},
    environment={"type": "none"},
    input="Explain the difference between a session and a turn.",
)
```

**TypeScript**

```typescript
const session = await client.beta.agents.sessions.create({
  agent: { model: "gpt-5.6" },
  environment: { type: "none" },
  input: [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: "Explain the difference between a session and a turn.",
        },
      ],
    },
  ],
});
```

Without a sandbox, the default Bash and apply-patch tools are unavailable. The same is true for executor MCPs and CLIs that normally run inside the sandbox. OpenAI still runs the orchestrator and maintains the agent’s session.

For a TypeScript application, `just-bash` provides an in-memory filesystem and Bash-like commands without requiring a real shell. `gbash` brings a similar virtual shell to Go services.

This can be useful when you want the whole integration to run in a lightweight runtime, such as a Cloudflare Worker or Render worker. You do not need a separate sandbox just to give the agent a small amount of compute.

The hosted harness will give you durable sessions, compaction, programmatic tool calling, and multi-agent support.

You can use this approach with either of the setups above. Keep your application in the loop when the agent needs function tools. Otherwise, use webhooks and remote MCPs if you want the agent to work in the background.
