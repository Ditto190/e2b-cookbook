---
title: "API reference"
slug: api-reference
order: 32
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/api-reference
---

# API reference

This page describes the current public Agents API contract. A session runs a configured agent, receives input events, streams live output events, and exposes completed work as persisted items.

```plain
Agents API: https://api.openai.com/v1/agents
Vaults API: https://api.openai.com/v1/vaults
Executor:   https://api.openai.com/v1/agents/api
```

Authenticate application requests with an approved project API key and include the beta header:

```plain
Authorization: Bearer $OPENAI_API_KEY
OpenAI-Beta: agents=v1
Content-Type: application/json
```

Grant the application key **Responses (/v1/responses) → Write** for model inference and session operations. When available, add **Managed Agents → Write**, which grants both `api.agents.read` and `api.agents.write`, when managing vaults or environment templates. Session mutation endpoints accept `api.agents.write` or `api.responses.write`, but running model inference requires `api.responses.write`. Session and turn reads accept `api.agents.read`, `api.responses.read`, or `api.responses.write`. A key with only `api.agents.write` cannot read sessions or run model inference. For restricted application keys, vault and environment-template mutations require `api.agents.write`; reads require `api.agents.read`. Listing or retrieving exporters requires access to the project. Creating, updating, or deleting exporters requires project-owner permissions. Requests without the required project authorization return `403 Forbidden`. Executors require a separate restricted API key. Detailed trace retrieval is dashboard-only and requires tracing access; it is not available through a project API key.

## Endpoints

### Agents

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/agents` | Create an agent. |
| `GET` | `/v1/agents` | List agents. |
| `POST` | `/v1/agents/{agent_id}` | Update an agent. |
| `GET` | `/v1/agents/{agent_id}` | Retrieve an agent. |
| `DELETE` | `/v1/agents/{agent_id}` | Delete an agent. |

### Environment template endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/agents/environments/templates` | Create an agent environment template. |
| `GET` | `/v1/agents/environments/templates` | List agent environment templates. |
| `POST` | `/v1/agents/environments/templates/{environment_template_id}` | Update an agent environment template. |
| `GET` | `/v1/agents/environments/templates/{environment_template_id}` | Retrieve an agent environment template. |
| `DELETE` | `/v1/agents/environments/templates/{environment_template_id}` | Delete an agent environment template. |

### Sessions

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/agents/sessions` | Create an agent session. |
| `GET` | `/v1/agents/sessions` | List agent sessions. |
| `GET` | `/v1/agents/sessions/{session_id}` | Retrieve an agent session. |
| `DELETE` | `/v1/agents/sessions/{session_id}` | Delete an agent session. |
| `POST` | `/v1/agents/sessions/{session_id}/events` | Create agent session input events. |
| `GET` | `/v1/agents/sessions/{session_id}/events?stream=true` | Stream agent session events. |
| `GET` | `/v1/agents/sessions/{session_id}/items` | List agent session items. |
| `GET` | `/v1/agents/sessions/{session_id}/turns` | List agent session turns. |
| `GET` | `/v1/agents/sessions/{session_id}/turns/{turn_id}` | Retrieve an agent session turn. |

Use the turn endpoints to list or retrieve durable turn status, usage, and subagent attribution. Per-turn `/events` endpoints are not available; use the session event stream.

### Artifact endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/agents/sessions/{session_id}/artifacts` | List agent session artifacts. |
| `GET` | `/v1/agents/sessions/{session_id}/artifacts/{artifact_id}` | Retrieve an agent session artifact. |
| `DELETE` | `/v1/agents/sessions/{session_id}/artifacts/{artifact_id}` | Delete an agent session artifact. |
| `GET` | `/v1/agents/sessions/{session_id}/artifacts/{artifact_id}/content` | Retrieve agent session artifact content. |

### Telemetry exporters

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/agents/telemetry/exporters` | Create an agent telemetry exporter. |
| `GET` | `/v1/agents/telemetry/exporters` | List agent telemetry exporters. |
| `POST` | `/v1/agents/telemetry/exporters/{exporter_id}` | Update an agent telemetry exporter. |
| `GET` | `/v1/agents/telemetry/exporters/{exporter_id}` | Retrieve an agent telemetry exporter. |
| `DELETE` | `/v1/agents/telemetry/exporters/{exporter_id}` | Delete an agent telemetry exporter. |

### Vaults and credentials

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/vaults` | Create a vault. |
| `GET` | `/v1/vaults` | List vaults. |
| `GET` | `/v1/vaults/{vault_id}` | Retrieve a vault. |
| `DELETE` | `/v1/vaults/{vault_id}` | Delete a vault. |
| `POST` | `/v1/vaults/{vault_id}/archive` | Archive a vault. |
| `POST` | `/v1/vaults/{vault_id}/credentials` | Create a vault credential. |
| `GET` | `/v1/vaults/{vault_id}/credentials` | List vault credentials. |
| `POST` | `/v1/vaults/{vault_id}/credentials/{credential_id}` | Rotate a vault credential. |
| `GET` | `/v1/vaults/{vault_id}/credentials/{credential_id}` | Retrieve a vault credential. |
| `DELETE` | `/v1/vaults/{vault_id}/credentials/{credential_id}` | Delete a vault credential. |
| `POST` | `/v1/vaults/{vault_id}/credentials/{credential_id}/archive` | Archive a vault credential. |

