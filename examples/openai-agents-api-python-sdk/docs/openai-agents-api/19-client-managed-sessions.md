---
title: "Session continuity"
slug: client-managed-sessions
order: 19
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/client-managed-sessions
---

# Session continuity

A session preserves an agent’s work across turns. Keep its session ID so your application can retrieve the session, send more input, and inspect its items.

Use the existing session ID to continue work instead of creating a second session. Subscribe to live events before submitting new input to avoid missing a fast response.

For supported session operations, see [Manage sessions](./17-managing-sessions.md). For event streams and completed output, see [Events and items](./18-session-events-and-items.md).
