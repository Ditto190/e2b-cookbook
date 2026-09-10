---
title: "Cloudflare Guide"
slug: cloudflare
order: 26
source: https://preview-docs-git-agents-alpha-openai.vercel.app/alphas/agents-api/cloudflare
---

# Cloudflare Guide

Run an Agents API session with a Cloudflare Sandbox.

OpenAI maintains the session. Your application calls a Cloudflare helper to start the sandbox with the session’s environment ID.

See [Quickstart](./02-quickstart.md) for the general executor lifecycle.

Choose a provisioning mode:

- **[Application-managed](#before-you-begin):** Follow this guide to start and stop sandboxes from your application.
- **[Webhook-managed](https://github.com/OpenAI-Early-Access/agents-api-python-preview/tree/main/examples/self_hosted_sandbox/webhook_managed/cloudflare):** Deploy a handler that starts or reconnects sandboxes from OpenAI webhooks.

See [Manage Sandbox Lifecycle](./05-manage-sandbox-lifecycle.md) to compare the two modes.

## Before you begin

Use a Cloudflare Workers account with Node.js and Docker ready.

Store `OPENAI_API_KEY` and a separate restricted `OPENAI_EXECUTOR_API_KEY` as Worker secrets. Grant the application key **Responses (/v1/responses) → Write**, which includes `api.responses.write`, for model inference and session operations. When available, add **Managed Agents → Write** when managing vaults. Grant the executor key **List models → Read**, set every other permission to **None**, and use the same organization, project, and user or service account for both keys. Only the restricted executor key enters the sandbox.

**Install dependencies**

```bash
npm create cloudflare@latest
cd agents-api-cloudflare-guide
npm install @cloudflare/sandbox@0.12.1
```

## 1\. Set up the sandbox image

Replace `Dockerfile` with:

```docker
FROM docker.io/cloudflare/sandbox:0.12.1

RUN apt-get update \\
    && apt-get install --yes --no-install-recommends ripgrep \\
    && npm install -g @openai/codex@alpha \\
    && rm -rf /var/lib/apt/lists/*
```

The npm package and Docker image use the same version because Cloudflare checks them at startup.

## 2\. Set up Cloudflare

Save this as `src/cloudflare_setup.ts`. It only starts the sandbox.

```typescript
import { getSandbox, type Sandbox as SandboxType } from "@cloudflare/sandbox";

export type CloudflareEnv = {
  Sandbox: DurableObjectNamespace<SandboxType>;
  OPENAI_API_KEY: string;
  OPENAI_EXECUTOR_API_KEY: string;
};

export async function startSandbox(
  env: CloudflareEnv,
  environmentId: string,
  ownSandbox: (sandbox: ReturnType<typeof getSandbox>) => void,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const sandboxName = `agents-api-${environmentId.slice(-12).toLowerCase()}`;
  const sandbox = getSandbox(env.Sandbox, sandboxName, {
    enableDefaultSession: false,
    keepAlive: true,
  });
  ownSandbox(sandbox);

  signal.throwIfAborted();
  await sandbox.writeFile(
    "/workspace/brief.txt",
    "Migrate a synchronous Python service to an async API while preserving behavior.\n"
  );

  signal.throwIfAborted();
  await sandbox.startProcess(
    `codex exec-server --remote https://api.openai.com/v1/agents/api --environment-id ${environmentId}`,
    {
      cwd: "/workspace",
      env: { CODEX_API_KEY: env.OPENAI_EXECUTOR_API_KEY },
    }
  );

  signal.throwIfAborted();
  return sandbox;
}
```

Leave the generated `Sandbox` export in the Worker entry point. Store the application and restricted executor keys as separate Worker secrets.

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put OPENAI_EXECUTOR_API_KEY
npx wrangler deploy
```

## 3\. Run the session

In the application code that owns the session, import the Cloudflare helper and pass it the environment ID.

**View the complete session helper**

```typescript
import { startSandbox, type CloudflareEnv } from "./cloudflare_setup";

const AGENTS_API_URL = "https://api.openai.com/v1/agents";
const CONNECTION_TIMEOUT_MS = 30_000;
const PROGRESS_TIMEOUT_MS = 60_000;
const OVERALL_TIMEOUT_MS = 5 * 60_000;
const CLEANUP_RESERVE_MS = 30_000;

type Session = {
  id: string;
  status: "idle" | "in_progress" | "requires_action" | "failed";
  environment: { id: string };
};

type SessionEvent = {
  type: string;
  delta?: string;
  text?: string;
  error?: { message?: string };
  environment?: { error?: { message?: string } | null };
  session?: { error?: string | null };
};

async function agentsRequest<T>(
  path: string,
  apiKey: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("OpenAI-Beta", "agents=v1");
  headers.set("Content-Type", "application/json");

  const response = await fetch(`${AGENTS_API_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new Error(`Agents API ${response.status}: ${await response.text()}`);
  }

  const body = await response.text();
  return (body ? JSON.parse(body) : undefined) as T;
}