## Agents

Create an agent once and reuse its model, instructions, tools, and other configuration across sessions:

```bash
curl https://api.openai.com/v1/agents \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.6",
    "instructions": "Answer technical questions accurately."
  }'
```

Returns `201 Created` with the agent ID, resolved configuration, and creation/update timestamps. Stored agents are scoped to the current project and do not contain credentials.

Reference the stored agent when creating a session:

```json
{
  "agent": {
    "type": "agent_reference",
    "agent_id": "agent_..."
  },
  "environment": { "type": "none" },
  "input": [
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "Explain how MCP servers connect." }
      ]
    }
  ]
}
```

The Python SDK exposes `client.agents.create()`, `client.agents.list()`, `client.agents.retrieve()`, `client.agents.update()`, and `client.agents.delete()`. The TypeScript SDK exposes the same operations under `client.beta.agents`.

## Environment templates

Create a reusable, project-scoped self-hosted environment configuration:

```bash
curl https://api.openai.com/v1/agents/environments/templates \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "self_hosted",
    "name": "Default workspace",
    "workspace_directory": "/workspace",
    "capability_directories": ["/workspace/capabilities"]
  }'
```

Returns `201 Created` with an `envtmpl_...` template ID. Reference that ID when creating a session:

```json
{
  "agent": { "model": "gpt-5.6" },
  "environment": {
    "type": "self_hosted",
    "environment_template_id": "envtmpl_..."
  }
}
```

Sessions inherit the template’s workspace and capability directories; inline values override them. Templates reuse configuration, not a running sandbox, so each session still receives its own environment ID and executor. Use the HTTP endpoints above; the preview SDKs do not yet include template-management helpers.

## Session artifacts

Artifacts are immutable files published from `/workspace/outputs` after an OpenAI-hosted session turn completes. They remain available after the execution environment expires. Self-hosted sandboxes do not publish artifacts through this API; access their files through the sandbox provider instead.

List a session’s published artifacts:

```bash
curl "https://api.openai.com/v1/agents/sessions/$SESSION_ID/artifacts?limit=20" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

Each artifact includes its `id`, `session_id`, `environment_id`, `turn_id`, original `path`, `size_bytes`, and `created_at` timestamp. Filter by `environment_id`, paginate with `after`, and request up to 100 items with `limit`.

Download the immutable file contents:

```bash
curl "https://api.openai.com/v1/agents/sessions/$SESSION_ID/artifacts/$ARTIFACT_ID/content" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  --output artifact
```

Deleting an artifact removes the stored artifact without deleting the live environment file or its original Files API object. Individual artifacts can be up to 200 MiB; published outputs are limited to 500 MiB combined.

## Sessions

### Create a session

```plain
POST /v1/agents/sessions
```

Returns `201 Created` with the session, or a server-sent event stream when `stream` is `true`.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `agent` | object | One of | Inline agent configuration or an `agent_reference`; exclusive with `agent_id`. |
| `agent_id` | string | One of | Legacy persisted-agent ID; exclusive with `agent`. |
| `environment` | object | Yes | An OpenAI-hosted or self-hosted environment, or `none`. |
| `input` | `InputMessage[]` | Conditional | Required for conversation-only sessions; recommended when `stream` is `true`. |
| `vault_ids` | `string[]` | No | Vaults whose credentials are available to this session. |
| `tracing` | object | No | Completed-turn trace settings; tracing is enabled by default. |
| `stream` | boolean | No | Return a live event stream instead of a JSON session. Defaults to `false`. |

Provide exactly one agent source: either `agent` or the legacy `agent_id`. Initial `input` is required when `environment.type` is `none`. Some session backends also require initial input when `stream` is `true`. Non-streaming self-hosted sessions can omit initial input.

```bash
curl https://api.openai.com/v1/agents/sessions \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": {
      "model": "gpt-5.6",
      "instructions": "Inspect the workspace, make focused changes, and run tests."
    },
    "environment": {
      "type": "self_hosted",
      "workspace_directory": "/workspace"
    }
  }'
