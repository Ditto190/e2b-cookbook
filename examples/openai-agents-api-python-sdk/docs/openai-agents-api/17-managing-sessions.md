---
title: "Manage Sessions"
slug: managing-sessions
order: 17
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/managing-sessions
---

# Manage Sessions

Sessions remain available after the agent finishes, so you can continue to manage them through the Agents API.

1.  List your sessions.
2.  Retrieve a session.
3.  Inspect its turns and identify delegated work.
4.  Delete a session.

## List sessions

Retrieve the sessions available to your project. The results are paginated.

**cURL**

```bash
curl "https://api.openai.com/v1/agents/sessions" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

**SDK**



**Python**

```python
sessions = await client.sessions.list(limit=20, order="desc")
```

**TypeScript**

```typescript
const sessions = await client.beta.agents.sessions.list({
  limit: 20,
  order: "desc",
});
```

The response includes a page of sessions and a cursor for the next page.

```json
{
  "object": "list",
  "page": [
    {
      "id": "sess_123",
      "object": "agent.session",
      "status": "idle"
    },
    {
      "id": "sess_456",
      "object": "agent.session",
      "status": "in_progress"
    }
  ],
  "has_more": true,
  "next_cursor": "cursor_789"
}
```

Use `cursor` to retrieve the next page.

**cURL**

```bash
curl "https://api.openai.com/v1/agents/sessions?cursor=cursor_789&limit=20" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

**SDK**



**Python**

```python
sessions = await client.sessions.list(cursor=cursor, limit=20)
```

**TypeScript**

```typescript
const sessions = await client.beta.agents.sessions.list({
  cursor,
  limit: 20,
});
```

## Retrieve a session

Retrieve a session to check its status and configuration.

**cURL**

```bash
curl "https://api.openai.com/v1/agents/sessions/$SESSION_ID" \
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

The response includes the session’s status and current configuration.

```json
{
  "id": "sess_123",
  "object": "agent.session",
  "status": "idle"
}
```

| Status | What it means |
| --- | --- |
| `in_progress` | The agent is working. |
| `idle` | The agent has finished and can accept another message. |
| `requires_action` | A function result or environment connection is required. |
| `failed` | The session encountered an error. |

## Inspect session turns

List turns to inspect their status, timestamps, usage, and delegated-agent attribution. Results are ordered by creation time and turn ID.

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

if turns.has_more and turns.last_id is not None:
    next_turns = await client.sessions.turns.list(
        SESSION_ID, after=turns.last_id, limit=20, order="desc"
    )
```

**TypeScript**

```typescript
const turns = await client.beta.agents.sessions.turns.list(sessionId, {
  limit: 20,
  order: "desc",
});

if (turns.has_more && turns.last_id) {
  const nextTurns = await client.beta.agents.sessions.turns.list(sessionId, {
    after: turns.last_id,
    limit: 20,
    order: "desc",
  });
}
```

To find the delegated agent that ran a command, use the command item’s `turn_id` to retrieve its turn:

**SDK**

**Python**

```python
turn = await client.sessions.turns.retrieve(SESSION_ID, command["turn_id"])
subagent_id = turn.subagent_id
```

**TypeScript**

```typescript
const turn = await client.beta.agents.sessions.turns.retrieve(
  sessionId,
  command.turn_id
);
const subagentId = turn.subagent_id;
```

`subagent_id` is `null` for root-agent work. A turn that does not belong to the requested session returns `404`.

## Delete a session

Delete a session when you no longer need it.

**cURL**

```bash
curl -X DELETE \
  "https://api.openai.com/v1/agents/sessions/$SESSION_ID" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

**SDK**



**Python**

```python
deleted_session = await client.sessions.delete(session_id)
```

**TypeScript**

```typescript
const deletedSession = await client.beta.agents.sessions.delete(sessionId);
```

The API confirms the deletion.

```json
{
  "id": "sess_123",
  "object": "agent.session.deleted",
  "deleted": true
}
```
