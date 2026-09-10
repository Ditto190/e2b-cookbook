---
title: "Manage Sandbox Lifecycle"
slug: manage-sandbox-lifecycle
order: 5
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/manage-sandbox-lifecycle
---

# Manage Sandbox Lifecycle

An agent session can outlive its sandbox. Choose how to start compute, keep it available between turns, reconnect it, and clean it up.

This guide covers `self_hosted` environments. For executor installation, networking, and authentication, see [Self-hosted Sandboxes](./04-connect-to-a-sandbox.md).

## How it works

OpenAI runs the agent and maintains session state. Your sandbox runs commands and works with files; a `codex exec-server` process inside it connects outbound to OpenAI.

| Mode | Who provisions the sandbox? |
| --- | --- |
| **Webhook-managed** | A handler deployed in your sandbox provider account reacts to OpenAI events. Your application submits work through the Agents API. |
| **Application-managed** | Your application calls the provider SDK to start, connect, and stop the sandbox. |

Both modes use the same self-hosted connection protocol; each session has its own environment ID. Choose one provisioning controller per session. For webhook-managed setups, use one provider per project unless your handlers implement explicit routing.

## Lifecycle behavior

- **Initial connection:** start a sandbox after session creation, or wait for an `environment_connection` required action. Input cannot start a turn until the executor connects.
- **Follow-up input:** reuse a connected executor. If it is offline, the API requests an environment connection before waiting; a webhook handler or your application must reconnect it.
- **Idle:** keep the sandbox running, or use a grace period after a turn ends. Cancel pending shutdown as soon as a connection is requested or execution starts, and recheck state before stopping.
- **Cleanup:** stop accepting new input, delete the session, and terminate provider compute separately. Deleting a session does not stop its sandbox or emit a deletion webhook.

The same lifecycle is visible through the session stream and project webhooks:

| What happened | Session stream | Webhook |
| --- | --- | --- |
| A session was created | `session.created` | `agent.session.created` |
| A new turn was created | `session.turn.created` | N/A |
| An action is required | `session.requires_action` | `agent.session.action_required` |
| The agent started working | `session.in_progress` | `agent.session.in_progress` |
| The session is idle | `session.idle` | `agent.session.idle` |
| The session failed | `session.failed` | `agent.session.failed` |

For wakeup, handle only required actions of type `environment_connection`; `function_call` needs a function result instead. `session.turn.created` and `agent.session.in_progress` arrive too late to wake an offline executor.

Idle is not a turn-success or safe-shutdown signal. In particular, `session.idle` can fire when a connection requirement clears, before waiting input starts its turn. If your controller cannot coordinate shutdown with incoming work, keep the sandbox running between turns.

## Set up webhook-managed sandboxes

Deploy a reference handler in your sandbox provider account. Your application creates sessions and sends input through the Agents API; the handler provisions and connects the sandbox.