```

Individual turns currently have a maximum supported duration of one hour.

### Agent configuration

```typescript
type AgentConfig = {
  model: string;
  instructions?: string;
  reasoning?: {
    effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
    summary?: "auto" | "concise" | "detailed" | null;
  };
  text?: {
    verbosity?: "low" | "medium" | "high";
    format?: {
      type: "json_schema";
      schema: Record<string, unknown>;
    };
  };
  service_tier?: "auto" | "default" | "flex" | "priority" | "fast";
  tools?: Tool[];
  multi_agent?: { type: "disabled" } | { type: "enabled"; max_agents?: number };
};
```

`model` must be non-empty. Structured output belongs under `agent.text.format`, not `agent.output_schema`; its schema must be a JSON object whose top-level `type` is `"object"`. Top-level `oneOf`, `anyOf`, `allOf`, `enum`, and `not` are not supported.

Reasoning summaries are disabled by default. Existing integrations that relied on automatic summaries must explicitly set `reasoning.summary` to `auto` to restore them. You can also request `concise` or `detailed` summaries. Omit the setting or pass `null` to leave summaries disabled. In Python, create a stored agent with `reasoning={"summary": "auto"}`; in TypeScript, set `agent.reasoning.summary` to `"auto"`.

Programmatic tool calling is enabled by default. To disable it, include `{ "type": "programmatic_tool_calling", "enabled": false }` in `agent.tools`. Omitting the tool entry or its `enabled` field leaves it enabled. It is available with or without a sandbox; sandbox-backed tools still require an execution environment.

Multi-agent delegation is disabled by default. Enable subagents with `multi_agent.type: "enabled"`. `max_agents` limits concurrent subagents and defaults to `6`; the root agent does not count toward this limit. For example, `max_agents: 4` permits four concurrent subagents plus the root agent. Do not use the old `max_threads` field.

Subagent activity can include an `interrupt_agent_call` item. An interrupt stops the target subagent’s current turn without closing the subagent.

Tracing is enabled by default. To control completed-turn tracing and external exporters, pass:

```typescript
type TracingConfig = {
  enabled?: boolean;
  exporter_ids?: string[];
};
```

### Function tools and tool search

```typescript
type FunctionTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  defer_loading?: boolean;
};

type ToolSearchTool = {
  type: "tool_search";
};

type ProgrammaticToolCallingTool = {
  type: "programmatic_tool_calling";
  enabled?: boolean;
};
```

Function names must be unique and non-empty, and `parameters` must be a JSON Schema object. Your application runs the function and returns its result with `session.input.tool_result`.

Set `defer_loading: true` to make a function discoverable on demand, and include `{ "type": "tool_search" }` in `agent.tools`. Functions are loaded eagerly by default. `tool_search` does not accept an `execution` setting and is not included in the returned session’s tool list.

### MCP tools

```typescript
type McpTool = {
  type: "mcp";
  server_label: string;
  transport:
    | {
        type: "http";
        server_url: string;
        authorization?: string;
        headers?: Record<string, string>;
      }
    | {
        type: "stdio";
        command: string;
        cwd: string;
        args?: string[];
        env_vars?: string[];
      };
  allowed_tools?: string[];
  required?: boolean;
  credential_id?: string;
  request_metadata?: Record<string, unknown>;
  connection_origin?: "service" | "environment";
};
```

HTTP MCP connections originate from the managed service by default: omitting `connection_origin` is equivalent to `"service"`. Set it to `"environment"` to connect from the session’s sandbox. Use `stdio` for a process launched inside the sandbox, and omit `connection_origin` for that transport. Both executor modes require a session environment. `allowed_tools` restricts the server tools exposed to the agent.

Set `required: true` when an MCP server must initialize before the first turn; it defaults to `false`. Use `credential_id` to select a specific credential from an attached vault when more than one can match the server. Vault credential selection applies only to service-origin HTTP MCPs.

MCP servers that allow anonymous access can be used directly.

For session-specific HTTP authentication, supply `transport.authorization` or `transport.headers`. The Agents API encrypts these credentials for the session and omits them from the returned session resource.

For service-origin HTTP MCPs, attach a [vault](./23-vaults.md) to manage credentials separately from sessions. Vault credentials are scoped to an MCP server URL and can be reused, rotated, or archived independently of session configuration. Pass the vault ID in `vault_ids` when creating the session.

Choose one source for the `Authorization` header: inline configuration or a matching vault credential. Other headers can accompany vault authentication. Environment-origin HTTP does not accept a matching attached MCP vault credential.

For `stdio` MCP servers, set credential values in the sandbox and pass their names in `env_vars`; self-hosted sessions reject inline `env` values.

### Web search

```typescript
type WebSearchTool = {
  type: "web_search";
  mode?: "disabled" | "cached" | "live";
  context_size?: "low" | "medium" | "high";
  allowed_domains?: string[];
  location?: {
    country?: string;
    region?: string;
    city?: string;
    timezone?: string;
  };
};

