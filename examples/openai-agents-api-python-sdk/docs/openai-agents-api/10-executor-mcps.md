---
title: "Executor MCPs"
slug: executor-mcps
order: 10
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/executor-mcps
---

# Executor MCPs

Executor MCPs use the same tool protocol as [remote MCPs](./09-mcp.md), with the connection running from the session’s sandbox. The MCP server exposes and executes its tools, while the managed MCP client handles discovery, calls, and results. You do not need an application-side function-call handler for these tools.

Use executor MCPs for private databases, internal search, browser tools, or software installed in your environment. The server can run inside the sandbox or at an address reachable from its network.

They require an `openai_hosted` or `self_hosted` session environment. Neither stdio nor environment-origin HTTP works with `environment.type: "none"`.

## Choose where the server runs

| Setup | Configuration | Prerequisites |
| --- | --- | --- |
| Start a process in the sandbox | `transport.type: "stdio"`; omit `connection_origin`. | An installed executable and an absolute working directory. |
| Connect to an HTTP server | `transport.type: "http"` and `connection_origin: "environment"`. | A running server at an address reachable from the connected sandbox. |

The following example uses synthetic customer data. It needs no database, Kubernetes cluster, or credentials.

## Prepare a small lookup server

Inside your sandbox, install the pinned MCP SDK into a virtual environment:

```bash
python3 -m venv /workspace/mcp-demo
/workspace/mcp-demo/bin/python -m pip install 'mcp==1.26.0'
```

Save this server as `/workspace/lookup_mcp.py`:

```python
"""Synthetic MCP server; requires mcp==1.26.0 in the sandbox."""

import os
import sys
from pathlib import Path

from mcp.server.fastmcp import FastMCP

server = FastMCP("customer-lookup", host="127.0.0.1", port=8765, stateless_http=True)

@server.tool()
def get_customer(customer_id: str) -> dict:
    """Look up a customer in the example data and report the execution context."""
    customers = {"123": {"name": "Example Customer", "plan": "pro"}}
    return {
        "customer": customers.get(customer_id),
        "working_directory": str(Path.cwd()),
        "demo_label": os.environ.get("MCP_DEMO_LABEL", "not set"),
    }

if __name__ == "__main__":
    transport = sys.argv[1] if len(sys.argv) > 1 else "stdio"
    server.run(transport=transport)
```

The result reports the sandbox working directory and a synthetic `MCP_DEMO_LABEL` environment variable. Use that label to verify your setup; do not put a secret in it.

### Run the server over stdio

Set `MCP_DEMO_LABEL=customer-demo` in the environment that launches your sandbox executor. Then create a session with:

```json
{
  "agent": {
    "model": "gpt-5.6",
    "tools": [
      {
        "type": "mcp",
        "server_label": "customer_lookup",
        "transport": {
          "type": "stdio",
          "command": "/workspace/mcp-demo/bin/python",
          "args": ["/workspace/lookup_mcp.py"],
          "cwd": "/workspace",
          "env_vars": ["MCP_DEMO_LABEL"]
        },
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

Connect the sandbox using the returned environment ID, as described in [Self-hosted Sandboxes](./04-connect-to-a-sandbox.md). Send a user message asking the agent to call `get_customer` for customer `123` and report the returned working directory and demo label. The expected data includes `Example Customer`, `/workspace`, and `customer-demo`.

The executor starts the process for you. `command` and `cwd` are required; `args` is optional. `env_vars` names variables to inherit from the sandbox. Self-hosted sessions do not accept inline stdio credential values in `transport.env`.

For OpenAI-hosted stdio MCPs, networking must be omitted or explicitly `enabled`. The current preview does not support stdio with a `disabled` or `restricted` hosted network policy.

### Connect over HTTP

To use the same server over HTTP, start it **inside the sandbox** and keep it running:

```bash
cd /workspace
MCP_DEMO_LABEL=customer-demo \
  /workspace/mcp-demo/bin/python /workspace/lookup_mcp.py streamable-http
