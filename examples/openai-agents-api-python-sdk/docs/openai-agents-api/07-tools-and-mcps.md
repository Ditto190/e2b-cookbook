---
title: "Tools and MCPs"
slug: tools-and-mcps
order: 7
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/tools-and-mcps
---

# Tools and MCPs

Tools let an agent work with your data and services, such as looking up a customer, searching documents, or updating a record. There are two ways to provide those tools:

1.  **[Function tools](#function-tools):** Define operations that your code implements. This is the same function-calling pattern used by the Responses API.
2.  **[MCP tools](#mcp-tools):** Connect an MCP server that exposes its own tools. The Agents API discovers and calls them through the MCP protocol.

You can use both in the same session. Choose function tools to expose existing application logic directly, or MCP tools to use an integration through an MCP server. For MCP, then choose whether the connection runs from the OpenAI service or the session’s sandbox.

## Function tools

Function tools work like [function calling in the Responses API](https://developers.openai.com/api/docs/guides/function-calling). You describe an operation with a name, a description, and a JSON Schema for its arguments. The model decides when to request that operation and supplies the arguments; your code runs the function and returns its result.

For example, you can expose an existing `get_customer(customer_id)` function. The agent supplies the customer ID, your handler calls your customer service, and the agent uses the returned data to continue the task.

If you already have a Responses API function handler, you can reuse its business logic. The session interaction changes:

1.  Add the function definition to `agent.tools`.
2.  When the session requires a function result, read the call from `required_actions`.
3.  Run your function with the supplied arguments.
4.  Submit `session.input.tool_result` with the original `turn_id` and `call_id`. The Agents API continues the pending turn after it receives the required results.

The function implementation stays in your code. A handler can call it from your existing application, a worker, or a sandbox through your provider’s execution API. You do not need to deploy a separate application server. Attaching a session sandbox does not automatically run declared functions there.

### Run a complete function-call example

The example below creates a temporary session, monitors its status, reads a pending `get_customer` call, runs a synthetic lookup, and returns the result using the original `turn_id` and `call_id`. It prints the agent’s saved response, waits for `status: "idle"`, and deletes its session even if the run fails. No sandbox or customer credentials are needed.

Save it as `function_tool.py`, set your existing `OPENAI_API_KEY`, and run `python3 function_tool.py`. It uses Python’s standard library. Set `OPENAI_MODEL` if your account uses a different model name.

**Python: complete call and result loop**

```python
"""Run a temporary Agents API session with a synthetic customer lookup."""

import json
import os
import time
from urllib.request import Request, urlopen

API = "https://api.openai.com/v1"
HEADERS = {
    "Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
    "OpenAI-Beta": "agents=v1",
    "Content-Type": "application/json",
}

def request(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    with urlopen(
        Request(API + path, data=data, headers=HEADERS, method=method), timeout=30
    ) as response:
        raw = response.read()
        return json.loads(raw) if raw else {}

def get_customer(arguments):
    if not isinstance(arguments, dict) or set(arguments) != {"customer_id"}:
        raise ValueError("Expected customer_id only")
    if not isinstance(arguments["customer_id"], str):
        raise ValueError("customer_id must be a string")
    customers = {"123": {"name": "Example Customer", "plan": "pro"}}
    customer = customers.get(arguments["customer_id"])
    return {"found": customer is not None, "customer": customer}

def main():
    session_id = None
    submitted = set()
    deadline = time.monotonic() + 90
    body = {
        "agent": {
            "model": os.environ.get("OPENAI_MODEL", "gpt-5.6"),
            "instructions": "Call get_customer exactly once, then report the customer's name and plan.",
            "tools": [
                {
                    "type": "function",
                    "name": "get_customer",
                    "description": "Look up a customer by ID in the example data.",
                    "parameters": {
                        "type": "object",
                        "properties": {"customer_id": {"type": "string"}},
                        "required": ["customer_id"],
                        "additionalProperties": False,
                    },
                }
            ],
        },
        "environment": {"type": "none"},
        "input": [
            {
                "role": "user",
                "content": [{"type": "input_text", "text": "Look up customer 123."}],
            }
        ],
    }
    try:
        session = request("POST", "/agents/sessions", body)
        session_id = session["id"]
        path = f"/agents/sessions/{session_id}"
        print("Session:", session_id, flush=True)
        last_status = None
        while time.monotonic() < deadline:
            session = request("GET", path)
            status = session["status"]
            if status != last_status:
                print("Status:", status, flush=True)
                last_status = status
            if status == "failed":
                raise RuntimeError("The agent session failed")
            for action in session["required_actions"]:
                if action["type"] != "function_call":
                    continue
                identity = (action["turn_id"], action["call_id"])
                if identity in submitted:
                    continue
                result = {
                    "type": "session.input.tool_result",
                    "turn_id": action["turn_id"],
                    "call_id": action["call_id"],
                }
                try:
                    if action["name"] != "get_customer":
                        raise ValueError("Unknown function")
                    output = get_customer(action["arguments"])
                    result.update(success=True, output=json.dumps(output))
                except ValueError:
                    result.update(
                        success=False, error="Invalid customer lookup request"
                    )
                request("POST", path + "/events", {"events": [result]})
                submitted.add(identity)
                print("Returned result for:", action["call_id"], flush=True)
            if status == "idle":
                items = request("GET", path + "/items?limit=100&order=asc")
                texts = [
                    part["text"]
                    for item in items["data"]
                    if item["type"] == "message" and item.get("role") == "assistant"
                    for part in item.get("content", [])
                    if part["type"] == "output_text"
                ]
                if texts:
                    if not submitted:
                        raise RuntimeError("The agent finished without a function call")
                    print("\n".join(texts))
                    print("Session is idle.")
                    return
            time.sleep(1)
        raise TimeoutError(
            f"The example did not finish within 90 seconds; last status: {last_status}"
        )
    finally:
        if session_id is not None:
            request("DELETE", f"/agents/sessions/{session_id}")
            print("Deleted example session:", session_id, flush=True)

if __name__ == "__main__":
    main()
```

`session.requires_action` means the application must supply a result before the agent can continue. A `function_call` item by itself is not a signal to submit a result: read the session’s `required_actions` and retain the call’s identifiers. A successful result contains string output, such as serialized JSON; a failed result uses `success: false` and a safe error message.

For live progress, you can also watch server-sent events while your handler processes the durable pending actions:

```bash
curl -N "https://api.openai.com/v1/agents/sessions/$SESSION_ID/events" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

Use the ID returned when creating your session. The stream includes output deltas and lifecycle events such as `session.requires_action`, `session.turn.completed`, and `session.idle`. Reading events does not execute functions or return their results for you.

If your connection drops, retrieve `GET /v1/agents/sessions/{session_id}` to find outstanding actions, and list `GET /v1/agents/sessions/{session_id}/items` for saved output. The live event stream is not a replay log. For side-effecting functions, record completion by call ID before retrying work whose outcome is uncertain.

See [Function Tools](./08-function-call-tools.md) for the declaration, SDK examples, and result payloads.

## MCP tools

An MCP server publishes a catalog of tools, including their names, descriptions, and argument schemas, and handles their execution. Configure the server once and let the agent use the tools it exposes. The managed MCP client handles discovery, sends calls to the server, and returns the results to the agent; your application does not need a function-call handler for each MCP tool.

For example, connect a documentation MCP server to give the agent its search tools, or build an MCP server around an internal service. Configure the connection, authentication, and tool selection; the server owns the tool implementations.

Remote MCPs and executor MCPs are two ways to connect to an MCP server. They use the same tool protocol; the difference is where the MCP connection runs and which network it can reach.

### Choose an MCP connection

Configure the transport and connection origin according to where the server is reachable.

| Setup | Transport | Where the server must be reachable | Connection origin |
| --- | --- | --- | --- |
| Remote MCP | `http` | From the OpenAI service | `service` (the default) |
| Executor MCP over HTTP | `http` | From the session’s sandbox | `environment` |
| Executor MCP over stdio | `stdio` | A process installed in the session’s sandbox | Always the session environment; omit this field |

For HTTP, omitting `connection_origin` has exactly the same behavior as setting it to `"service"`. The field selects where the connection originates; it is not an authentication setting.

For a private endpoint, use `connection_origin: "environment"` with a connected sandbox that can reach it, such as a self-hosted sandbox in your network. This is distinct from a standalone MCP tunnel; this guide does not provide an Agent API tunnel configuration.

### Remote MCPs

Remote MCPs work with or without a session sandbox. Add the server to `agent.tools`; no plugin is required. For example, the OpenAI documentation MCP needs no credential or vault:

```json
{
  "type": "mcp",
  "server_label": "openai_docs",
  "transport": {
    "type": "http",
    "server_url": "https://developers.openai.com/mcp"
  },
  "connection_origin": "service",
  "required": true
}
```

Set `required: true` when the turn should fail if the server cannot initialize. Otherwise, MCP initialization is optional by default.

#### Choose authentication

A customer-created vault is optional. Choose the credential path that matches the server and its connection origin:

| Need | Configuration | Credential boundary |
| --- | --- | --- |
| No authentication | Omit authentication fields and `vault_ids`. | No credential is needed. |
| Session-specific HTTP authentication | Supply `transport.authorization` or `transport.headers` when creating the session. | Values are accepted in the request and omitted from the returned session resource; you do not need to create a vault. |
| Reusable service-origin HTTP authentication | Store a credential in a vault and attach it through `vault_ids`. Select `credential_id`, or let a unique server-URL match select it. | Vault authentication applies to service-origin HTTP MCPs. |
| Stdio credentials already in the sandbox | List their names in `transport.env_vars`. | The MCP process inherits values from the sandbox. Agent-executed code may also be able to read those values. |

Do not combine inline Authorization with a matching vault authorization. Non-Authorization headers can accompany vault authentication. Environment-origin HTTP does not use an attached MCP vault credential; use session-level HTTP authentication or a trusted proxy on your network. Keep raw credentials out of reusable agent definitions, plugin archives, and logs.

Follow [Remote MCPs](./09-mcp.md) for complete inline-auth and vault examples, including the MCP declaration and `vault_ids` attachment.

### Executor MCPs

Executor MCPs require an `openai_hosted` or `self_hosted` environment. They cannot be used with `environment.type: "none"`. A self-hosted sandbox must be connected before the agent can use its MCPs.

Use **stdio** to start a server inside the sandbox. `transport.command` and an absolute `transport.cwd` are required; `transport.args` is optional. `env_vars` lists variable names already available in the sandbox, not secret values. Install the executable and its dependencies before starting the agent.

Use **HTTP** when the server is already running at an address reachable from the sandbox. Include both the origin and the environment in the session request:

```json
{
  "agent": {
    "model": "gpt-5.6",
    "tools": [
      {
        "type": "mcp",
        "server_label": "customer_lookup",
        "transport": {
          "type": "http",
          "server_url": "http://127.0.0.1:8765/mcp"
        },
        "connection_origin": "environment",
        "required": true
      }
    ]
  },
  "environment": {
    "type": "self_hosted",
    "workspace_directory": "/workspace"
  }
}
```

Here, `127.0.0.1` refers to the sandbox. Start the example server there, connect the sandbox, and send input requesting customer `123`. See [Executor MCPs](./10-executor-mcps.md) for a small lookup server, both transport configurations, and troubleshooting steps.

#### Configure MCP servers together

**Reusable MCP configuration** lets you define several MCP servers in one file and package the setup with your sandbox. A plugin manifest points to `.mcp.json`; `environment.capability_directories` selects the plugin root.

The plugin file uses `mcpServers`, `url`, and process configuration fields. It is not a verbatim `agent.tools` request, and its MCP connections belong to the selected sandbox rather than defaulting to the OpenAI service. It configures the servers; their implementations, dependencies, network access, and credentials must still be available.

See [Configure MCP servers together](./10-executor-mcps.md#configure-mcp-servers-together) for a two-server file and sandbox setup. Reuse the files in self-hosted sandbox images, or include a plugin archive in an OpenAI-hosted environment template. Do not depend on plugin file edits reloading tools in an existing session.
