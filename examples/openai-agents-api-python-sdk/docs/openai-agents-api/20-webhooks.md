---
title: "Webhooks"
slug: webhooks
order: 20
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/webhooks
---

# Webhooks

Use webhooks to respond to session state changes without keeping an event stream open. A webhook handler can [start or reconnect sandbox compute](./05-manage-sandbox-lifecycle.md#set-up-webhook-managed-sandboxes), update your application, or trigger a workflow.

## Supported events

Agents API webhooks support these lifecycle events:

| Event | When it fires |
| --- | --- |
| `agent.session.created` | A session is created. |
| `agent.session.action_required` | The session needs a function result, initial environment connection, or reconnection. |
| `agent.session.in_progress` | The session starts processing a turn. |
| `agent.session.idle` | The session is idle and ready for more input. |
| `agent.session.failed` | The session enters a failed state. |

An `agent.session.action_required` event includes the session ID and a `required_action.type` of `function_call` or `environment_connection`.

```json
{
  "type": "agent.session.action_required",
  "data": {
    "id": "sess_abc123",
    "required_action": { "type": "function_call" }
  }
}
```

Retrieve the session and inspect `required_actions` for call IDs, arguments, or environment IDs; the webhook does not include those details.

## Set up a webhook

1.  Open [**Project settings → Webhooks**](https://platform.openai.com/settings/project/webhooks).
2.  Create the webhook and enter the URL where you want to receive events.
3.  Select the events your handler supports.
4.  Store the generated signing secret with your handler.

## Receive events

OpenAI sends a signed HTTP POST request whenever a subscribed event occurs:

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

See [Webhook events](./33-webhook-events.md) for each event’s body fields and complete JSON example.

### Start the executor

For self-hosted sessions, `agent.session.created` includes the environment ID and connection URL needed to start an executor:

```bash
CODEX_API_KEY="$OPENAI_EXECUTOR_API_KEY" \
codex exec-server \
  --remote "$REMOTE_URL" \
  --environment-id "$ENVIRONMENT_ID"
```

Provide only a separate restricted `OPENAI_EXECUTOR_API_KEY` as `CODEX_API_KEY` before starting the executor. The executor key must belong to the same organization, project, and user or service account that owns the session. Grant it **List models → Read**, set every other permission to **None**, and keep the broader application key outside the sandbox. See [Self-hosted Sandboxes](./04-connect-to-a-sandbox.md).

## Verify and process events

For deployable sandbox handlers with provisioning queues, see [Webhook-managed provider examples](./05-manage-sandbox-lifecycle.md#choose-a-provider). The examples below focus on receiving and verifying events.

Verify each request using your webhook signing secret:

**SDK**

**Python**

Install Flask with async support (`flask[async]`).

```python
import json
import os

from agent_api_sdk import AgentAPISDK
from flask import Flask, request
from openai import InvalidWebhookSignatureError, OpenAI

app = Flask(__name__)
webhooks = OpenAI(webhook_secret=os.environ["OPENAI_WEBHOOK_SECRET"])

@app.post("/webhooks/openai")
async def handle_webhook():
    payload = request.get_data()
    try:
        webhooks.webhooks.verify_signature(payload=payload, headers=request.headers)
    except (InvalidWebhookSignatureError, ValueError):
        return "Invalid signature", 400

    event = json.loads(payload)
    if event["type"] == "agent.session.idle":
        async with AgentAPISDK() as agents:
            session = await agents.sessions.retrieve(event["data"]["id"])
        print("session idle event:", session.id)
    else:
        print("session event:", event["type"], event["data"]["id"])
    return "", 200
```

**TypeScript**

```typescript
import express from "express";
import { AgentAPISDK } from "@openai/agents-api-preview";
import OpenAI from "openai";

const app = express();
const webhooks = new OpenAI({
  webhookSecret: process.env.OPENAI_WEBHOOK_SECRET,
});
const agents = new AgentAPISDK();

app.post(
  "/webhooks/openai",
  express.raw({ type: "application/json" }),
  async (request, response) => {
    const payload = request.body.toString("utf8");
    try {
      await webhooks.webhooks.verifySignature(payload, request.headers);
    } catch {
      response.status(400).send("Invalid signature");
      return;
    }

    const event = JSON.parse(payload);
    if (event.type === "agent.session.idle") {
      const session = await agents.beta.agents.sessions.retrieve(event.data.id);
      console.log("session idle event:", session.id);
    } else {
      console.log("session event:", event.type, event.data.id);
    }
    response.sendStatus(200);
  }
);
```

## Environment connection events

When initial or follow-up input needs a disconnected self-hosted executor, the API adds an `environment_connection` required action and emits `agent.session.action_required` **before waiting** for the connection.

```json
{
  "type": "agent.session.action_required",
  "data": {
    "id": "sess_abc123",
    "required_action": { "type": "environment_connection" }
  }
}
```

Retrieve the session’s current `required_actions` for the environment ID. This webhook does not include `connect.remote_url`. If the executor connects before the connection wait expires, the API clears the requirement and continues the waiting submission without client resubmission. `agent.session.in_progress` confirms execution has started; it is not an early connection signal.

The existing connection wait is up to five minutes. A follow-up input request can remain open during this wait, so configure client and proxy timeouts accordingly. If the wait expires, the submission fails. Initial input supplied during session creation can fail asynchronously and put the session in `failed`. This behavior does not add a durable input queue or guarantee recovery without retries after a process crash or client disconnect.

## Session and turn outcomes

`agent.session.idle` means the session is ready for more input, not that its last turn succeeded. Inspect that turn’s status or observe `session.turn.completed`, `session.turn.failed`, or `session.turn.cancelled` on the session stream. A completed turn can still contain failed tool calls; check tool results and the agent’s final response.

`agent.session.failed` reports a failed session, not every failed turn. Session deletion has no corresponding webhook and does not terminate provider compute.

See [Manage Sandbox Lifecycle](./05-manage-sandbox-lifecycle.md).
