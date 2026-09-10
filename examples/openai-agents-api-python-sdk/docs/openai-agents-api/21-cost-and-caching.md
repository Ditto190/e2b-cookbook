---
title: "Cost and caching"
slug: cost-and-caching
order: 21
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/cost-and-caching
---

# Cost and caching

An agent may make several model calls while completing a task. Those calls use the same token pricing and prompt-caching behavior as the Responses API.

## What contributes to cost?

Each model call can consume:

- **Input tokens:** agent instructions, tool definitions, conversation history, user input, files or images, and tool results.
- **Cached input tokens:** previously processed input that can be reused at a discounted rate.
- **Output tokens:** generated text, tool-call arguments, and reasoning.

Reasoning tokens are billed as output tokens.

Subagents can also make model calls. Because session, turn, and event usage totals include root-agent usage only, `total_tokens` is not a complete model-token count when subagents run.

## How does caching work?

Agents carry context forward within a session. When successive model calls share the same prompt prefix, previously processed input may be reused through prompt caching. Caching is automatic for eligible requests, but maintaining a session does not guarantee a cache hit.

## Understand token usage

Session, turn, and event usage fields report root-agent usage only; they do not include tokens used by subagents:

```json
{
  "input_tokens": 5000,
  "input_tokens_details": {
    "cached_tokens": 1500
  },
  "output_tokens": 900,
  "output_tokens_details": {
    "reasoning_tokens": 200
  },
  "total_tokens": 5900
}
```

In this example, the agent processed 5,000 input tokens and generated 900 output tokens. Of the input tokens, 1,500 were cached. Of the output tokens, 200 were reasoning tokens.

Cached tokens are included in `input_tokens`, and reasoning tokens are included in `output_tokens`.

## Inspect subagent token usage

Per-subagent token usage is not available from session, turn, or event usage fields. To inspect it, [export completed-turn traces](./22-observability.md#export-completed-turn-traces) to an OpenTelemetry collector.

For a subagent span, `openai.managed_agents.subagent.id` identifies the subagent. When a completed-turn trace is exported and usage is available, the span can include:

- `gen_ai.usage.input_tokens`: input tokens.
- `gen_ai.usage.cache_read.input_tokens`: cached input tokens.
- `gen_ai.usage.output_tokens`: output tokens.
- `gen_ai.usage.reasoning.output_tokens`: reasoning output tokens.

Token-usage attributes are optional. Do not assume every exported agent span includes token usage.
