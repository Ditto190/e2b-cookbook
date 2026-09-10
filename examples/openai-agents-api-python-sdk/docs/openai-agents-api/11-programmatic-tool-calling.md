---
title: "Programmatic tool calling"
slug: programmatic-tool-calling
order: 11
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/programmatic-tool-calling
---

# Programmatic tool calling

Programmatic tool calling lets a model write and run JavaScript to coordinate its tools:

1.  Normally, chaining tool calls means putting each result into the model’s context and having the model copy it into the next call. That wastes tokens. With code mode, the model can write one script that passes data directly between tools.
2.  Tool results can be huge. Instead of loading everything into context, the model can save the results to the sandbox and use Bash to search or filter them, or hand them off to subagents.

![A hosted Codex agent runs programmatic tool calls in an isolated runtime and routes executor calls to a connected sandbox.](https://preview-docs-git-agents-alpha-openai.vercel.app/images/agents-api/agent-configuration-1.webp)

## Runtime environment

OpenAI runs each generated program in a fresh, isolated V8 runtime.

The runtime supports JavaScript with top-level `await`, but it does not provide Node.js, package installation, direct network access, a general-purpose filesystem, subprocess execution, a console, or persistent JavaScript state between program executions.

Programs can interact with external systems only through tools enabled in the request and can emit output with `text(...)` or `image(...)`.

Programmatic tool calling can also use Bash through an enabled shell tool. The JavaScript runtime does not start subprocesses directly; it calls the shell tool, which runs the command in the sandbox.

Unlike approaches that run orchestration code inside the sandbox, programmatic tool calling runs in the agent harness. Tools and MCPs are available directly to the JavaScript program, so you do not need to wrap them as CLIs or install them in the sandbox.

### Configure programmatic tool calling

Programmatic tool calling is enabled by default. To disable it, include `{ "type": "programmatic_tool_calling", "enabled": false }` in `agent.tools`. Omitting the tool entry or its `enabled` field leaves it enabled.

The examples below use the optional type-only entry, which keeps programmatic tool calling enabled.

**cURL**

```bash
curl https://api.openai.com/v1/agents/sessions \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg token "$GITHUB_TOKEN" '{
    "agent": {
      "model": "gpt-5.6",
      "tools": [
        {
          "type": "programmatic_tool_calling"
        },
        {
          "type": "mcp",
          "server_label": "github",
          "transport": {
            "type": "http",
            "server_url": "https://api.githubcopilot.com/mcp/x/issues/readonly",
            "authorization": ("Bearer " + $token)
          },
          "allowed_tools": [
            "search_issues",
            "issue_read"
          ]
        }
      ]
    },
    "environment": {
      "type": "self_hosted",
      "workspace_directory": "/workspace"
    }
  }')"
```

**SDK**

**Python**

```python
import os

session = await client.sessions.create(
    agent={
        "model": "gpt-5.6",
        "tools": [
            {"type": "programmatic_tool_calling"},
            {
                "type": "mcp",
                "server_label": "github",
                "transport": {
                    "type": "http",
                    "server_url": "https://api.githubcopilot.com/mcp/x/issues/readonly",
                    "authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
                },
                "allowed_tools": ["search_issues", "issue_read"],
            }
        ],
    },
    environment={
        "type": "self_hosted",
        "workspace_directory": "/workspace",
    },
)
```

**TypeScript**

```typescript
const session = await client.beta.agents.sessions.create({
  agent: {
    model: "gpt-5.6",
    tools: [
      { type: "programmatic_tool_calling" },
      {
        type: "mcp",
        server_label: "github",
        transport: {
          type: "http",
          server_url: "https://api.githubcopilot.com/mcp/x/issues/readonly",
          authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        },
        allowed_tools: ["search_issues", "issue_read"],
      },
    ],
  },
  environment: {
    type: "self_hosted",
    workspace_directory: "/workspace",
  },
});
```

The harness gives the agent an `exec` tool and makes the agent’s existing tools available inside it. The agent can then write JavaScript that orchestrates these tools.

Programmatic tool calling also works in conversation-only sessions with `environment.type` set to `none`. Bash, executor MCPs, and other sandbox-backed tools still require an execution environment.

Code mode orchestrates tools without changing how they run. Executor MCPs still use the sandbox, and function tools still call your application server. The agent processes their results before deciding what enters model context.

### Guide routing when both modes are available

If the model can call tools directly or combine them in code, tell it which approach to use for each part of the task. Otherwise, it may switch between the two, repeat calls, or use code where a simple direct call would be clearer.

Use code for a clearly defined stage, such as gathering information from several tools, comparing results, or performing calculations. Reserve direct calls for steps that require a separate decision, approval, or final check. For example:

```text
<tool_orchestration>
Use code-mode exec for [bounded stage] using only [eligible tools].
Run independent calls concurrently when safe. Use only documented
tool input and output fields.

Process and reduce the intermediate results, then emit exactly
[result shape] using text(JSON.stringify(result)), including the
evidence needed for the final answer.

Stop when [condition] is met. Retry transient failures at most
[R] times. Do not repeat completed calls or perform side-effecting
actions. If a required result is still missing, return a clear
structured failure.

Use direct tool calls for [approval or final validation].
</tool_orchestration>
```

Here is how this looks for a model checking whether a product has enough inventory to meet demand:

```text
<tool_orchestration>
Use code-mode exec to compare inventory with demand for sku_123 using
only get_inventory and get_demand. Run both calls concurrently. Use
only documented tool input and output fields.

Process and reduce the intermediate results, then emit exactly one
JSON object using text(JSON.stringify(result)) with sku,
available_units, requested_units, and shortage_units, where
shortage_units is Math.max(requested_units - available_units, 0).
Include available_units and requested_units as evidence.

Stop when both tool results contain the required fields. Retry
transient failures at most 1 time. Do not repeat completed calls or
perform side-effecting actions. If a required result is still
missing, return a clear structured failure.

Use direct tool calls only for approval before any inventory-changing
action.
</tool_orchestration>
```

The model gathers and compares information in code, then switches to a direct call only if approval is needed. Keep that handoff clear, and avoid repeating work across both approaches.