type Tool =
  | FunctionTool
  | ToolSearchTool
  | ProgrammaticToolCallingTool
  | McpTool
  | WebSearchTool;
```

Web search is unavailable unless a `web_search` tool is included. Bash and file editing are sandbox runtime capabilities, not entries in `agent.tools`.

### Environment configuration

```typescript
type Environment =
  | {
      type: "none";
    }
  | {
      type: "openai_hosted";
      environment_template_id?: string;
      packages?: {
        python?: string[];
        system?: string[];
        npm?: string[];
      };
      setup_commands?: Array<{ command: string; cwd?: string }>;
      network?: {
        access: "enabled" | "disabled" | "restricted";
        allowed_domains?: string[];
      };
      env?: Record<string, string>;
      capability_directories?: string[];
      skills?: Array<Record<string, unknown>>;
      plugins?: Array<Record<string, unknown>>;
      files?: Array<
        | { type: "file_id"; file_id: string; path: string }
        | { type: "inline"; data: string; path: string }
      >;
    }
  | {
      type: "self_hosted";
      environment_template_id?: string;
      workspace_directory?: string;
      capability_directories?: string[];
    };
```

An OpenAI-hosted environment provisions a managed sandbox with optional packages, setup commands, network controls, files, skills, and plugins. The Python and TypeScript preview SDKs do not yet expose `openai_hosted`; use the HTTP API until SDK support is available. Hosted sandbox execution remains in limited preview: shell and filesystem operations may currently fail with `sandbox_error`. Use `self_hosted` when your workflow requires reliable sandbox execution.

A self-hosted environment requires an absolute `workspace_directory`, such as `/workspace`, unless `environment_template_id` supplies one. Add directories containing skills or plugins with `capability_directories`; supply at most 32 unique absolute paths without `.` or `..` components.

Use `none` when the agent does not need a shell, files, local MCP processes, or a sandbox. Initial input is required when creating a conversation-only session. The harness still provides durable sessions, remote tools, programmatic tool calling, and multi-agent orchestration. Service-origin HTTP MCP credentials can be supplied inline at session creation or through an attached vault; stdio and environment-origin MCP tools require an execution environment.

### Input messages

```typescript
type InputMessage = {
  type?: "message";
  role: "user";
  content: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string }
  >;
};
```

Each message must contain at least one non-empty text or image content item. `input_file` is not currently supported.

### Session resource

```typescript
type Session = {
  id: string;
  object: "agent.session";
  created_at: number;
  last_active_at: number;
  status: "idle" | "in_progress" | "requires_action" | "failed";
  error: string | null;
  agent: AgentConfig & { id: string; tools: Tool[] };
  environment:
    | { type: "none" }
    | {
        type: "openai_hosted";
        id: string;
        packages: {
          python: string[];
          system: string[];
          npm: string[];
        };
        network: {
          access: "enabled" | "disabled" | "restricted";
          allowed_domains: string[];
        };
        capability_directories: string[];
        skills: Array<Record<string, unknown>>;
        plugins: Array<Record<string, unknown>>;
        files: Array<Record<string, unknown>>;
      }
    | {
        type: "self_hosted";
        id: string;
        workspace_directory: string;
        capability_directories: string[];
      };
  vault_ids: string[];
  required_actions: Array<
    | {
        type: "function_call";
        name: string;
        arguments: unknown;
        call_id: string;
        turn_id: string;
      }
    | { type: "environment_connection"; environment_id: string }
  >;
  usage: {
    input_tokens: number;
    input_tokens_details: { cached_tokens: number };
    output_tokens: number;
    output_tokens_details: { reasoning_tokens: number };
    total_tokens: number;
  } | null;
};
```

`idle` means the session can receive more work; `in_progress` means a turn is running; `requires_action` means the session is waiting for an application-owned function result or environment connection; and `failed` means the session cannot continue. Read pending work from `required_actions`. Sandbox connection progress is reported by `session.environment.pending`, `session.environment.connected`, and `session.environment.failed` events, not by a `waiting` session status.

### List sessions

```plain
GET /v1/agents/sessions
```

| Parameter | Location | Description |
| --- | --- | --- |
| `cursor` | query | Cursor from the previous response. |
| `limit` | query | Requested page size; must be greater than zero. |
| `order` | query | `asc` or `desc`; defaults to `desc`. |

```typescript
type SessionList = {
  object: "list";
  page: Session[];
  has_more: boolean;
  next_cursor: string | null;
};
```

### Retrieve a session

```plain
GET /v1/agents/sessions/{session_id}
```

Returns `200 OK` with the session.

### List session turns

```plain
GET /v1/agents/sessions/{session_id}/turns
```

Returns `200 OK` with turns in creation-time and turn-ID order.

| Parameter | Location | Default | Description |
| --- | --- | --- | --- |
| `limit` | query | `20` | Number of turns to return, from `1` through `100`. |
| `order` | query | `desc` | Return turns in `asc` or `desc` order. |
| `after` | query | — | Continue after a turn ID in the same selected order. |

```typescript
type SessionTurnList = {
  object: "list";
  data: SessionTurn[];
  first_id: string | null;
  last_id: string | null;
  has_more: boolean;
};
```

When `has_more` is `true`, request the next page with `after` set to `last_id` and keep the same `order`.

```python
turns = await client.sessions.turns.list(SESSION_ID, limit=20, order="desc")