```

Replace the MCP entry in the session creation request with:

```json
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
```

Keep the `self_hosted` environment configuration and attach its executor. Here, `127.0.0.1` is the sandbox’s loopback address. For an existing service in your network, use the address the sandbox can reach instead.

Omitting `connection_origin` defaults to `service`, which makes the HTTP connection from OpenAI’s service. It does not reach the sandbox’s loopback address or a service reachable only from your private network.

## Configure authentication

For stdio, provision credential values through your sandbox provider and pass only their environment-variable names in `env_vars`. These values may be readable by agent-executed code in the sandbox.

For environment-origin HTTP, pass session-specific authorization or request headers:

```json
{
  "type": "mcp",
  "server_label": "internal_search",
  "transport": {
    "type": "http",
    "server_url": "https://mcp.internal.example.com/search",
    "authorization": "Bearer YOUR_MCP_ACCESS_TOKEN",
    "headers": { "X-Tenant-ID": "tenant_123" }
  },
  "connection_origin": "environment",
  "required": true
}
```

Authorization and header values are omitted from returned session resources. A matching attached MCP vault credential and `credential_id` are only supported for service-origin HTTP, not this environment-origin path.

If credentials must remain inaccessible to agent-generated code, use a trusted proxy or MCP server that obtains and injects them outside the sandbox. Ordinary environment-variable injection does not provide that isolation. Bind credentials to an authorized destination in trusted configuration, not in model-supplied tool arguments.

## Configure MCP servers together

Package multiple server definitions in a plugin when you want to reuse the setup across sessions. For example, combine the lookup server with OpenAI’s documentation MCP:

```text
/workspace/plugins/customer-tools/
├── .codex-plugin/plugin.json
├── .mcp.json
└── server/lookup_mcp.py
```

Copy the lookup script above into `server/lookup_mcp.py`. Keep its pinned Python environment installed at `/workspace/mcp-demo`.

The plugin manifest is:

```json
{
  "name": "customer-tools",
  "version": "1.0.0",
  "description": "Customer lookup and OpenAI documentation tools.",
  "mcpServers": "./.mcp.json"
}
```

The `.mcp.json` file defines both servers:

```json
{
  "mcpServers": {
    "customer_lookup": {
      "command": "/workspace/mcp-demo/bin/python",
      "args": ["server/lookup_mcp.py"],
      "cwd": ".",
      "env_vars": ["MCP_DEMO_LABEL"]
    },
    "openai_docs": {
      "type": "http",
      "url": "https://developers.openai.com/mcp"
    }
  }
}
```

The plugin schema differs from `agent.tools`: HTTP uses `url`, and a relative stdio `cwd` resolves inside the plugin root. Plugin MCP connections use the selected sandbox, so the sandbox must also be able to reach the documentation endpoint. Do not copy the plugin JSON directly into `agent.tools`.

Select the plugin root when creating the session, then attach the executor:

```json
{
  "agent": { "model": "gpt-5.6" },
  "environment": {
    "type": "self_hosted",
    "workspace_directory": "/workspace",
    "capability_directories": ["/workspace/plugins/customer-tools"]
  }
}
```

Ask the agent to use the customer lookup and search the OpenAI documentation. The plugin provides configuration, not the server software or credentials: install dependencies and supply access separately. Remote-executor plugin HTTP configurations do not support `env_http_headers`; use a supported transport credential path or a trusted proxy instead. Never distribute real tokens in `.mcp.json`.

Self-hosted applications can reuse these files in their sandbox image or startup process. OpenAI-hosted environments can install plugin archives through `environment.plugins` and inherit them from hosted environment templates. These are creation-time setups; do not depend on editing `.mcp.json` to reload tools in an existing session. See [Plugins](./14-plugins.md) for the package structure.

## Diagnose startup failures

Use `required: true` when a missing server should fail the turn, then inspect `session.turn.failed` and the sandbox’s MCP process logs.

- **Missing executable or dependency:** verify `command` exists inside the sandbox and can import the pinned MCP SDK.
- **Invalid working directory:** use an existing absolute `cwd` for inline API configuration. A plugin can resolve `cwd` relative to its own root.
- **HTTP connection failure:** check the server is running, its address is reachable from the sandbox, and `connection_origin` is `environment`.
- **Missing demo label or credentials:** configure values where the executor starts and include the intended names in `env_vars` for stdio.
- **No session environment:** choose `self_hosted` or `openai_hosted`; executor MCPs are rejected with `none`.

Do not print credential values in logs. For a server that the agent must use, a normal model answer without an MCP result is not enough to verify the connection.
