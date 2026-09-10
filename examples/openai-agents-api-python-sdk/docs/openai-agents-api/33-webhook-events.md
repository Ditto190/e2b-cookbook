---
title: "Webhook events"
slug: webhook-events
order: 33
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/webhook-events
---

# Webhook events

Webhooks notify your server when a session changes state. See [Webhooks](./20-webhooks.md) to set up an endpoint and verify deliveries.

All fields are required unless marked optional. Omitted fields are absent, not `null`.

## agent.session.created

Sent when a session is created. For self-hosted sessions, `data.connect` contains the executor connection URL.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | The event ID, distinct from the session ID. |
| `object` | "event" | The object type. |
| `created_at` | integer | When the event occurred, in Unix seconds. |
| `type` | "agent.session.created" | The event type. |
| `data` | object | The event payload, not a full session object. |
| `data.id` | string | The session ID. |
| `data.environment_type` | "none", "self\_hosted", or "openai\_hosted" | The session's environment type. |
| `data.environment_id` | string, optional | Present for self-hosted and OpenAI-hosted environments. Omitted for none. |
| `data.connect` | object, optional | Present only for a self-hosted session. Omitted for other environment types. |
| `data.connect.remote_url` | string | Required within connect. The URL to pass to codex exec-server --remote. |

**Object**

```json
{
  "id": "evt_123",
  "object": "event",
  "created_at": 1750287018,
  "type": "agent.session.created",
  "data": {
    "id": "sess_abc123",
    "environment_id": "ccarenv_abc123",
    "environment_type": "self_hosted",
    "connect": {
      "remote_url": "https://api.openai.com/v1/agents/api"
    }
  }
}
```

## agent.session.action\_required

Sent when the session needs a function result, initial environment connection, or reconnection. Retrieve the session and inspect `required_actions` for call IDs, arguments, or environment IDs; the webhook does not include those details.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | The event ID, distinct from the session ID. |
| `object` | "event" | The object type. |
| `created_at` | integer | When the event occurred, in Unix seconds. |
| `type` | "agent.session.action\_required" | The event type. |
| `data` | object | The event payload, not a full session object. |
| `data.id` | string | The session ID. |
| `data.required_action` | object | The action needed to continue the session. |
| `data.required_action.type` | "function\_call" or "environment\_connection" | The session needs a function result or an environment connection. |

**Object**

```json
{
  "id": "evt_124",
  "object": "event",
  "created_at": 1750287020,
  "type": "agent.session.action_required",
  "data": {
    "id": "sess_abc123",
    "required_action": {
      "type": "function_call"
    }
  }
}
```

## agent.session.in\_progress

Sent when the session starts processing a turn.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | The event ID, distinct from the session ID. |
| `object` | "event" | The object type. |
| `created_at` | integer | When the event occurred, in Unix seconds. |
| `type` | "agent.session.in\_progress" | The event type. |
| `data` | object | The event payload, not a full session object. |
| `data.id` | string | The session ID. |
| `data.environment_type` | "none", "self\_hosted", or "openai\_hosted" | The session's environment type. |
| `data.environment_id` | string, optional | Present for self-hosted and OpenAI-hosted environments. Omitted for none. |

**Object**

```json
{
  "id": "evt_125",
  "object": "event",
  "created_at": 1750287022,
  "type": "agent.session.in_progress",
  "data": {
    "id": "sess_abc123",
    "environment_id": "ccarenv_abc123",
    "environment_type": "self_hosted"
  }
}
```

## agent.session.idle

Sent when the session is idle and ready for more input.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | The event ID, distinct from the session ID. |
| `object` | "event" | The object type. |
| `created_at` | integer | When the event occurred, in Unix seconds. |
| `type` | "agent.session.idle" | The event type. |
| `data` | object | The event payload, not a full session object. |
| `data.id` | string | The session ID. |
| `data.environment_type` | "none", "self\_hosted", or "openai\_hosted" | The session's environment type. |
| `data.environment_id` | string, optional | Present for self-hosted and OpenAI-hosted environments. Omitted for none. |

**Object**

```json
{
  "id": "evt_126",
  "object": "event",
  "created_at": 1750287024,
  "type": "agent.session.idle",
  "data": {
    "id": "sess_abc123",
    "environment_id": "ccarenv_abc123",
    "environment_type": "self_hosted"
  }
}
```

## agent.session.failed

Sent when the session enters a failed state. Retrieve the session for failure details; this webhook does not include an `error` field.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | The event ID, distinct from the session ID. |
| `object` | "event" | The object type. |
| `created_at` | integer | When the event occurred, in Unix seconds. |
| `type` | "agent.session.failed" | The event type. |
| `data` | object | The event payload, not a full session object. |
| `data.id` | string | The session ID. |
| `data.environment_type` | "none", "self\_hosted", or "openai\_hosted" | The session's environment type. |
| `data.environment_id` | string, optional | Present for self-hosted and OpenAI-hosted environments. Omitted for none. |

**Object**

```json
{
  "id": "evt_127",
  "object": "event",
  "created_at": 1750287026,
  "type": "agent.session.failed",
  "data": {
    "id": "sess_abc123",
    "environment_id": "ccarenv_abc123",
    "environment_type": "self_hosted"
  }
}
```
