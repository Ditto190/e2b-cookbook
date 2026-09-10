---
title: "Sessions"
slug: sessions
order: 16
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/sessions
---

# Sessions

A session is an instance of an agent that keeps its configuration and conversation over time. This lets you return to the same agent, send follow-up messages, and continue where you left off.

The agent processes each request in a cycle of work called a turn. Turns run asynchronously, so the API responds immediately while the agent works in the background.

## How sessions work

1.  Create a session and send a message to start a turn.
2.  Follow the agent through the event stream, or use webhooks to find out when it finishes or needs your input.
3.  When the turn finishes, the session becomes idle and its output is saved as session items. If the session has an environment, any artifacts remain there.
4.  Send another message to start a new turn and continue where you left off.

If you send a message while the agent is still working, it becomes part of the current turn and can guide what the agent does next.

## Create a session

Create a session by providing an agent and environment configuration:

**cURL**

```bash
curl https://api.openai.com/v1/agents/sessions \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": {
      "model": "gpt-5.6",
      "instructions": "Research the request and explain your conclusions."
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
        "instructions": "Research the request and explain your conclusions.",
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
    instructions: "Research the request and explain your conclusions.",
  },
  environment: {
    type: "self_hosted",
    workspace_directory: "/workspace",
  },
});
```

The response contains the session and its environment:

```json
{
  "id": "sess_123",
  "object": "agent.session",
  "status": "idle",
  "agent": {
    "model": "gpt-5.6"
  },
  "environment": {
    "type": "self_hosted",
    "id": "env_456"
  }
}
```

Save the session ID. You will use it whenever you interact with the session.

Use the environment ID to connect a sandbox to the session. See [Self-hosted Sandboxes](./04-connect-to-a-sandbox.md).

## Send input

Send a user message to start a turn:

**cURL**

```bash
curl \
  "https://api.openai.com/v1/agents/sessions/$SESSION_ID/events" \
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
                "text": "List the files in the current directory."
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
await session.input("List the files in the current directory.")
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
              text: "List the files in the current directory.",
            },
          ],
        },
      ],
    },
  ],
});
```

You can also create a session and start its first turn in the same request by providing `input`. Initial input is required when `environment.type` is `none`:

**cURL**

```bash
curl https://api.openai.com/v1/agents/sessions \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": {
      "model": "gpt-5.6",
      "instructions": "Answer the user clearly and concisely."
    },
    "environment": {
      "type": "none"
    },
    "input": [
      {
        "role": "user",
        "content": [
          {
            "type": "input_text",
            "text": "What can you help with?"
          }
        ]
      }
    ]
  }'
```

**SDK**

```python
session = await client.sessions.create(
    agent={
        "model": "gpt-5.6",
        "instructions": "Answer the user clearly and concisely.",
    },
    environment={"type": "none"},
    input="What can you help with?",
)
```

## Stream the agent’s response

Open the session’s event stream to follow the agent while it works:

**cURL**

```bash
curl -N \
  "https://api.openai.com/v1/agents/sessions/$SESSION_ID/events?stream=true" \
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
```

The stream shows the agent’s output and reports changes to the session as work progresses. A failed or cancelled turn can also be followed by `session.idle`, so check `session.turn.failed` and `session.turn.cancelled` before treating an idle session as a successful turn.

```text
session.turn.created
session.turn.in_progress
session.in_progress

session.turn.output_text.delta
session.turn.output_text.delta
session.turn.output_text.done

session.turn.completed
session.idle
```

See [Events and Items](./18-session-events-and-items.md).

## Send a follow-up message

You can send a follow-up message at any time using `session.input.message`.

If the agent is still working, your message steers the current turn. If it has finished, your message starts a new one. You’ll know the agent is ready when it emits `session.turn.completed`, followed by `session.idle`.

## Cancel an active turn

Cancel the current turn without deleting the session or its previous work:

**cURL**

```bash
curl "https://api.openai.com/v1/agents/sessions/$SESSION_ID/events" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"events":[{"type":"session.input.cancel"}]}'
```

**SDK**



**Python**

```python
await session.cancel()
```

**TypeScript**

```typescript
await client.beta.agents.sessions.events.create(sessionId, {
  events: [{ type: "session.input.cancel" }],
});
```

## Retrieve a session

Check the current state of a session.

**cURL**

```bash
curl \
  "https://api.openai.com/v1/agents/sessions/$SESSION_ID" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

**SDK**

**Python**

```python
session = await client.sessions.retrieve(SESSION_ID)
```

**TypeScript**

```typescript
const session = await client.beta.agents.sessions.retrieve(sessionId);
```

The response includes the current session status:

```json
{
  "id": "sess_123",
  "object": "agent.session",
  "status": "in_progress",
  "required_actions": []
}
```

| Status | What it means |
| --- | --- |
| `idle` | The agent has finished its work and is ready for another message. |
| `in_progress` | The agent is working on a turn. |
| `requires_action` | The agent needs a function result or environment connection. |
| `failed` | The agent encountered an error and has paused. |

When a session requires action, retrieve it and inspect `session.required_actions`. There is no `waiting` session status.

To see the agent’s actual work, you can retrieve the session’s items.

## Retrieve session items

Items contain the messages and tool calls from a session. They remain available after the agent finishes.

**cURL**

```bash
curl \
  "https://api.openai.com/v1/agents/sessions/$SESSION_ID/items" \
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
const items = await client.beta.agents.sessions.items.list(session.id, {
  order: "asc",
  limit: 100,
});
```

An item is different from an event. Events show the agent’s work as it happens, while items contain the saved result.

For example, a response might arrive in two events.

```json
{
  "type": "session.turn.output_text.delta",
  "item_id": "msg_789",
  "delta": "Acme competes primarily on price"
}
```

```json
{
  "type": "session.turn.output_text.delta",
  "item_id": "msg_789",
  "delta": " and its nationwide distribution network."
}
```

Both events belong to the same item. Once the response is complete, the item contains the full text.

```json
{
  "id": "msg_789",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "output_text",
      "text": "Acme competes primarily on price and its nationwide distribution network."
    }
  ]
}
```

The `item_id` on each event matches the item’s `id`.

See [Events and Items](./18-session-events-and-items.md).

## How to recover a disconnected stream

Session event streams are live-only. Reopening the stream does not replay events that were emitted while you were disconnected.

To recover the state, you can:

1.  Open a new event stream and temporarily buffer incoming events.
2.  Fetch the session and its persisted items while the new stream remains connected.
3.  Replace your local state with the returned items, using each item’s `id` as its key.
4.  Reconcile buffered events with those items using each event’s `item_id`.
5.  Resume processing new events from the live stream.

If a buffered event refers to an item already completed in the retrieved state, use the saved item and discard the event. A later `.done` event contains the complete text and can replace any temporary display buffer.

You can recover completed work, but you cannot reconstruct every intermediate event that occurred while the stream was disconnected.
