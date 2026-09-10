---
title: "Plugins"
slug: plugins
order: 14
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/plugins
---

# Plugins

Plugins package skills and tools into reusable capabilities that agents discover through the sandbox filesystem.

For example, an incident-response plugin could include:

- A skill for investigating and triaging incidents.
- An MCP server for retrieving alerts, logs, and incident details.
- Incident playbooks and scripts.

To make a plugin available to an agent:

1.  Create a plugin containing skills, MCP servers, or both.
2.  Register the plugin directory in `environment.capability_directories`.

## 1\. Create a plugin

A plugin contains a manifest and its skills or MCP servers.

For example, an engineering plugin could include a weekly update skill and GitHub and Slack MCP servers:

```text
/workspace/plugins/engineering/
├── .codex-plugin/
│   └── plugin.json
├── skills/
│   └── weekly-update/
│       └── SKILL.md
└── .mcp.json
```

The plugin manifest identifies the plugin and specifies where to find its skills and MCP configuration:

```json
{
  "name": "engineering",
  "version": "1.0.0",
  "description": "Tools and workflows for engineering teams.",
  "skills": "./skills/",
  "mcpServers": "./.mcp.json"
}
```

The `.mcp.json` file configures two MCP servers: GitHub over HTTP and Slack over stdio.

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "bearer_token_env_var": "GITHUB_PERSONAL_ACCESS_TOKEN"
    },
    "slack": {
      "command": "npx",
      "args": ["-y", "slack-mcp-server@1.3.0", "--transport", "stdio"],
      "env_vars": ["SLACK_MCP_XOXB_TOKEN"]
    }
  }
}
```

`bearer_token_env_var` sets only `Authorization`. Remote plugin MCPs do not support `env_http_headers`; `http_headers` accepts literal values.

For additional guidance on structuring manifests, skills, MCP servers, and supporting files, see [Skills](./13-skills.md), [Plugin architecture](https://developers.openai.com/plugins/concepts/plugins) and [Package your plugin](https://developers.openai.com/plugins/build/plugins).

## 2\. Add the plugin to your sandbox

Copy or mount the plugin into your sandbox, then register its location in `environment.capability_directories`:

```json
{
  "agent": {
    "model": "gpt-5.6"
  },
  "environment": {
    "type": "self_hosted",
    "workspace_directory": "/workspace",
    "capability_directories": ["/workspace/plugins/engineering"]
  }
}
```

**SDK**



**Python**

```python
session = await client.sessions.create(
    agent={"model": "gpt-5.6"},
    environment={
        "type": "self_hosted",
        "workspace_directory": "/workspace",
        "capability_directories": [
            "/workspace/capabilities/legal",
            "/workspace/plugins/engineering",
        ],
    },
)
```

**TypeScript**

```typescript
const session = await client.beta.agents.sessions.create({
  agent: { model: "gpt-5.6" },
  environment: {
    type: "self_hosted",
    workspace_directory: "/workspace",
    capability_directories: [
      "/workspace/capabilities/legal",
      "/workspace/plugins/engineering",
    ],
  },
});
```

Ensure required dependencies, environment variables, and credentials are available in the sandbox.