if turns.has_more and turns.last_id is not None:
    next_turns = await client.sessions.turns.list(
        SESSION_ID, after=turns.last_id, limit=20, order="desc"
    )
```

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

### Retrieve a session turn

```plain
GET /v1/agents/sessions/{session_id}/turns/{turn_id}
```

Returns `200 OK` with the turn. A turn that does not belong to the session returns `404`.

```typescript
import type { Turn } from "@openai/agents-api-preview/resources/beta/agents";

type SessionTurn = {
  id: string;
  object: "session.turn";
  session_id: string;
  agent_id: string;
  subagent_id: string | null;
  status:
    | "queued"
    | "in_progress"
    | "waiting"
    | "completed"
    | "failed"
    | "cancelled";
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  error: { code: string; message: string } | null;
  usage: Turn.Usage | null;
};
```

```python
turn = await client.sessions.turns.retrieve(SESSION_ID, TURN_ID)
print(turn.subagent_id)
```

```typescript
const turn = await client.beta.agents.sessions.turns.retrieve(
  sessionId,
  turnId
);
console.log(turn.subagent_id);
```

A command item contains `command.turn_id`. Retrieve that turn and read `turn.subagent_id` to identify the delegated agent that ran the command. `subagent_id: null` identifies the root agent.

### Delete a session

```plain
DELETE /v1/agents/sessions/{session_id}
```

Returns `200 OK`:

```json
{
  "id": "sess_...",
  "object": "agent.session.deleted",
  "deleted": true
}
```

### List session items

```plain
GET /v1/agents/sessions/{session_id}/items
```

Items are the persisted record of user messages, assistant output, tool calls, tool results, and multi-agent activity. Use them to inspect completed work or rebuild application state after a stream disconnect.

| Parameter | Location | Default | Description |
| --- | --- | --- | --- |
| `limit` | query | Server default | Number of items to return, from `1` through `100`. |
| `after` | query | — | Cursor after which items are returned. |
| `order` | query | `desc` | `asc` or `desc`. |

```typescript
type SessionItemList = {
  data: SessionItem[];
  has_more: boolean;
  before: string | null;
  after: string | null;
};
```

Pass `after` back with the same `order` to continue forward. To move backward, reverse `order` and use `before` as the next `after` cursor.

### Stream session events

```plain
GET /v1/agents/sessions/{session_id}/events?stream=true
```

This endpoint only returns a live server-sent event stream. `stream=true` is required. Requests without it fail, and `after_sequence_number`, `limit`, `Last-Event-ID`, and paginated event history are not supported.

```bash
curl -N \
  "https://api.openai.com/v1/agents/sessions/$SESSION_ID/events?stream=true" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Accept: text/event-stream"
```

The public SDKs only support live event subscriptions:

```python
async for event in session.stream_events():
    print(event.type)
```

```typescript
const events = await client.beta.agents.sessions.events.stream(session.id, {
  stream: true,
});

