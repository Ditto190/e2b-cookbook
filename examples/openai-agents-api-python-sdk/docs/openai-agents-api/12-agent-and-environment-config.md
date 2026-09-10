---
title: "Agent Configuration"
slug: agent-and-environment-config
order: 12
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/agent-and-environment-config
---

# Agent Configuration

Agent configuration controls the model, instructions, reasoning settings, and tools.

Environment configuration determines where the agent runs and whether it can access a sandbox.

![A Codex agent combines custom tools, skills, MCP servers, programmatic tool calling, and a connected sandbox executor.](https://preview-docs-git-agents-alpha-openai.vercel.app/images/agents-api/agent-configuration-1.webp)

## Agent settings

| Field | Description |
| --- | --- |
| `model` | Model the agent uses, such as `"gpt-5.6"`. |
| `instructions` | The agent’s role and guidance for the session. |
| `reasoning.effort` | How much reasoning the model applies. Accepts `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. |
| `reasoning.summary` | Reasoning summary format. Accepts `auto`, `concise`, or `detailed`. |
| `text.verbosity` | How detailed the agent’s responses should be. Accepts `low`, `medium`, or `high`. |
| `text.format` | JSON Schema for structured output. |
| `service_tier` | Processing tier for model requests. Accepts `auto`, `default`, `flex`, `priority`, or `fast`. |
| `tools` | Tools available to the agent, including application-defined functions, MCP tools, and programmatic tool calling. |
| `multi_agent` | Subagent settings, including how many agents can run concurrently. Disabled by default. |

Reasoning summaries are disabled by default. Existing integrations that need the previous behavior must explicitly set `agent.reasoning.summary` to `"auto"`. For a stored Python agent, pass `reasoning={"summary": "auto"}`; for an inline agent, include `"reasoning": {"summary": "auto"}` in its configuration.

Programmatic tool calling is enabled by default. To disable it, include `{ "type": "programmatic_tool_calling", "enabled": false }` in `agent.tools`. Omitting the tool entry or its `enabled` field leaves it enabled.

### Create a configured agent

Pass the agent configuration when you create a session.

**cURL**

```bash
curl https://api.openai.com/v1/agents/sessions \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": {
      "model": "gpt-5.6",
      "instructions": "You are a helpful coding assistant.",
      "reasoning": {
        "effort": "medium",
        "summary": "auto"
      },
      "text": {
        "verbosity": "medium"
      },
      "service_tier": "auto",
      "tools": [
        {
          "type": "programmatic_tool_calling"
        },
        {
          "type": "web_search",
          "mode": "live"
        }
      ],
      "multi_agent": {
        "type": "enabled",
        "max_agents": 4
      }
    },
    "environment": {
      "type": "none"
    },
    "input": [
      {
        "role": "user",
        "content": [{ "type": "input_text", "text": "Explain what you can help with." }]
      }
    ]
  }'
```

**SDK**

**Python**

```python
session = await client.sessions.create(
    agent={
        "model": "gpt-5.6",
        "instructions": "You are a helpful coding assistant.",
        "reasoning": {"effort": "medium", "summary": "auto"},
        "text": {"verbosity": "medium"},
        "service_tier": "auto",
        "tools": [
            {"type": "programmatic_tool_calling"},
            {"type": "web_search", "mode": "live"},
        ],
        "multi_agent": {"type": "enabled", "max_agents": 4},
    },
    environment={"type": "none"},
    input="Explain what you can help with.",
)
```

**TypeScript**

```typescript
const session = await client.beta.agents.sessions.create({
  agent: {
    model: "gpt-5.6",
    instructions: "You are a helpful coding assistant.",
    reasoning: { effort: "medium", summary: "auto" },
    tools: [
      { type: "programmatic_tool_calling" },
      { type: "web_search", mode: "live" },
    ],
    multi_agent: { type: "enabled", max_agents: 4 },
  },
  environment: { type: "none" },
  input: [
    {
      role: "user",
      content: [
        { type: "input_text", text: "Explain what you can help with." },
      ],
    },
  ],
});
```

### Reuse an agent across sessions

Create a reusable agent once, then reference its ID when starting a session:

```python
agent = await client.agents.create(
    model="gpt-5.6",
    instructions="Answer technical questions accurately.",
    reasoning={"summary": "auto"},
)

