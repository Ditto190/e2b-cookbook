---
title: "Agents API"
slug: overview
order: 1
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/overview
---

# Agents API

> !
>
> **Early-access preview:** The Agents API requires an approved OpenAI project with Agents API access. These guides use the early-access Agents API SDK.

The Agents API runs durable, long-running agents in the cloud using the managed Codex harness.

OpenAI manages sessions, orchestration, context compaction, and recovery while your application provides tools and chooses its execution environment.

Agents can operate in a sandbox where they can execute code, edit files, connect to MCP servers, and produce artifacts. Conversation-only sessions run without a sandbox and can still use configured service-connected tools.

## Core concepts

The Agents API is built around four main concepts:

1.  **Agent:** The model, instructions, tools, and MCP servers available to the agent.
2.  **Environment:** An optional sandbox or computer where the agent accesses files, loads skills, and runs commands.
3.  **Session:** A durable instance of an agent that works on tasks and responds to input.
4.  **Events and items:** The inputs sent to an agent and the output produced during a session.

A session can use any of these environment types:

| Environment | Use it when |
| --- | --- |
| `none` | The agent only needs conversation, reasoning, or service-connected tools. |
| `self_hosted` | You need to provide and control the sandbox or use your own infrastructure. |
| `openai_hosted` | OpenAI should manage the sandbox. Sandbox execution remains in limited preview. |

See [Agent Configuration](./12-agent-and-environment-config.md#environment-settings) for environment setup and SDK availability.

The way it works is:

1.  You create a session, passing in the agent and environment configurations.
2.  `none` starts without an execution environment, your executor connects a `self_hosted` sandbox, or OpenAI provisions an `openai_hosted` sandbox.
3.  You send a user input event to the session, which causes the agent to start running.
4.  Stream the agent’s output or use webhooks to learn when it finishes or needs input.
5.  Send follow-up input or steer the agent while it works.

![An application server creates a hosted agent, starts a sandbox, and connects the sandbox executor to the agent.](https://preview-docs-git-agents-alpha-openai.vercel.app/images/agents-api/overview-1.webp)

## What the managed harness provides

The managed Codex harness supports:

1.  Using a computer through a terminal or GUI.
2.  Applying relevant skills and instructions.
3.  Connecting to external data through tools or MCP.
4.  Steering the agent while it works.
5.  Summarizing previous work to manage its context window.
6.  Waiting for human approval when needed.
7.  Breaking work into subtasks and delegating to subagents.
8.  Resuming a session where it left off.

Configure these capabilities when you create a session:

**cURL**

```bash
curl -sS -X POST "https://api.openai.com/v1/agents/sessions" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": {
      "model": "gpt-5.6",
      "instructions": "Use the OpenAI documentation MCP and web search to answer technical questions accurately. Delegate independent research tasks to subagents when useful.",
      "tools": [
        {
          "type": "programmatic_tool_calling"
        },
        {
          "type": "mcp",
          "server_label": "openai_docs",
          "transport": {
            "type": "http",
            "server_url": "https://developers.openai.com/mcp"
          }
        },
        {
          "type": "web_search"
        }
      ],
      "multi_agent": {
        "type": "enabled",
        "max_agents": 4
      }
    },
    "environment": {
      "type": "self_hosted",
      "workspace_directory": "/workspace",
      "capability_directories": ["/workspace/capabilities/skills"]
    },
    "input": [
      {
        "role": "user",
        "content": [
          {
            "type": "input_text",
            "text": "Research how to connect an MCP server to an OpenAI agent, check for recent updates, and summarize the recommended setup."
          }
        ]
      }
    ]
  }'
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
            "Use the OpenAI documentation MCP and web search to answer "
            "technical questions accurately. Delegate independent research "
            "tasks to subagents when useful."
        ),
        "tools": [
            {"type": "programmatic_tool_calling"},
            {
                "type": "mcp",
                "server_label": "openai_docs",
                "transport": {
                  "type": "http",
                  "server_url": "https://developers.openai.com/mcp"
                },
            },
            {"type": "web_search"},
        ],
        "multi_agent": {"type": "enabled", "max_agents": 4},
    },
    environment={
        "type": "self_hosted",
        "workspace_directory": "/workspace",
        "capability_directories": ["/workspace/capabilities/skills"],
    },
    input=[
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": (
                        "Research how to connect an MCP server to an OpenAI "
                        "agent, check for recent updates, and summarize "
                        "the recommended setup."
                    ),
                }
            ],
        }
    ],
)
```

**TypeScript**

```typescript
import { AgentAPISDK } from "@openai/agents-api-preview";

const client = new AgentAPISDK();

const session = await client.beta.agents.sessions.create({
  agent: {
    model: "gpt-5.6",
    instructions:
      "Use the OpenAI documentation MCP and web search to answer technical " +
      "questions accurately. Delegate independent research tasks to subagents when useful.",
    tools: [
      { type: "programmatic_tool_calling" },
      {
        type: "mcp",
        server_label: "openai_docs",
        transport: {
          type: "http",
          server_url: "https://developers.openai.com/mcp",
        },
      },
      { type: "web_search" },
    ],
    multi_agent: { type: "enabled", max_agents: 4 },
  },
  environment: {
    type: "self_hosted",
    workspace_directory: "/workspace",
    capability_directories: ["/workspace/capabilities/skills"],
  },
  input: [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text:
            "Research how to connect an MCP server to an OpenAI agent, " +
            "check for recent updates, and summarize the recommended setup.",
        },
      ],
    },
  ],
});
```

## Agents API vs other solutions

| Product | Who runs the agent loop | Primary abstraction |
| --- | --- | --- |
| Responses API | Your application, with optional hosted orchestration | Response |
| Agents API | OpenAI runs a managed Codex harness | Session |
| Agents SDK | The SDK runs inside your application | Agent run |
| Codex SDK | Your application controls Codex threads | Codex thread |

Use the Agents API when you want OpenAI to manage orchestration, durable sessions, and recovery while your application provides the execution environment and tools.