try {
  for await (const event of events) {
    console.log(event.type);
  }
} finally {
  events.controller.abort();
}
```

For new work, connect the live stream before submitting input. Always close the stream when finished or when input submission fails.

If the connection drops, connect a new live stream first. Buffer incoming events, retrieve the session and its persisted `/items`, reconcile the buffered events by `item_id`, and resume live processing. The service does not provide event replay or last-turn history.

### Send input to a session

```plain
POST /v1/agents/sessions/{session_id}/events
```

Returns `202 Accepted` with an empty response. Wrap one or more input events in an `events` array:

```json
{
  "events": [
    {
      "type": "session.input.message",
      "input": [
        {
          "type": "message",
          "role": "user",
          "content": [
            { "type": "input_text", "text": "Summarize the repository." }
          ]
        }
      ]
    }
  ]
}
```

A message starts a new turn when the session is idle. If a turn is already running, the same message event steers that turn. There is no separate `session.input.steer` event.

Cancel the active turn without ending the session:

```json
{
  "events": [{ "type": "session.input.cancel" }]
}
```

Return the result of an application-run function:

```json
{
  "events": [
    {
      "type": "session.input.tool_result",
      "turn_id": "turn_...",
      "call_id": "call_...",
      "success": true,
      "output": "{\"temperature_f\":72}"
    }
  ]
}
```

Function output must be a string or an array of supported input-content items; serialize JSON objects before submitting them. On failure, set `success` to `false` and provide an `error` string.

## Events and items

Each event has an `event_id`. Depending on its type, it can also include `session_id`, `turn_id`, `item_id`, `output_index`, or `content_index`. Events are live updates; items are the persisted results.

### Input events

| Event | Purpose | Important fields |
| --- | --- | --- |
| `session.input.message` | Start a turn or steer the active turn. | `input` |
| `session.input.cancel` | Cancel the active turn. | No additional fields |
| `session.input.tool_result` | Return a function result. | `turn_id`, `call_id`, `success`, `output` or `error` |

### Lifecycle events

| Event | Meaning |
| --- | --- |
| `session.created` | The session was created. |
| `session.in_progress` | The session started processing work. |
| `session.requires_action` | The session needs an application action. |
| `session.idle` | The session is ready for another message. |
| `session.failed` | The session failed. |
| `session.environment.pending` | The environment is being prepared. |
| `session.environment.connected` | The environment is ready. |
| `session.environment.failed` | The environment failed to connect. |
| `session.turn.created` | A new turn was created. |
| `session.turn.in_progress` | The turn started. |
| `session.turn.completed` | The turn finished successfully. |
| `session.turn.failed` | The turn failed. |
| `session.turn.cancelled` | The turn was cancelled. |
| `session.turn.item.added` | An item was added to the turn. |
| `session.turn.item.done` | An output item reached its final state. |
| `session.subagent.created` | A subagent was created. |
| `session.subagent.closed` | A subagent was closed. |
| `session.thread.created` | An agent thread was created. |
| `session.thread.status_changed` | An agent thread changed status. |
| `agent.thread.message.sent` | One agent sent a message to another. |
| `agent.thread.message.received` | An agent received an inter-agent message. |

### Output events

| Event | Meaning |
| --- | --- |
| `agent.output.item` | The agent produced an output item. |
| `session.turn.output_text.added` | An assistant text block started. |
| `session.turn.output_text.delta` | Another assistant-text chunk arrived. |
| `session.turn.output_text.done` | The complete assistant text is available. |
| `session.turn.reasoning_summary_text.added` | A reasoning-summary block started. |
| `session.turn.reasoning_summary_text.delta` | Another reasoning-summary chunk arrived. |
| `session.turn.reasoning_summary_text.done` | The complete reasoning summary is available. |
| `agent.output.command_execution_output.delta` | Another command-output chunk arrived. |

### Item types

| Item type | What it represents |
| --- | --- |
| `message` | A user message or assistant response. |
| `reasoning` | A reasoning summary. |
| `function_call` | A function your application should run. |
| `function_call_output` | The function result returned by your application. |
| `mcp_call` | A call to an MCP server tool. |
| `web_search_call` | A web search performed by the agent. |
| `command_execution` | A command run in the sandbox. |
| `agent_message` | A message exchanged between agents. |
| `spawn_agent_call` | A request to create a subagent. |
| `send_input_call` | Additional instructions for another agent. |
| `interrupt_agent_call` | Interrupt a subagent’s current turn without closing it. |
| `resume_agent_call` | A request to resume a subagent. |
| `wait_for_agents_call` | A request to wait for subagent results. |
| `close_agent_call` | A request to close a subagent. |

An assistant response generally moves through `session.turn.item.added`, one or more text events, and `session.turn.item.done`. The `.done` event contains the completed item; retrieve `/items` for the durable record.

## Telemetry exporters

Telemetry exporters send completed-turn traces to a project-scoped OTLP/HTTP collector. Configure an exporter before creating the session, then include its ID in `tracing.exporter_ids`.

Listing or retrieving exporters requires access to the project. Creating, updating, or deleting exporters requires project-owner permissions. Requests without the required project authorization return `403 Forbidden`.

### Create an exporter

```plain
POST /v1/agents/telemetry/exporters
```

```bash
curl https://api.openai.com/v1/agents/telemetry/exporters \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production trace collector",
    "endpoint": "https://collector.example.com/v1/traces",
    "headers": { "Authorization": "Bearer YOUR_COLLECTOR_TOKEN" }
  }'