async function openEventStream(
  sessionId: string,
  apiKey: string,
  signal: AbortSignal
): Promise<AsyncGenerator<SessionEvent>> {
  const response = await fetch(
    `${AGENTS_API_URL}/sessions/${sessionId}/events?stream=true`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "agents=v1",
        Accept: "text/event-stream",
      },
      signal,
    }
  );

  if (!response.ok || !response.body) {
    throw new Error(`Agents API ${response.status}: ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  return (async function* () {
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");

        if (data) yield JSON.parse(data) as SessionEvent;
      }
    }
  })();
}

async function awaitAbortable<T>(
  operation: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  signal.throwIfAborted();

  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

async function boundedCleanup<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  const controller = new AbortController();
  const deadline = setTimeout(
    () => {
      controller.abort(new Error(message));
    },
    Math.max(0, timeoutMs)
  );

  try {
    return await awaitAbortable(
      operation(controller.signal),
      controller.signal
    );
  } finally {
    clearTimeout(deadline);
  }
}

function eventFailure(event: SessionEvent): Error {
  return new Error(
    event.error?.message ??
      event.environment?.error?.message ??
      event.session?.error ??
      event.type
  );
}

function isTerminalFailure(event: SessionEvent): boolean {
  return (
    event.type === "session.environment.failed" ||
    event.type === "session.turn.failed" ||
    event.type === "session.turn.cancelled" ||
    event.type === "session.failed"
  );
}

export async function runSession(prompt: string, env: CloudflareEnv) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const overallDeadline = setTimeout(() => {
    controller.abort(
      new Error("The agent session exceeded its overall timeout.")
    );
  }, OVERALL_TIMEOUT_MS - CLEANUP_RESERVE_MS);
  let progressDeadline: ReturnType<typeof setTimeout> | undefined;
  let sandbox: Awaited<ReturnType<typeof startSandbox>> | undefined;
  let session: Session | undefined;
  let failure: unknown;
  const remainingCleanup = () =>
    Math.max(0, startedAt + OVERALL_TIMEOUT_MS - Date.now());

  const expectProgress = (timeoutMs: number, message: string) => {
    clearTimeout(progressDeadline);
    progressDeadline = setTimeout(() => {
      controller.abort(new Error(message));
    }, timeoutMs);
  };

  try {
    session = await agentsRequest<Session>("/sessions", env.OPENAI_API_KEY, {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({
        agent: {
          model: "gpt-5.6-sol",
          instructions: "Work from files in /workspace and answer concisely.",
        },
        environment: {
          type: "self_hosted",
          workspace_directory: "/workspace",
        },
      }),
    });

    expectProgress(
      CONNECTION_TIMEOUT_MS,
      "The sandbox executor did not connect in time."
    );
    const events = await openEventStream(
      session.id,
      env.OPENAI_API_KEY,
      controller.signal
    );
    controller.signal.throwIfAborted();
    const startingSandbox = startSandbox(
      env,
      session.environment.id,
      (candidate) => {
        sandbox = candidate;
      },
      controller.signal
    );
    await awaitAbortable(startingSandbox, controller.signal);

    while (true) {
      const { done, value: event } = await events.next();
      if (done) {
        throw new Error("Event stream closed before the executor connected.");
      }
      if (isTerminalFailure(event)) throw eventFailure(event);
      if (event.type === "session.environment.connected") break;
    }

    expectProgress(
      PROGRESS_TIMEOUT_MS,
      "The agent turn stopped making progress."
    );
    await agentsRequest<void>(
      `/sessions/${session.id}/events`,
      env.OPENAI_API_KEY,
      {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          events: [
            {
              type: "session.input.message",
              input: [
                {
                  role: "user",
                  content: [{ type: "input_text", text: prompt }],
                },
              ],
            },
          ],
        }),
      }
    );

    let output = "";

    for await (const event of events) {
      expectProgress(
        PROGRESS_TIMEOUT_MS,
        "The agent turn stopped making progress."
      );
      if (isTerminalFailure(event)) throw eventFailure(event);

      if (event.type === "session.turn.output_text.delta") {
        output += event.delta ?? "";
      }

      if (event.type === "session.turn.output_text.done" && !output) {
        output = event.text ?? "";
      }

      if (event.type === "session.turn.completed") {
        if (!output.trim()) {
          throw new Error("The agent turn completed without producing text.");
        }
        return output;
      }
    }

    throw new Error("Event stream closed before the turn completed.");
  } catch (error) {
    failure = controller.signal.aborted ? controller.signal.reason : error;
    throw failure;
  } finally {
    clearTimeout(overallDeadline);
    clearTimeout(progressDeadline);
    controller.abort();
    const cleanupErrors: unknown[] = [];
    if (sandbox) {
      try {
        await boundedCleanup(
          () => sandbox.destroy(),
          Math.min(CLEANUP_RESERVE_MS / 2, remainingCleanup() / 2),
          "Sandbox cleanup exceeded the overall session deadline."
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (session) {
      try {
        await boundedCleanup(
          (signal) =>
            agentsRequest<void>(`/sessions/${session.id}`, env.OPENAI_API_KEY, {
              method: "DELETE",
              signal,
            }),
          Math.min(CLEANUP_RESERVE_MS, remainingCleanup()),
          "Session deletion exceeded the overall session deadline."
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length) {
      const cleanupMessage = cleanupErrors
        .map((error) =>
          error instanceof Error ? error.message : String(error)
        )
        .join("; ");
      if (failure !== undefined) {
        const primaryMessage =
          failure instanceof Error ? failure.message : String(failure);
        throw new AggregateError(
          [failure, ...cleanupErrors],
          `Agent session failed: ${primaryMessage}; cleanup also failed: ${cleanupMessage}`,
          { cause: failure }
        );
      }
      if (cleanupErrors.length === 1) throw cleanupErrors[0];
      throw new AggregateError(
        cleanupErrors,
        `Session cleanup failed: ${cleanupMessage}`
      );
    }
  }
}
```

Call `runSession()` from the application path that already handles Agents API sessions.

## References

- [Cloudflare Sandbox documentation](https://developers.cloudflare.com/sandbox/)
- [Cloudflare Sandbox TypeScript SDK reference](https://developers.cloudflare.com/sandbox/api/)