session = await client.sessions.create(
    agent={"type": "agent_reference", "agent_id": agent.id},
    environment={"type": "none"},
    input="Explain how an agent connects to an MCP server.",
)
```

Use `client.agents.list()`, `client.agents.retrieve(agent.id)`, `client.agents.update(agent.id, ...)`, and `client.agents.delete(agent.id)` to manage stored agents. Credentials remain in vaults and are not stored on the agent.

## Environment settings

A session supports three environment types:

| Environment | Who manages it | Choose it when |
| --- | --- | --- |
| `none` | No sandbox is created. | The agent needs reasoning, function tools, web search, or service-connected MCP tools, but not shell or filesystem access. |
| `self_hosted` | Your application or sandbox provider manages the sandbox. | You need custom infrastructure, private-network access, or full control over the execution environment. |
| `openai_hosted` | OpenAI provisions and manages the sandbox. | You need an OpenAI-managed environment; sandbox execution remains in limited preview. |

### No sandbox

Set `environment.type` to `none` when the agent does not need a shell, local files, or a workspace. It can still respond and use its configured tools.

Sandbox-only fields such as `workspace_directory` and `capability_directories` do not apply here. Conversation-only sessions require an initial `input` when they are created.

### Self-hosted sandbox

Set `environment.type` to `self_hosted` when the agent needs to run commands, work with files, or use software installed in your sandbox.

`workspace_directory` is the agent’s working directory. If the sandbox contains skills or plugins, add their locations to `capability_directories`.

### OpenAI-hosted sandbox

Set `environment.type` to `openai_hosted` to let OpenAI create and manage the sandbox. Hosted environments support package installation, initial files, network policies, skills, plugins, and reusable environment templates. Files written to `/workspace/outputs` become durable [session artifacts](./32-api-reference.md#session-artifacts) when a turn completes.

Hosted sandbox execution remains in limited preview. Shell and filesystem operations may currently fail with `sandbox_error`; use `self_hosted` when your workflow requires reliable sandbox execution.

The current Python and TypeScript preview SDKs do not yet expose `openai_hosted`. Use the HTTP API until hosted environment support is added to those SDKs.

### Environment fields

| Field | Description |
| --- | --- |
| `type` | Selects `none`, `self_hosted`, or `openai_hosted`. |
| `environment_template_id` | Optional reusable template for an OpenAI-hosted or self-hosted sandbox. |
| `workspace_directory` | Working directory in a `self_hosted` sandbox, such as `/workspace`. |
| `capability_directories` | Optional directories containing skills and plugins in either sandbox type. |
| `packages` | Python, system, or npm packages to install in an OpenAI-hosted sandbox. |
| `network` | Network access policy for an OpenAI-hosted sandbox. |
| `files` | Initial Files API references or inline files for an OpenAI-hosted sandbox. |
| `skills`, `plugins` | Skills or plugins installed into an OpenAI-hosted sandbox. |

### Configure a self-hosted environment

Create a session with `type` set to `self_hosted` and provide the workspace directory.

**cURL**

```bash
curl https://api.openai.com/v1/agents/sessions \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": {
      "model": "gpt-5.6"
    },
    "environment": {
      "type": "self_hosted",
      "workspace_directory": "/workspace"
    }
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
    },
    environment={
        "type": "self_hosted",
        "workspace_directory": "/workspace",
    },
)
```

**TypeScript**

```typescript
import { AgentAPISDK } from "@openai/agents-api-preview";

const client = new AgentAPISDK();

const session = await client.beta.agents.sessions.create({
  agent: { model: "gpt-5.6" },
  environment: {
    type: "self_hosted",
    workspace_directory: "/workspace",
  },
});
```

After creating the session, connect your sandbox using the session’s environment ID. For setup details, see [Self-hosted Sandboxes](./04-connect-to-a-sandbox.md).

### Configure an OpenAI-hosted environment

Create a managed sandbox directly through the HTTP API:

```bash
curl https://api.openai.com/v1/agents/sessions \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": { "model": "gpt-5.6" },
    "environment": { "type": "openai_hosted" }
  }'
```

OpenAI provisions the sandbox automatically; you do not start or connect an external executor. Shell and filesystem access remain subject to the hosted preview limitation above.

**Configure an environment with no sandbox**

Set `type` to `none`. No workspace directory or sandbox runner is needed:

```json
{
  "type": "none"
}
```