```

The endpoint must use public HTTPS on port `443`. `protocol` defaults to `otlp_http_protobuf`.

```json
{
  "id": "texp_123",
  "object": "agent.telemetry.exporter",
  "name": "Production trace collector",
  "protocol": "otlp_http_protobuf",
  "endpoint": "https://collector.example.com/v1/traces",
  "header_names": ["Authorization"]
}
```

Authentication header values are write-only. They are encrypted and never appear in create, list, retrieve, or update responses; `header_names` contains names only.

```python
exporter = await client.telemetry.exporters.create(
    name="Production trace collector",
    endpoint="https://collector.example.com/v1/traces",
    headers={"Authorization": "Bearer YOUR_COLLECTOR_TOKEN"},
)

session = await client.sessions.create(
    agent={"model": "gpt-5.6"},
    environment={"type": "none"},
    input="Summarize the support request.",
    tracing={"enabled": True, "exporter_ids": [exporter.id]},
)
```

```typescript
const exporter = await client.beta.agents.telemetry.exporters.create({
  name: "Production trace collector",
  endpoint: "https://collector.example.com/v1/traces",
  headers: { Authorization: "Bearer YOUR_COLLECTOR_TOKEN" },
});

const session = await client.beta.agents.sessions.create({
  agent: { model: "gpt-5.6" },
  environment: { type: "none" },
  input: [
    {
      role: "user",
      content: [{ type: "input_text", text: "Summarize the support request." }],
    },
  ],
  tracing: { enabled: true, exporter_ids: [exporter.id] },
});
```

### List or retrieve exporters

```plain
GET /v1/agents/telemetry/exporters
GET /v1/agents/telemetry/exporters/{exporter_id}
```

Exporter lists accept `cursor` and a `limit` from `1` through `100`. The response includes `data`, `first_id`, `last_id`, `has_more`, and `next_cursor`. When `has_more` is `true`, pass `next_cursor` as `cursor` in the next request.

```python
page = await client.telemetry.exporters.list(limit=20)
if page.has_more and page.next_cursor is not None:
    next_page = await client.telemetry.exporters.list(cursor=page.next_cursor, limit=20)

exporter = await client.telemetry.exporters.retrieve(EXPORTER_ID)
```

```typescript
const page = await client.beta.agents.telemetry.exporters.list({ limit: 20 });
if (page.has_more && page.next_cursor) {
  const nextPage = await client.beta.agents.telemetry.exporters.list({
    cursor: page.next_cursor,
    limit: 20,
  });
}

const exporter =
  await client.beta.agents.telemetry.exporters.retrieve(exporterId);
```

### Update or delete an exporter

```plain
POST /v1/agents/telemetry/exporters/{exporter_id}
DELETE /v1/agents/telemetry/exporters/{exporter_id}
```

When the collector endpoint does not change:

- Omit `headers` to preserve existing authentication headers.
- Pass `headers: null` to clear all existing headers.
- Pass a header map to add or replace values. Set an individual value to `null` to remove that header.

Changing the normalized endpoint, including its path, clears all existing authentication headers before applying the same request’s header map. If you change the endpoint and omit `headers`, no authentication headers remain.

```python
await client.telemetry.exporters.update(
    EXPORTER_ID,
    headers={"Authorization": "Bearer NEW_COLLECTOR_TOKEN", "Obsolete": None},
)
await client.telemetry.exporters.update(EXPORTER_ID, headers=None)
deleted = await client.telemetry.exporters.delete(EXPORTER_ID)
```

```typescript
await client.beta.agents.telemetry.exporters.update(exporterId, {
  headers: { Authorization: "Bearer NEW_COLLECTOR_TOKEN", Obsolete: null },
});
await client.beta.agents.telemetry.exporters.update(exporterId, {
  headers: null,
});
const deleted = await client.beta.agents.telemetry.exporters.delete(exporterId);
```

Deletion returns `200 OK` with `{ "id": "texp_123", "object": "agent.telemetry.exporter.deleted", "deleted": true }`.

## Vaults

Vaults store credentials separately from the agent prompt and sandbox. Supported credential types are `static_bearer` and `mcp_oauth`. Environment-variable credentials are not publicly available.

### Create a vault

```bash
curl https://api.openai.com/v1/vaults \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "GitHub credentials",
    "metadata": { "external_user_id": "user_123" }
  }'
```

Returns `201 Created` with a vault containing `id`, `object: "vault"`, `display_name`, `metadata`, creation/update timestamps, and `archived_at`.

### Create or rotate a credential

```bash
curl "https://api.openai.com/v1/vaults/$VAULT_ID/credentials" \
  -H "OpenAI-Beta: agents=v1" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "GitHub access token",
    "auth": {
      "type": "static_bearer",
      "mcp_server_url": "https://mcp.example.com",
      "token": "YOUR_SERVER_TOKEN"
    },
    "source": { "type": "openai_managed" }
  }'
