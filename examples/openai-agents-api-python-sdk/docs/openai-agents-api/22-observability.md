---
title: "Observability"
slug: observability
order: 22
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/observability
---

# Observability

Track live agent activity, inspect completed work, and review detailed turn traces:

1.  You can view the session logs in the Platform dashboard.
2.  You can follow the session through its events and saved history.
3.  You can inspect turns and identify delegated command execution.
4.  You can export completed-turn traces to a project collector.
5.  You can inspect detailed turn traces in the Platform dashboard.

## View the session in the dashboard

Go to [platform.openai.com/logs?api=agents](https://platform.openai.com/logs?api=agents) and open the **Agents** tab.

Search for a session by ID to inspect its turns, tool calls, and subagents.

Trace retrieval requires an authenticated Platform dashboard identity with tracing enabled. A project API key cannot read dashboard traces. Separate trace ingestion, when enabled for your project, accepts an application API key but does not grant trace-reading access.

## Follow events and inspect session history

Every session exposes an event stream that shows what the agent is doing in real time:

**cURL**

```bash
curl -N \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  "https://api.openai.com/v1/agents/sessions/$SESSION_ID/events?stream=true"
```

**SDK**

**Python**

```python
session = await client.sessions.retrieve(SESSION_ID)

async for event in session.stream():
    if event.type == "session.turn.failed":
        raise RuntimeError(event.error.message if event.error else "The agent turn failed.")
    if event.type == "session.turn.cancelled":
        raise RuntimeError("The agent turn was cancelled.")
    if event.type == "session.failed":
        raise RuntimeError(event.error or "The agent session failed.")
    print(event)
```

**TypeScript**

```typescript
const session = await client.beta.agents.sessions.retrieve(sessionId);

const events = await client.beta.agents.sessions.events.stream(session.id, {
  stream: true,
});

try {
  for await (const event of events) {
    if (event.type === "session.turn.failed") {
      throw new Error(event.error?.message ?? "The agent turn failed.");
    }
    if (event.type === "session.turn.cancelled") {
      throw new Error("The agent turn was cancelled.");
    }
    if (event.type === "session.failed") {
      throw new Error(event.session.error ?? "The agent session failed.");
    }
    console.log(event);
  }
} finally {
  events.controller.abort();
}
```

As the session runs, you’ll see events such as:

```text
session.environment.connected
session.turn.created
session.turn.in_progress
session.turn.item.added
session.turn.output_text.delta
session.turn.completed
session.idle
```

To inspect work that has already happened, retrieve the session’s saved items:

**cURL**

```bash
curl \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  "https://api.openai.com/v1/agents/sessions/$SESSION_ID/items?order=asc&limit=100"
```

**SDK**

**Python**

```python
items = await session.list_items(order="asc", limit=100)
```

**TypeScript**

```typescript
const items = await client.beta.agents.sessions.items.list(session.id, {
  order: "asc",
  limit: 100,
});
```

## Inspect turns and identify delegated commands

Session turns are available through the public API:

**cURL**

```bash
curl "https://api.openai.com/v1/agents/sessions/$SESSION_ID/turns?limit=20&order=desc" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

**SDK**

**Python**

```python
turns = await client.sessions.turns.list(SESSION_ID, limit=20, order="desc")
turn = await client.sessions.turns.retrieve(SESSION_ID, command["turn_id"])
print(turn.subagent_id)
```

**TypeScript**

```typescript
const turns = await client.beta.agents.sessions.turns.list(sessionId, {
  limit: 20,
  order: "desc",
});
const turn = await client.beta.agents.sessions.turns.retrieve(
  sessionId,
  command.turn_id
);
console.log(turn.subagent_id);
```

Use the returned `last_id` as the next page’s `after` value when `has_more` is `true`.

Command items contain `turn_id`. Retrieve that turn and read `subagent_id` to identify the delegated agent that ran the command. A `null` subagent ID identifies root-agent work. Command-output truncation is not reported.

## Export completed-turn traces

Create a project-scoped telemetry exporter, then attach it when you create a session:

Set `endpoint` to the collector’s base URL without `/v1/traces`; the service appends that path when exporting.

**SDK**

**Python**

```python
exporter = await client.telemetry.exporters.create(
    name="Production trace collector",
    endpoint="https://collector.example.com",
    headers={"Authorization": "Bearer YOUR_COLLECTOR_TOKEN"},
)

session = await client.sessions.create(
    agent={"model": "gpt-5.6"},
    environment={"type": "none"},
    input="Summarize the support request.",
    tracing={"enabled": True, "exporter_ids": [exporter.id]},
)
```

**TypeScript**

```typescript
const exporter = await client.beta.agents.telemetry.exporters.create({
  name: "Production trace collector",
  endpoint: "https://collector.example.com",
  headers: { Authorization: "Bearer YOUR_COLLECTOR_TOKEN" },
});

const session = await client.beta.agents.sessions.create({
  agent: { model: "gpt-5.6" },
  environment: { type: "none" },
  input: [
    {
      role: "user",
      content: [{ type: "input_text", text: "Summarize the support request." }],
    },
  ],
  tracing: { enabled: true, exporter_ids: [exporter.id] },
});
```

The collector must use public HTTPS on port `443`. Authentication header values are write-only; responses return `header_names` but never secret values. List exporters with `client.telemetry.exporters.list()` or `client.beta.agents.telemetry.exporters.list()` and pass `next_cursor` as `cursor` to request the next page.

Listing or retrieving exporters requires access to the project. Creating, updating, or deleting exporters requires project-owner permissions. Requests without the required project authorization return `403 Forbidden`.

When updating an unchanged endpoint, omit `headers` to keep existing credentials, pass `headers: null` to clear all credentials, or set an individual header to `null` to remove it. Changing the normalized endpoint clears all existing headers before applying any new header values.

## Inspect a turn trace

Use the Platform dashboard to inspect a completed turn and its agent activity. Detailed trace retrieval is not available through the preview SDK or an ordinary project API key. Dashboard trace endpoints require separate access and are not a supported customer API.

Token usage returned by sessions, turns, and lifecycle events describes the root agent only. The customer API does not return per-subagent token usage, but exported agent spans can include it. See [Inspect subagent token usage](./21-cost-and-caching.md#inspect-subagent-token-usage).

To attribute a shell command, retrieve the turn identified by its command item’s `turn_id`, then inspect `turn.subagent_id`. The customer API does not indicate whether command output was truncated.
