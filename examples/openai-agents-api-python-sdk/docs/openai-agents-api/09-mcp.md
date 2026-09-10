---
title: "Remote MCPs"
slug: mcp
order: 9
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/mcp
---

# Remote MCPs

Remote MCPs connect an agent to tools exposed by an MCP server. The server advertises each tool’s name, description, and argument schema, and runs its implementation. The Agents API discovers the available tools, invokes them through MCP, and supplies their results to the agent.

You configure the server connection and authentication; you do not need to receive each call and submit its result as you do with [function tools](./08-function-call-tools.md).

For a remote MCP, the OpenAI service makes the connection. The MCP endpoint must be reachable from that service. [Executor MCPs](./10-executor-mcps.md) use the same MCP protocol but connect from the session’s sandbox, for servers installed there or reachable on its network.

MCP servers that allow anonymous access can be used directly.

For an MCP server that requires authentication, pass session-specific HTTP credentials or attach a vault to manage credentials separately from sessions. For the vault option:

1.  Add the MCP server to the agent configuration.
2.  Create a vault and add a credential for the server’s URL.
3.  Attach the vault to the session using `vault_ids`.

![A hosted agent connects to a hosted remote MCP server over HTTPS using a vault credential.](https://preview-docs-git-agents-alpha-openai.vercel.app/images/agents-api/remote-mcps-1.webp)

## Configure the remote MCP server

```python
{
    "type": "mcp",
    "server_label": "github",
    "transport": {
        "type": "http",
        "server_url": "https://api.githubcopilot.com/mcp/x/issues/readonly",
    },
    "allowed_tools": ["search_issues", "issue_read"],
    "required": True,
    "connection_origin": "service",
}
```

### Remote MCP configuration reference

| Field | Options | Description |
| --- | --- | --- |
| `server_label` | Any string | Identifies the MCP server. |
| `transport.type` | `"http"` | Connects to the hosted MCP endpoint. |
| `transport.server_url` | HTTP or HTTPS URL | Specifies the MCP endpoint. The Agents API associates vault credentials with this URL. |
| `allowed_tools` | Array of tool names | Limits which tools the agent can discover and call. |
| `required` | `true` or `false` | Fails the turn if this required server cannot initialize. Defaults to `false`. |
| `connection_origin` | `"service"` or omitted | Connects from the hosted Agents API service. When omitted, the connection origin defaults to service. |

## Authenticate without creating a vault

For session-specific HTTP authentication, include `transport.authorization` or `transport.headers` in the session’s MCP declaration:

```json
{
  "agent": {
    "model": "gpt-5.6",
    "tools": [
      {
        "type": "mcp",
        "server_label": "internal_api",
        "transport": {
          "type": "http",
          "server_url": "https://mcp.example.com/mcp",
          "authorization": "Bearer YOUR_MCP_ACCESS_TOKEN",
          "headers": { "X-Tenant-ID": "tenant_123" }
        },
        "connection_origin": "service",
        "required": true
      }
    ]
  },
  "environment": { "type": "none" },
  "input": [
    {
      "role": "user",
      "content": [{ "type": "input_text", "text": "Look up my account." }]
    }
  ]
}
```

Replace the example URL and credential with a server your service-origin connection can reach. The Agents API encrypts these credentials for the session and omits them from the returned session resource. Keep secret values out of reusable agent definitions.

Use the [vault flow](#create-a-vault) to manage service-origin HTTP credentials separately from sessions. Vault credentials are scoped to an MCP server URL, can be reused across sessions, and have separate APIs for rotation and archiving. See [Vaults](./23-vaults.md) for credential management.

Choose one source for the `Authorization` header: inline configuration or a matching vault credential. Other headers can accompany vault authentication. If several attached credentials match the server URL, select one with the MCP tool’s `credential_id`.

## Create a vault

A vault is a project-scoped collection of credentials.

**cURL**

```bash
VAULT_ID=$(
  curl -sS https://api.openai.com/v1/vaults \
    -H "OpenAI-Beta: agents=v1" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"display_name":"GitHub for user_123"}' | jq -r '.id'
)
```

**SDK**



**Python**

```python
vault = await client.vaults.create(
    display_name="GitHub credentials",
    metadata={"external_user_id": "user_123"},
)
```

**TypeScript**

```typescript
const vault = await client.beta.agents.vaults.create({
  display_name: "GitHub credentials",
  metadata: { external_user_id: "user_123" },
});
```

More info here: [Vaults](./23-vaults.md)

## Add the MCP credential

Add credential to the vault and bind that to the MCP server’s URL:

**cURL**

```bash
MCP_URL=https://api.githubcopilot.com/mcp/x/issues/readonly

curl -sS "https://api.openai.com/v1/vaults/$VAULT_ID/credentials" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg url "$MCP_URL" \
    --arg token "$GITHUB_TOKEN" \
    '{
      display_name: "GitHub access token",
      auth: {
        type: "static_bearer",
        mcp_server_url: $url,
        token: $token
      },
      source: {type: "openai_managed"}
    }')"
```

**SDK**



**Python**

```python
credential = await client.vaults.credentials.create(
    vault.id,
    display_name="GitHub access token",
    auth={
        "type": "static_bearer",
        "mcp_server_url": os.environ["GITHUB_MCP_URL"],
        "token": os.environ["GITHUB_TOKEN"],
    },
)
```

**TypeScript**

```typescript
const credential = await client.beta.agents.vaults.credentials.create(
  vault.id,
  {
    display_name: "GitHub access token",
    auth: {
      type: "static_bearer",
      mcp_server_url: process.env.GITHUB_MCP_URL!,
      token: process.env.GITHUB_TOKEN!,
    },
    source: { type: "openai_managed" },
  }
);
```

`static_bearer` tells the Agents API to authenticate matching MCP requests with `Authorization: Bearer <token>`. The `mcp_server_url` binds the credential to that server. For an existing OAuth grant, use an `mcp_oauth` vault credential instead; the Agents API can refresh it when you provide refresh configuration. See [Vaults](./23-vaults.md).

## Attach the vault to a session

Pass the vault ID in `vault_ids` when creating the session. The Agents API looks inside the attached vault for a credential matching the MCP server URL.

**cURL**

```bash
curl -sS https://api.openai.com/v1/agents/sessions \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg url "$MCP_URL" \
    --arg vault_id "$VAULT_ID" \
    '{
      agent: {
        model: "gpt-5.6",
        tools: [{
          type: "mcp",
          server_label: "github",
          transport: {type: "http", server_url: $url},
          allowed_tools: ["search_issues", "issue_read"],
          required: true,
          connection_origin: "service"
        }]
      },
      environment: {type: "none"},
      vault_ids: [$vault_id],
      input: [{
        role: "user",
        content: [{
          type: "input_text",
          text: "Find open bugs reported in the last week."
        }]
      }]
    }')"
```

**SDK**



**Python**

```python
session = await client.sessions.create(
    agent={
        "model": "gpt-5.6",
        "tools": [
            {
                "type": "mcp",
                "server_label": "github",
                "transport": {
                    "type": "http",
                    "server_url": os.environ["GITHUB_MCP_URL"],
                },
                "required": True,
            }
        ],
    },
    environment={"type": "none"},
    input="Summarize the open issues.",
    vault_ids=[vault.id],
)
```

**TypeScript**

```typescript
const session = await client.beta.agents.sessions.create({
  agent: {
    model: "gpt-5.6",
    tools: [
      {
        type: "mcp",
        server_label: "github",
        transport: {
          type: "http",
          server_url: process.env.GITHUB_MCP_URL!,
        },
        required: true,
      },
    ],
  },
  environment: { type: "none" },
  input: [
    {
      role: "user",
      content: [{ type: "input_text", text: "Summarize the open issues." }],
    },
  ],
  vault_ids: [vault.id],
});
```

When the agent calls `search_issues` or `issue_read`, the hosted service finds the matching credential and authenticates the remote MCP request.

## Diagnose MCP startup failures

Set `required: true` when this MCP server is essential to the agent’s task.

If the server connection fails during startup, the turn emits `session.turn.failed`. Use `error.code` to identify the cause:

- `authentication_error`: The server requires authentication or reauthentication. Confirm that the attached vault contains a valid credential for the exact server URL, then reconnect or refresh the grant.
- `connection_failed`: The server could not be reached. Check its URL, availability, TLS configuration, outbound network access, and `connection_origin`.

Read the error message from the failed-turn event. Never put access tokens, OAuth secrets, or vault credential values into logs or error reports.
