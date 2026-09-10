---
title: "Function Tools"
slug: function-call-tools
order: 8
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/function-call-tools
---

# Function Tools

Function tools use the same function-calling pattern as the [Responses API](https://developers.openai.com/api/docs/guides/function-calling): describe a function and its arguments, receive a structured call, execute your code, and return the result. Use them to expose operations such as looking up a customer, querying a database, or updating a record.

The model chooses when to request a function. Your code supplies the implementation, and the Agents API manages the session and continues the turn when the required results arrive.

## Coming from the Responses API

You can reuse your function’s business logic. Adapt the code that receives calls and submits results to the Agents API session flow:

| Step | Responses API | Agents API |
| --- | --- | --- |
| Define the function | Add a `type: "function"` definition to `tools`. | Add the definition to `agent.tools`. Both use `name`, `description`, and JSON Schema `parameters`. |
| Receive a call | Read a `function_call` output item. | Handle `session.requires_action` or retrieve the session, then read its `required_actions` for pending function calls. |
| Return a result | Send `function_call_output` with the `call_id` in a follow-up response request. | Send `session.input.tool_result` to the session events endpoint with `turn_id`, `call_id`, `success`, and `output` or `error`. |
| Continue the task | Your application makes the next response request with the tool results. | The service continues the pending session turn after it receives the required results. |

Use the function fields documented below when adapting a declaration. Responses API options such as `strict` are not fields on an Agents API function definition.

Your handler can run in your existing application, a worker, or a sandbox you can execute code in. No separate application server is required. Attaching a session sandbox does not automatically dispatch functions there.

For a runnable example that creates a session, handles a real function call, waits for completion, and cleans up, see [Run a complete function-call example](./07-tools-and-mcps.md#run-a-complete-function-call-example). To use tools already exposed by an MCP server, see [MCP tools](./07-tools-and-mcps.md#mcp-tools).

## Define the function tool

To make a function available to the agent, describe what it does and the arguments it expects in the agent config.

**cURL**

```bash
curl -sS -N https://api.openai.com/v1/agents/sessions \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": {
      "model": "gpt-5.6",
      "tools": [
        {
          "type": "function",
          "name": "get_temperature",
          "description": "Get the current temperature for a city.",
          "parameters": {
            "type": "object",
            "properties": {
              "city": {
                "type": "string",
                "description": "The city to get the temperature for."
              }
            },
            "required": ["city"],
            "additionalProperties": false
          }
        }
      ]
    },
    "environment": { "type": "none" },
    "input": [
      {
        "role": "user",
        "content": [
          { "type": "input_text", "text": "What is the temperature in San Francisco?" }
        ]
      }
    ],
    "stream": true
  }'
```

**SDK**

**Python**

```python
import asyncio

get_temperature_tool = {
    "type": "function",
    "name": "get_temperature",
    "description": "Get the current temperature for a city.",
    "parameters": {
        "type": "object",
        "properties": {
            "city": {
                "type": "string",
                "description": "The city to get the temperature for.",
            }
        },
        "required": ["city"],
        "additionalProperties": False,
    },
}

async with asyncio.timeout(60):
    async for event in client.sessions.create_stream(
        agent={"model": "gpt-5.6", "tools": [get_temperature_tool]},
        environment={"type": "none"},
        input="What is the temperature in San Francisco?",
    ):
        if event.type == "session.requires_action":
            session = await client.sessions.retrieve(event.session.id)
            for action in session.info.required_actions:
                if action.type != "function_call":
                    continue
                await session.tool_result(
                    turn_id=action.turn_id,
                    call_id=action.call_id,
                    success=True,
                    output={"city": "San Francisco", "temperature_f": 72},
                )
        elif event.type == "session.turn.failed":
            message = (
                event.error.message
                if event.error is not None
                else "The agent turn failed."
            )
            raise RuntimeError(message)
        elif event.type == "session.turn.cancelled":
            raise RuntimeError("The agent turn was cancelled.")
        elif event.type == "session.failed":
            raise RuntimeError(event.error or "The agent session failed.")
        elif event.output_text_delta is not None:
            print(event.output_text_delta, end="", flush=True)
        elif event.type == "session.idle":
            break
```

**TypeScript**

```typescript
const getTemperatureTool = {
  type: "function",
  name: "get_temperature",
  description: "Get the current temperature for a city.",
  parameters: {
    type: "object",
    properties: {
      city: {
        type: "string",
        description: "The city to get the temperature for.",
      },
    },
    required: ["city"],
    additionalProperties: false,
  },
} as const;
```

## Receive the function call

When the agent decides to call the function, the harness sends an item event like this:

```json
{
  "type": "session.turn.item.added",
  "item": {
    "type": "function_call",
    "id": "fc_123",
    "turn_id": "turn_123",
    "call_id": "call_123",
    "name": "get_temperature",
    "arguments": { "city": "San Francisco" },
    "status": "in_progress"
  }
}
```

The item event alone does not mean the service is ready to accept a result. Create a conversation-only streaming session with its required initial input. Wait for `session.requires_action`, submit each pending result on the same session, and keep the original stream open until resumed output and completion arrive:

```typescript
const events = await client.beta.agents.sessions.create(
  {
    agent: {
      model: "gpt-5.6",
      tools: [
        {
          type: "function",
          name: "get_temperature",
          description: "Get the current temperature for a city.",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
            additionalProperties: false,
          },
        },
      ],
    },
    environment: { type: "none" },
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "What is the temperature in San Francisco?",
          },
        ],
      },
    ],
    stream: true,
  },
  { signal: AbortSignal.timeout(60_000) }
);

let submittedToolResult = false;

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

    if (event.type === "session.requires_action") {
      for (const action of event.session.required_actions) {
        if (action.type !== "function_call") continue;

        await client.beta.agents.sessions.events.create(event.session.id, {
          events: [
            {
              type: "session.input.tool_result",
              turn_id: action.turn_id,
              call_id: action.call_id,
              success: true,
              output: JSON.stringify({
                city: "San Francisco",
                temperature_f: 72,
              }),
            },
          ],
        });
        submittedToolResult = true;
      }
      continue;
    }

    if (event.type === "session.turn.output_text.delta") {
      process.stdout.write(event.delta);
    }

    if (event.type === "session.idle") {
      if (!submittedToolResult) {
        throw new Error("The agent finished without requesting a function.");
      }
      break;
    }
  }
} finally {
  events.controller.abort();
}
```

## Return the result

Return the result using the `turn_id` and `call_id` from the pending action. Function output must be a string or a supported content array. Serialize JSON objects before sending them directly to the API.

**cURL**

```bash
curl -sS \
  -X POST "https://api.openai.com/v1/agents/sessions/$SESSION_ID/events" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "type": "session.input.tool_result",
        "turn_id": "turn_123",
        "call_id": "call_123",
        "success": true,
        "output": "{\"city\":\"San Francisco\",\"temperature_f\":72}"
      }
    ]
  }'
```

**SDK**

**Python**

```python
await session.tool_result(
    turn_id="turn_123",
    call_id="call_123",
    success=True,
    output={
        "city": "San Francisco",
        "temperature_f": 72,
    },
)
```

**TypeScript**

```typescript
await client.beta.agents.sessions.events.create(session.id, {
  events: [
    {
      type: "session.input.tool_result",
      turn_id: "turn_123",
      call_id: "call_123",
      success: true,
      output: JSON.stringify({
        city: "San Francisco",
        temperature_f: 72,
      }),
    },
  ],
});
```

If it failed, set `success` to `false` and return an error instead.

If the connection drops, retrieve the session to check pending function calls, and list its items to recover output. If you already ran a function, retry submitting its saved result using the same `turn_id` and `call_id`, rather than executing it again.

**cURL**

```bash
curl -sS \
  -X POST "https://api.openai.com/v1/agents/sessions/$SESSION_ID/events" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "type": "session.input.tool_result",
        "turn_id": "turn_123",
        "call_id": "call_123",
        "success": false,
        "error": "Unable to fetch the current temperature."
      }
    ]
  }'
```

**SDK**



**Python**

```python
await session.tool_result(
    turn_id="turn_123",
    call_id="call_123",
    success=False,
    error="Unable to fetch the current temperature.",
)
```

**TypeScript**

```typescript
await client.beta.agents.sessions.events.create(sessionId, {
  events: [
    {
      type: "session.input.tool_result",
      turn_id: "turn_123",
      call_id: "call_123",
      success: false,
      error: "Unable to fetch the current temperature.",
    },
  ],
});
```

## Load functions only when needed

Set `defer_loading: true` on a function and include a `tool_search` tool when an agent should discover the function only if its task requires it:

**SDK**



**Python**

```python
session = await client.sessions.create(
    agent={
        "model": "gpt-5.6",
        "tools": [
            {"type": "tool_search"},
            {
                "type": "function",
                "name": "lookup_account",
                "description": "Find an account by its account number.",
                "parameters": {
                    "type": "object",
                    "properties": {"account_id": {"type": "string"}},
                    "required": ["account_id"],
                    "additionalProperties": False,
                },
                "defer_loading": True,
            },
        ],
    },
    environment={"type": "none"},
    input="Look up account 42.",
)
```

**TypeScript**

```typescript
const session = await client.beta.agents.sessions.create({
  agent: {
    model: "gpt-5.6",
    tools: [
      { type: "tool_search" },
      {
        type: "function",
        name: "lookup_account",
        description: "Find an account by its account number.",
        parameters: {
          type: "object",
          properties: { account_id: { type: "string" } },
          required: ["account_id"],
          additionalProperties: false,
        },
        defer_loading: true,
      },
    ],
  },
  environment: { type: "none" },
  input: [
    {
      role: "user",
      content: [{ type: "input_text", text: "Look up account 42." }],
    },
  ],
});
```
