---
title: "Vaults"
slug: vaults
order: 23
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/vaults
---

# Vaults

Agents can use credentials managed by your application, provided through the sandbox, or stored in a vault.

Vaults store scoped credentials once and make them available to authorized sessions.

For a restricted application key, use **Managed Agents → Read** (`api.agents.read`) for read-only vault access or **Managed Agents → Write** (`api.agents.read` and `api.agents.write`) to create, rotate, archive, or delete vault credentials.

**Supported:** Static bearer tokens and OAuth credentials for remote MCP servers.

**Not yet supported:** Environment-variable credentials.

## Create a vault and add a credential

A vault groups credentials that can be attached to agent sessions. Vaults support bearer tokens and existing OAuth grants for authenticating remote MCP servers.

**cURL**

```bash
curl https://api.openai.com/v1/vaults \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"display_name":"GitHub credentials","metadata":{"external_user_id":"user_123"}}'
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

Add a credential associated with the MCP server’s URL:

**cURL**

```bash
curl "https://api.openai.com/v1/vaults/$VAULT_ID/credentials" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"display_name":"GitHub access token","auth":{"type":"static_bearer","mcp_server_url":"https://api.githubcopilot.com/mcp/x/issues/readonly","token":"REPLACE_WITH_SCOPED_TOKEN"},"source":{"type":"openai_managed"}}'
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

The token is used only for requests to the specified MCP server and is not returned when retrieving the credential.

## Store an OAuth credential

Use `mcp_oauth` when your application already has an OAuth access token for an HTTPS MCP server. Add the optional `expires_at` timestamp to record when the access token expires, and add `refresh` to let the Agents API refresh the grant when needed.

**cURL**

```bash
curl "https://api.openai.com/v1/vaults/$VAULT_ID/credentials" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg access_token "$OAUTH_ACCESS_TOKEN" \
    --arg refresh_token "$OAUTH_REFRESH_TOKEN" \
    --arg client_id "$OAUTH_CLIENT_ID" \
    '{
      display_name: "Example MCP OAuth credential",
      auth: {
        type: "mcp_oauth",
        mcp_server_url: "https://mcp.example.com",
        access_token: $access_token,
        expires_at: "2099-12-31T23:59:59Z",
        refresh: {
          token_endpoint: "https://auth.example.com/oauth/token",
          client_id: $client_id,
          refresh_token: $refresh_token,
          token_endpoint_auth: {type: "none"}
        }
      },
      source: {type: "openai_managed"}
    }')"
```

**SDK**

```python
import os

credential = await client.vaults.credentials.create(
    vault.id,
    display_name="Example MCP OAuth credential",
    auth={
        "type": "mcp_oauth",
        "mcp_server_url": "https://mcp.example.com",
        "access_token": os.environ["OAUTH_ACCESS_TOKEN"],
        "expires_at": "2099-12-31T23:59:59Z",
        "refresh": {
            "token_endpoint": "https://auth.example.com/oauth/token",
            "client_id": os.environ["OAUTH_CLIENT_ID"],
            "refresh_token": os.environ["OAUTH_REFRESH_TOKEN"],
            "token_endpoint_auth": {"type": "none"},
        },
    },
)
```

Your application owns the provider authorization and consent flow. The Agents API stores the existing grant and can refresh it; access tokens, refresh tokens, and client secrets are never returned. Token endpoint authentication supports `none`, `client_secret_basic`, and `client_secret_post`.

`expires_at` sets the OAuth access token’s expiration time. After that time, the next MCP request requires a fresh token. The Agents API uses the configured `refresh` settings to obtain one. If refresh is unavailable or fails, update the credential with a valid access token before retrying.

The credential record and its vault remain stored after token expiry. Use the archive or delete operations below to remove them or their secret values.

## Rotate an OAuth credential

Replace an access token and its expiration without creating a new credential:

```python
credential = await client.vaults.credentials.rotate(
    vault.id,
    credential.id,
    auth={
        "type": "mcp_oauth",
        "access_token": os.environ["OAUTH_ACCESS_TOKEN"],
        "expires_at": "2100-01-01T00:00:00Z",
    },
)
```

Include `expires_at` whenever the replacement token expires. Set it to `None` to clear a previously stored expiration.

## Archive a credential or vault

Archiving a credential removes the secret values stored in it:

- For `static_bearer`: the bearer token.
- For `mcp_oauth`: the access token, refresh token, and client secret, when present.

The credential record remains available, including its ID, vault ID, display name, MCP server URL, authentication type, OAuth expiration and refresh settings, and timestamps. The API sets `archived_at` to the time of archival. To authenticate again, create a new credential; archived credentials are inactive and cannot be rotated.

```bash
curl -X POST "https://api.openai.com/v1/vaults/$VAULT_ID/credentials/$CREDENTIAL_ID/archive" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

Archiving a vault applies the same secret removal to every credential it contains. The vault record, its display name and metadata, and the archived credential records remain available. The vault receives an `archived_at` timestamp and becomes unavailable for new sessions.

```bash
curl -X POST "https://api.openai.com/v1/vaults/$VAULT_ID/archive" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

Archived vaults and credentials are excluded from list responses by default. Pass `include_archived=true` when listing them to include archived metadata.

## Delete a credential

Delete a credential when you no longer need its record. The operation removes the stored secret values and then removes the credential resource. Use archive if you need to retain its metadata.

```bash
curl -X DELETE "https://api.openai.com/v1/vaults/$VAULT_ID/credentials/$CREDENTIAL_ID" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

The response identifies the deleted credential:

```json
{
  "id": "credential_example",
  "object": "vault.credential.deleted"
}
```

## Delete a vault

Deleting a vault removes its stored secret values, all of its credential records, and the vault resource. This includes credentials that were already archived. You do not need to archive the vault or delete its credentials separately before calling this endpoint.

```bash
curl -X DELETE "https://api.openai.com/v1/vaults/$VAULT_ID" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

The response identifies the deleted vault:

```json
{
  "id": "vault_example",
  "object": "vault.deleted"
}
```

## Changes during a session

Before listing or calling tools on an MCP server, the Agents API reads the credential from the vault. Changes take effect on the next request:

- **Rotate:** The next request uses the replacement token.
- **Archive or delete:** The next request that needs that credential fails authentication.

For example, if you rotate a token while a session is running, the agent’s next tool call uses the new token. A tool call already in progress may finish with the old token. The session stays running; you can interrupt it separately if needed.

Archiving or deleting a stored credential does not revoke the original token with its provider. Your application owns provider-side revocation.
