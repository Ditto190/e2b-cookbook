---
title: "Multi-agent"
slug: multiagent-delegation
order: 15
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/multiagent-delegation
---

# Multi-agent

Multi-agent lets an agent delegate work to other agents. This is useful because:

1.  Larger tasks can be split into smaller subtasks that run in parallel, reducing the time needed to complete them.
2.  Each subagent has its own context, helping it stay focused without filling the coordinator’s context with unnecessary details.

## How it works

Your session’s agent acts as the coordinator:

1.  It calls `spawn_agent` to start one or more subagents. Each runs asynchronously in its own context.
2.  It can send follow-ups with `send_input` while the subagents are running.
3.  It calls `wait` to get their results, `resume_agent` to resume a subagent, and `close_agent` to close one.

When a sandbox is present, all agents share its environment and filesystem. Multi-agent delegation also works without a sandbox when `environment.type` is `none`.

## Enable multi-agent orchestration

Multi-agent orchestration is disabled by default. To enable it, set `multi_agent` in the agent configuration:

**cURL**

```bash
curl https://api.openai.com/v1/agents/sessions \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": {
      "model": "gpt-5.6",
      "instructions": "Prepare release notes from the repository. Have one subagent identify customer-visible changes and another check migration guides and examples, then combine their findings.",
      "multi_agent": {
        "type": "enabled",
        "max_agents": 3
      }
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
session = await client.sessions.create(
    agent={
        "model": "gpt-5.6",
        "instructions": (
            "Prepare release notes from the repository. Have one subagent "
            "identify customer-visible changes and another check migration "
            "guides and examples, then combine their findings."
        ),
        "multi_agent": {
            "type": "enabled",
            "max_agents": 3,
        },
    },
    environment={"type": "self_hosted", "workspace_directory": "/workspace"},
)
```

**TypeScript**

```typescript
const session = await client.beta.agents.sessions.create({
  agent: {
    model: "gpt-5.6",
    instructions:
      "Prepare release notes from the repository. Have one subagent " +
      "identify customer-visible changes and another check migration " +
      "guides and examples, then combine their findings.",
    multi_agent: {
      type: "enabled",
      max_agents: 3,
    },
  },
  environment: { type: "self_hosted", workspace_directory: "/workspace" },
});
```

The `multi_agent` object accepts:

- `type`: Set to `enabled` to add subagent coordination tools.
- `max_agents`: The maximum number of concurrent subagents. Defaults to `6`.

The root agent does not count toward `max_agents`. For example, `max_agents: 4` permits four concurrent subagents plus the root agent, for five active agents in total.

Subagent model, reasoning effort, interruption settings, and nesting depth are not currently configurable through the public Agents API. The effective model and reasoning effort are available on completed `spawn_agent_call` items.

## Subagent tools

Enabling multi-agent orchestration automatically adds these tools:

- `spawn_agent` creates a subagent and gives it a task.
- `send_input` sends additional instructions to an existing subagent.
- `wait` waits for one or more subagents to return results.
- `resume_agent` resumes an existing subagent.
- `close_agent` closes a subagent that is no longer needed.

You do not need to declare these in `agent.tools`. They will automatically be added when you enable multi-agent.

## Subagent events

The session event stream shows what happens as subagents run. Some events report a state change directly, such as a subagent being created. Others include an `item` describing a specific action the coordinator agent has made.

For example, when the main agent starts a subagent:

```json
{
  "type": "session.turn.item.done",
  "item": {
    "type": "spawn_agent_call",
    "status": "completed",
    "spawned_agent_id": "subagent_123",
    "content": [{ "type": "output_text", "text": "Review pull request #142." }],
    "model": "gpt-5.6",
    "reasoning_effort": "medium"
  }
}
```

When the subagent is created, the session emits an event:

```json
{
  "type": "session.subagent.created",
  "subagent": {
    "id": "subagent_123"
  }
}
```

The following events describe subagent activity:

| Event | Description |
| --- | --- |
| `session.subagent.created` | A subagent was created. |
| `session.subagent.closed` | A subagent was closed. |
| `session.turn.item.added` | A tool call or message was added by the coordinator. |
| `session.turn.item.done` | A tool call finished. |

For item events such as `session.turn.item.added`, `item.type` identifies the action:

| Item | Description |
| --- | --- |
| `spawn_agent_call` | A subagent was started. |
| `send_input_call` | A subagent received more instructions. |
| `wait_for_agents_call` | The main agent waited for results. |
| `resume_agent_call` | A subagent was resumed. |
| `close_agent_call` | A subagent was closed. |
| `agent_message` | A message was sent between agents. |

## Tools available to subagents

Subagents inherit the following from the main agent:

- MCP tools, including their credentials and allowed tools.
- Web search and its settings.
- Access to the same environment and filesystem.
- The main agent’s programmatic tool calling setting (enabled by default).

Subagents share the same sandbox, so they can access the same files, scripts, and CLIs.

Function tools ([Function Tools](./08-function-call-tools.md)) are not inherited.
