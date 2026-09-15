/**
 * Code running inside an E2B sandbox tests a development server on your laptop.
 *
 * Sandboxes have no inbound route to your machine. With Tailcat the laptop runs a
 * listener in front of a local port, and the sandbox connects out to it. The
 * listener only admits the sandbox's own client key (`--allow`), so nothing else
 * that learns the address can reach your laptop.
 *
 * Two ways to consume it inside the sandbox:
 *   1. `tailcat socks <address> <cmd>` runs <cmd> with an all_proxy SOCKS5 proxy (curl, pip, git, ...).
 *   2. socat turns the Tailcat pipe into a plain local port for tools that do not speak SOCKS (psql, redis-cli, ...).
 */
import "dotenv/config";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  type CommandResult,
  type CommandRunner,
  assertCommandSucceeded,
  createSandbox,
  sandboxCommandRunner,
} from "./e2bSandbox";
import { startLocalTailcatServer, waitUntilReachable } from "./tailcatServer";

const LOCAL_PORT = Number(process.env.DEMO_LOCAL_PORT ?? 8765);

// A tiny stand-in for the development server the user is already running locally.
function handleLocalHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  response.setHeader("content-type", "application/json");
  switch (request.url) {
    case "/health":
      response.end('{"status":"ok"}');
      return;
    case "/api/project":
      response.end('{"name":"tailcat-demo","environment":"local"}');
      return;
    case "/api/check":
      response.end('{"accepted":true}');
      return;
    default:
      response.statusCode = 404;
      response.end('{"error":"not found"}');
  }
}

function reportSuccessfulCheck(
  label: string,
  result: CommandResult,
  expectedResponse: string,
): void {
  assertCommandSucceeded(result);
  if (result.output.trim() !== expectedResponse) {
    throw new Error(`${label}: unexpected response ${result.output.trim()}`);
  }
  console.log(`✓ ${label}`);
}

async function testThroughSocks(
  runInSandbox: CommandRunner,
  laptopAddress: string,
): Promise<void> {
  const healthCheck = await runInSandbox(
    `tailcat socks ${laptopAddress} curl -fsS http://server.tailcat:${LOCAL_PORT}/health`,
  );
  reportSuccessfulCheck(
    "GET /health returned the local server status",
    healthCheck,
    '{"status":"ok"}',
  );

  const projectCheck = await runInSandbox(
    `tailcat socks ${laptopAddress} curl -fsS http://server.tailcat:${LOCAL_PORT}/api/project`,
  );
  reportSuccessfulCheck(
    "GET /api/project returned the local project",
    projectCheck,
    '{"name":"tailcat-demo","environment":"local"}',
  );
}

async function testThroughLocalPort(
  runInSandbox: CommandRunner,
  laptopAddress: string,
): Promise<void> {
  await runInSandbox(
    `socat TCP-LISTEN:${LOCAL_PORT},fork,reuseaddr,bind=127.0.0.1 EXEC:'tailcat ${laptopAddress} ${LOCAL_PORT}' >/tmp/socat.log 2>&1 &`,
  );
  const apiCheck = await runInSandbox(
    `sleep 1; curl -fsS --retry 5 --retry-connrefused http://127.0.0.1:${LOCAL_PORT}/api/check`,
  );
  reportSuccessfulCheck(
    "GET /api/check worked through a sandbox-local port",
    apiCheck,
    '{"accepted":true}',
  );
}

async function verifyOtherIdentitiesAreRejected(
  runInSandbox: CommandRunner,
  laptopAddress: string,
): Promise<void> {
  const foreignKeyPing = await runInSandbox(
    `tailcat --key=new ping --timeout 5s ${laptopAddress}`,
  );
  if (foreignKeyPing.exitCode === 0) {
    throw new Error("a different Tailcat identity was unexpectedly allowed");
  }
  console.log("✓ A different Tailcat identity was rejected");
}

const localHttpServer = createServer(handleLocalHttpRequest);
const listening = once(localHttpServer, "listening");
localHttpServer.listen(LOCAL_PORT, "127.0.0.1");
await listening;
console.log(
  `[laptop] local development server listening on http://127.0.0.1:${LOCAL_PORT}`,
);

const sandbox = await createSandbox();
try {
  const runInSandbox = sandboxCommandRunner(sandbox, 120_000);

  // The sandbox gets its own identity; the laptop only admits that key.
  const keyGeneration = await runInSandbox(
    "tailcat genkey --client --key=client-default 2>/dev/null | grep -o 'nodekey:[0-9a-f]*'",
  );
  assertCommandSucceeded(keyGeneration);
  const sandboxClientPublicKey = keyGeneration.output.trim();
  console.log(`[sandbox] client key ${sandboxClientPublicKey.slice(0, 24)}…`);

  const laptopTailcatServer = await startLocalTailcatServer(
    `serve --allow=${sandboxClientPublicKey} ${LOCAL_PORT}`,
  );
  try {
    const connection = await waitUntilReachable(
      runInSandbox,
      laptopTailcatServer.address,
    );
    console.log(`[sandbox] ${connection}`);
    console.log("\nTesting the development server on your laptop...\n");

    await testThroughSocks(runInSandbox, laptopTailcatServer.address);
    await testThroughLocalPort(runInSandbox, laptopTailcatServer.address);
    await verifyOtherIdentitiesAreRejected(
      runInSandbox,
      laptopTailcatServer.address,
    );
    console.log("\n4 checks passed");
  } finally {
    await laptopTailcatServer.stop();
  }
} finally {
  await sandbox.kill();
  localHttpServer.close();
}
