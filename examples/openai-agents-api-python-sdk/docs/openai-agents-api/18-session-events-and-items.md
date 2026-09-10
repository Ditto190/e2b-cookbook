---
title: "Events and Items"
slug: session-events-and-items
order: 18
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/session-events-and-items
---

# Events and Items

The Agents API uses events and items to communicate with your agent and track its work.

Events show what is happening in real time. Input events tell the agent what to do, lifecycle events report changes to the session, and output events show the agent’s work as it is produced.

Items are the saved record of that work. They include your messages and the agent’s completed responses, but not the individual text deltas streamed along the way.

## Event types

Events flow in two directions. You send input events to the agent, which responds with lifecycle events that track the session and output events that show its work.

| Event group | What it describes |
| --- | --- |
| Input events | Messages and other instructions sent to the agent. |
| Lifecycle events | Changes to the session, its turns, its items, or its environment. |
| Output events | Messages and other output produced by the agent. |

## Input events

Input events tell the agent what to do.

| Event | What it does |
| --- | --- |
| `session.input.message` | Sends a message to the agent. |
| `session.input.cancel` | Cancels the current turn. |
| `session.input.tool_result` | Returns a result requested by the agent. |

Before you send session input, connect to the live event stream shown in [Output events](#output-events). The event stream does not replay past events, so subscribing after you submit input can miss output or terminal events.

Send an input event to the session’s event endpoint.

**cURL**

```bash
curl "https://api.openai.com/v1/agents/sessions/$SESSION_ID/events" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "type": "session.input.message",
        "input": [
          {
            "role": "user",
            "content": [
              {
                "type": "input_text",
                "text": "Research Acme Corp and summarize its competitive position."
              }
            ]
          }
        ]
      }
    ]
  }'
```

**SDK**

**Python**

```python
session = await client.sessions.retrieve(SESSION_ID)
await session.input("Continue the session and summarize your work.")
```

**TypeScript**

```typescript
const session = await client.beta.agents.sessions.retrieve(sessionId);
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
              text: "Research Acme Corp and summarize its competitive position.",
            },
          ],
        },
      ],
    },
  ],
});
```

## Lifecycle events

A session is made up of turns, and each turn contains items that record the agent’s work. If the session has an environment, it also tracks whether that environment is ready.

Lifecycle events report changes across each of these parts.

- Session events track whether the agent is working or ready for another message.
- Turn events track when a cycle of work begins and ends.
- Item events track when an individual item within a turn is created or completed.
- Environment events track when an environment becomes available.

**Session lifecycle**

Session lifecycle events describe the state of the session as a whole.

| Event | What it means |
| --- | --- |
| `session.created` | The session was created. |
| `session.in_progress` | The agent is working. |
| `session.requires_action` | The session needs a function result or connection. |
| `session.idle` | The session is ready for another message. |
| `session.failed` | The session failed. |

**Turn lifecycle**

Turn lifecycle events describe a single cycle of work.

| Event | What it means |
| --- | --- |
| `session.turn.created` | A new turn was created. |
| `session.turn.in_progress` | The agent started working on the turn. |
| `session.turn.completed` | The turn finished successfully. |
| `session.turn.failed` | The turn failed. |
| `session.turn.cancelled` | The turn was cancelled. |

When a turn finishes successfully, the session emits `session.turn.completed`, followed by `session.idle` when it is ready for another message. Failed and cancelled turns can also be followed by `session.idle`; check for `session.turn.failed` and `session.turn.cancelled` before treating an idle session as successful.

**Item lifecycle**

Item lifecycle events describe when an item is added to a turn and when it reaches its final state.

| Event | What it means |
| --- | --- |
| `session.turn.item.added` | An item was added to the turn. |
| `session.turn.item.done` | An output item reached its final state. |

An item can receive multiple output events between these two lifecycle events.

**Environment lifecycle**

If a session uses an environment, environment lifecycle events report its status.

| Event | What it means |
| --- | --- |
| `session.environment.pending` | The environment is being prepared. |
| `session.environment.connected` | The environment is ready. |
| `session.environment.failed` | The environment failed to connect. |

## Output events

Output events describe what the agent produces while it works.

| Output | Event | What it means |
| --- | --- | --- |
| Output item | `agent.output.item` | The agent produced an output item. |
| Assistant text | `session.turn.output_text.added` | An assistant text block was added. |
| Assistant text | `session.turn.output_text.delta` | Another piece of assistant text arrived. |
| Assistant text | `session.turn.output_text.done` | The text block is complete. |
| Reasoning summary | `session.turn.reasoning_summary_text.added` | A reasoning summary was started. |
| Reasoning summary | `session.turn.reasoning_summary_text.delta` | Another piece of summary text arrived. |
| Reasoning summary | `session.turn.reasoning_summary_text.done` | The reasoning summary is complete. |
| Command output | `agent.output.command_execution_output.delta` | Another piece of command output arrived. |

For assistant text and reasoning summaries, `.added` marks the start of a content block, `.delta` adds to it, and `.done` contains the complete text.

You can listen to these output events by:

1.  Opening the event stream to follow the agent as it works.

**cURL**

```bash
curl -N "https://api.openai.com/v1/agents/sessions/$SESSION_ID/events?stream=true" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Accept: text/event-stream"
```

**SDK**

**Python**

```python
session = await client.sessions.retrieve(SESSION_ID)

async for event in session.stream():
    if event.type == "session.turn.failed":
        message = event.error.message if event.error is not None else "The agent turn failed."
        raise RuntimeError(message)
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

Alternatively, retrieve the completed output items:

**cURL**

```bash
curl "https://api.openai.com/v1/agents/sessions/$SESSION_ID/items" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

**SDK**

**Python**

```python
items = await session.list_items()
```

**TypeScript**

```typescript
const items = await client.beta.agents.sessions.items.list(session.id);
```

## How events become items

Events show the work while it is happening. Items capture what that work produced.

An assistant response can move through the following sequence.

```text
session.turn.item.added
session.turn.output_text.added
session.turn.output_text.delta
session.turn.output_text.delta
session.turn.output_text.done
session.turn.item.done
```

Each delta contains another piece of the same response.

```json
{
  "type": "session.turn.output_text.delta",
  "event_id": "evt_123",
  "item_id": "msg_789",
  "output_index": 0,
  "content_index": 0,
  "delta": "Acme competes on price"
}
```

```json
{
  "type": "session.turn.output_text.delta",
  "event_id": "evt_124",
  "item_id": "msg_789",
  "output_index": 0,
  "content_index": 0,
  "delta": " and distribution."
}
```

The `.done` event contains the complete text.

```json
{
  "type": "session.turn.output_text.done",
  "event_id": "evt_125",
  "item_id": "msg_789",
  "output_index": 0,
  "content_index": 0,
  "text": "Acme competes on price and distribution."
}
```

The completed item contains that text along with the rest of the message.

```json
{
  "type": "session.turn.item.done",
  "event_id": "evt_126",
  "turn_id": "turn_456",
  "output_index": 0,
  "item": {
    "id": "msg_789",
    "type": "message",
    "turn_id": "turn_456",
    "role": "assistant",
    "status": "completed",
    "phase": "final_answer",
    "content": [
      {
        "type": "output_text",
        "text": "Acme competes on price and distribution."
      }
    ]
  }
}
```

Every event has its own `event_id`. The output events share an `item_id`, which matches the `id` of the completed item.

Unlike an individual delta, the item includes the full message, its status, and whether it represents commentary or the agent’s final answer.

## Event fields

Events include identifiers that connect them to the relevant session, turn, or item.

| Field | What it identifies |
| --- | --- |
| `event_id` | The individual event. |
| `session_id` | The session associated with the event. |
| `turn_id` | The turn associated with the event. |
| `item_id` | The item being updated. |
| `output_index` | The item’s position in the turn output. |
| `content_index` | The content block being updated within the item. |

Not every event includes every field. A `session.idle` event describes the session itself, while a text delta includes `item_id` because it updates a specific message.

Command items include the `turn_id` of the turn that ran the command. Retrieve that turn to identify the delegated agent:

**SDK**

**Python**

```python
turn = await client.sessions.turns.retrieve(SESSION_ID, command["turn_id"])
print(turn.subagent_id)
```

**TypeScript**

```typescript
const turn = await client.beta.agents.sessions.turns.retrieve(
  sessionId,
  command.turn_id
);
console.log(turn.subagent_id);
```

`subagent_id` is `null` when the root agent ran the command.