![A developer application sends input to OpenAI and receives an SSE stream; session webhooks provision a provider sandbox whose executor connects outbound to OpenAI.](https://preview-docs-git-agents-alpha-openai.vercel.app/images/agents-api/webhook-managed-sandboxes.png)

### Choose a provider

Choose a handler from the [webhook-managed sandbox examples](https://github.com/OpenAI-Early-Access/agents-api-python-preview/tree/main/examples/self_hosted_sandbox/webhook_managed/), which include deployment and cleanup instructions.

### Deploy and connect a handler

1.  **Choose an agent.** Use an existing agent, or create one using the [example setup instructions](https://github.com/OpenAI-Early-Access/agents-api-python-preview/tree/main/examples/self_hosted_sandbox/webhook_managed#set-up-once). Set `OPENAI_AGENT_ID` to its ID. The example handler manages only sessions for this agent.
2.  **Configure credentials.** Store a restricted executor key and the controller’s session-read credential in your provider’s secrets manager, as described in the provider example. See [executor authentication](./04-connect-to-a-sandbox.md#authentication).
3.  **Deploy the handler** using the provider example and copy its public HTTPS URL.
4.  **Register the endpoint** in [Project settings → Webhooks](https://platform.openai.com/settings/project/webhooks). Enable `agent.session.action_required` and `agent.session.failed`. Store the generated signing secret with the handler and redeploy before creating sessions.

The supplied handlers use connection requests to start compute. To start it eagerly on `agent.session.created` or stop it on idle, add that behavior to your handler before subscribing to those events.

On a connection request, retrieve the current session, confirm it is self-hosted and still needs a connection, and start or reconnect its executor using the environment ID in `required_actions`. Persist the session-to-sandbox mapping and make provisioning idempotent so retries cannot create duplicate sandboxes. Ignore deleted sessions and actions that have already resolved.

### Handle lifecycle webhooks

Verify the signature, then queue connection requests and session failures. Return a successful HTTP response only after queuing succeeds. In this pseudocode, `enqueue_session` represents your provider’s work queue:

```python
async def handle_verified_event(event):
    if event["type"] == "agent.session.action_required":
        if event["data"]["required_action"]["type"] == "environment_connection":
            await enqueue_session(event["data"]["id"])
    elif event["type"] == "agent.session.failed":
        await enqueue_session(event["data"]["id"])
```

The worker retrieves the session and checks its current state. It starts or reconnects a sandbox only while an `environment_connection` action is present, or releases the sandbox if the session is still failed. Other required actions, such as `function_call`, belong to your application’s tool handler.

### Run a session

After the handler is deployed and subscribed, set your application’s `OPENAI_API_KEY` and the same `OPENAI_AGENT_ID` configured in the handler. Run this example with the Python SDK installed. The workspace must match the handler’s sandbox configuration.

```python
import asyncio
import os

from agent_api_sdk import AgentAPISDK

async def main():
    async with AgentAPISDK(timeout=600) as client:
        session = await client.sessions.create(
            agent_id=os.environ["OPENAI_AGENT_ID"],
            environment={"type": "self_hosted", "workspace_directory": "/workspace"},
        )
        print(f"Session: {session.id}")
        completed = False
        async for event in session.stream(
            input="Run a shell command to write hello to /workspace/hello.txt, then read it."
        ):
            if event.type in {
                "session.turn.failed", "session.turn.cancelled", "session.failed"
            }:
                raise RuntimeError(f"Agent failed: {event.type}")
            if event.output_text_delta is not None:
                print(event.output_text_delta, end="", flush=True)
            if event.type == "session.turn.completed":
                completed = True
        if not completed:
            raise RuntimeError("Stream ended without a completed turn")

asyncio.run(main())
```

Input triggers wakeup when the executor is offline; the original submission continues if it connects within the deadline.

The example retains the session for follow-up. Retrieve it with `await client.sessions.retrieve(session_id)` in a new client context, then call `session.stream(input=...)` again. To verify wakeup, stop the sandbox after a completed turn and send another message. Confirm a connection-required webhook, a connected executor, the expected shell output, and a completed turn. Use the provider example’s cleanup steps to remove both the session and sandbox when finished.

## Manage sandboxes from your application

In this mode, your application owns sandbox provisioning.

![The developer application calls the provider SDK to start, reconnect, and stop a sandbox. OpenAI streams session events to the application over SSE, while the sandbox executor connects outbound to OpenAI.](https://preview-docs-git-agents-alpha-openai.vercel.app/images/agents-api/application-managed-sandboxes.png)

See [Sandbox providers](./24-sandbox-providers.md) for application-managed guides and examples.

## Timeouts and recovery

- **Connection deadline:** the API waits up to five minutes. Allow enough time in client and proxy timeouts. If the wait expires, the submission fails; initial input supplied during session creation can fail asynchronously and put the session in `failed`.
- **Retries:** pending input is not crash-durable. Check the request or session outcome before retrying, and do not resubmit while the original request is still waiting. A late connection does not replay timed-out input.
- **Persistence and cleanup:** reconnecting to the same environment ID does not restore files in a replacement sandbox. Configure provider storage or snapshots, and coordinate teardown with in-flight provisioning to avoid orphaned compute.

### Handle sandbox disconnects

Use `session.environment.connected` to observe a connection and `session.environment.disconnected` to observe a reported disconnect. Connection setup can also emit `session.environment.pending` or `session.environment.failed`. These events report state; they do not request compute. Use the `environment_connection` required action to trigger provisioning, and monitor provider health separately.

A mid-turn disconnect can fail a tool while the turn still completes. Check tool results and the agent’s final response, not only turn or session failure events. The disconnect does not automatically trigger the input-time wakeup webhook or restore a killed command; later input can request reconnection.

See [Webhooks](./20-webhooks.md) for payloads, signature verification, and delivery handling, and [Events and Items](./18-session-events-and-items.md) for the session stream.