```

Returns `201 Created` with credential metadata. Secret values are write-only and never appear in create, retrieve, list, or rotate responses.

Rotate an existing bearer token with `POST /v1/vaults/{vault_id}/credentials/{credential_id}` and `{ "auth": { "type": "static_bearer", "token": "NEW_TOKEN" } }`.

For an existing OAuth grant, use the `mcp_oauth` credential type:

```json
{
  "display_name": "Example MCP OAuth credential",
  "auth": {
    "type": "mcp_oauth",
    "mcp_server_url": "https://mcp.example.com",
    "access_token": "YOUR_ACCESS_TOKEN",
    "expires_at": "2099-12-31T23:59:59Z",
    "refresh": {
      "token_endpoint": "https://auth.example.com/oauth/token",
      "client_id": "YOUR_CLIENT_ID",
      "refresh_token": "YOUR_REFRESH_TOKEN",
      "token_endpoint_auth": { "type": "none" }
    }
  },
  "source": { "type": "openai_managed" }
}
```

`expires_at` is an optional access-token expiration timestamp. `refresh` is optional. When present, it requires `token_endpoint`, `client_id`, `refresh_token`, and `token_endpoint_auth`. Token endpoint authentication supports `none`, `client_secret_basic`, and `client_secret_post`. Your application handles provider authorization and consent; the Agents API stores and refreshes the supplied grant. Tokens and client secrets are write-only.

Attach the vault when creating a session:

```json
{
  "agent": {
    "model": "gpt-5.6",
    "tools": [
      {
        "type": "mcp",
        "server_label": "github",
        "transport": {
          "type": "http",
          "server_url": "https://mcp.example.com"
        }
      }
    ]
  },
  "environment": { "type": "none" },
  "input": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "List the repositories available through the connected tools."
        }
      ]
    }
  ],
  "vault_ids": ["vault_..."]
}
```

Vault and credential listings accept `cursor`, `limit`, and `include_archived`. Archived resources are omitted unless `include_archived=true`.

## Webhooks

Subscribe to lifecycle changes through project webhook settings:

| Webhook event | Meaning |
| --- | --- |
| `agent.session.created` | A session was created. |
| `agent.session.action_required` | A function result or environment connection is required. |
| `agent.session.in_progress` | A session started processing work. |
| `agent.session.idle` | A session is idle and ready for more input. |
| `agent.session.failed` | A session failed. |

Webhook deliveries are separate from the live session event stream. Verify their signatures, handle retries idempotently, and use them to coordinate sandbox lifecycle or background work.

`agent.session.idle` is not a turn-success signal; inspect the turn’s status and tool results. `agent.session.failed` reports session failure, not every turn failure. Session deletion does not emit a deletion webhook.

For self-hosted sessions, `agent.session.created` includes the environment ID and `connect.remote_url`. Sessions without an environment omit the environment ID and connection details.

`agent.session.action_required` includes `data.id` and `data.required_action.type` (`function_call` or `environment_connection`). Retrieve the session’s `required_actions` for the full details. When initial or follow-up input needs a disconnected self-hosted executor, the connection action and webhook are emitted before the existing five-minute connection wait. If the executor connects before the wait expires, the API clears the requirement and continues the waiting submission. See [environment connection events](./20-webhooks.md#environment-connection-events).

## Executor setup

The executor connects a self-hosted sandbox to its assigned session environment. Create a separate restricted `OPENAI_EXECUTOR_API_KEY` for the same organization, project, and user or service account that owns the session. Select **List models → Read**, set every other permission to **None**, and keep the broader application key outside the sandbox. Install the Codex CLI in the sandbox and run one executor per environment:

```bash
npm install -g @openai/codex@alpha

CODEX_API_KEY="$OPENAI_EXECUTOR_API_KEY" \
codex exec-server \
  --remote https://api.openai.com/v1/agents/api \
  --environment-id "$ENVIRONMENT_ID"
```

Allow outbound TCP port `443` to `api.openai.com` and `codex-cloud-environments.chatgpt.com`. Firewalls and proxies must allow secure WebSocket upgrades and long-lived outbound connections; no inbound port is required.

Agent-generated commands can read the executor key from their environment. Keep executor credentials out of container images, workspaces, logs, and tool output, and rotate or revoke them when needed.

## Errors

| Status | Meaning |
| --- | --- |
| `400` | Invalid request, unsupported field, malformed event, or invalid session state. |
| `401` | Missing authentication or project context. |
| `403` | The project credential lacks permission for the requested operation. |
| `404` | The session, vault, credential, or requested resource was not found. |
| `409` | The request conflicts with the current session, vault, or requested operation. |
| `500` | An internal service error occurred. |
| `503` | The service is temporarily unavailable. |

Access-denied alpha requests can also appear as `404`. Treat executor connection failures and environment failures as distinct from ordinary session completion.
