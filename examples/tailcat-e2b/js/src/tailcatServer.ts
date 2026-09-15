import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { CommandHandle, Sandbox } from "e2b";
import { type CommandRunner, runSandboxCommand } from "./e2bSandbox";

const TAILCAT_ADDRESS_PATTERN = /\btc[A-Za-z0-9_-]{20,}/;

export interface TailcatServer {
  address: string;
  stop(): Promise<void> | void;
}

export interface SandboxTailcatServer extends TailcatServer {
  /** Wait for a one-shot listener (bare `tailcat`) to exit and return what it wrote to stdout. */
  wait(): Promise<string>;
}

/** Start a Tailcat listener inside a sandbox and read its generated address. */
export async function startSandboxTailcatServer(
  sandbox: Sandbox,
  tailcatArguments: string,
  instanceName = "tailcat",
  waitMs = 20_000,
): Promise<SandboxTailcatServer> {
  const addressFile = `/tmp/${instanceName}.addr`;
  const logFile = `/tmp/${instanceName}.log`;
  const serverProcess: CommandHandle = await sandbox.commands.run(
    // exec: the SDK kills the wrapping shell by pid, so tailcat must be that process.
    `rm -f ${addressFile}; TAILCAT_ADDR_FILE=${addressFile} exec tailcat ${tailcatArguments} 2> ${logFile}`,
    { background: true },
  );

  async function readAddressFile(): Promise<string> {
    return (await runSandboxCommand(sandbox, `cat ${addressFile} 2>/dev/null`))
      .output;
  }

  async function readServerLog(): Promise<string> {
    return (await runSandboxCommand(sandbox, `cat ${logFile}`)).output;
  }

  let address: string;
  try {
    address = await waitForTailcatAddress(
      readAddressFile,
      waitMs,
      readServerLog,
    );
  } catch (error) {
    await serverProcess.kill();
    throw error;
  }
  console.log(
    `[${sandbox.sandboxId}] tailcat ${tailcatArguments}  ->  ${abbreviate(
      address,
    )}`,
  );

  return {
    address,
    async stop(): Promise<void> {
      await serverProcess.kill();
    },
    async wait(): Promise<string> {
      return (await serverProcess.wait()).stdout;
    },
  };
}

/** Start a Tailcat listener on the laptop and read its generated address. */
export async function startLocalTailcatServer(
  tailcatArguments: string,
  waitMs = 20_000,
): Promise<TailcatServer> {
  requireLocalTailcat();
  const addressFile = join(
    tmpdir(),
    `tailcat-${process.pid}-${Date.now()}.addr`,
  );
  const serverProcess: ChildProcess = spawn(
    "tailcat",
    tailcatArguments.split(/\s+/).filter(Boolean),
    {
      env: { ...process.env, TAILCAT_ADDR_FILE: addressFile },
      stdio: "ignore",
    },
  );

  function readAddressFile(): Promise<string> {
    return Promise.resolve(
      existsSync(addressFile) ? readFileSync(addressFile, "utf8") : "",
    );
  }

  let address: string;
  try {
    address = await waitForTailcatAddress(readAddressFile, waitMs);
  } catch (error) {
    serverProcess.kill();
    throw error;
  }
  console.log(
    `[laptop] tailcat ${tailcatArguments}  ->  ${abbreviate(address)}`,
  );

  return {
    address,
    stop(): void {
      serverProcess.kill();
      if (existsSync(addressFile)) {
        unlinkSync(addressFile);
      }
    },
  };
}

/**
 * Retry Tailcat ping until the listener has joined DERP, then report its path.
 * Each attempt lets tailcat resend its rendezvous ping for up to 10 s; the loop
 * covers a relay that admits the listener later than that.
 */
export async function waitUntilReachable(
  runCommand: CommandRunner,
  address: string,
  timeoutMs = 60_000,
): Promise<string> {
  const startedAt = Date.now();
  let lastOutput = "";
  while (Date.now() - startedAt < timeoutMs) {
    const ping = await runCommand(`tailcat ping --timeout 10s ${address}`);
    if (ping.exitCode === 0) {
      const pongLine = ping.output
        .split("\n")
        .find((line) => line.includes("pong in"));
      return pongLine?.includes("DERP")
        ? `DERP relay: ${pongLine.split("pong in ")[1] ?? pongLine.trim()}`
        : `Tailcat connection: ${pongLine?.trim() ?? "ready"}`;
    }
    lastOutput = ping.output;
    await delay(1000);
  }
  throw new Error(
    `tailcat server ${abbreviate(address)} not reachable after ${
      timeoutMs / 1000
    }s:\n${lastOutput}`,
  );
}

export function requireLocalTailcat(): void {
  if (spawnSync("tailcat", ["version"], { stdio: "ignore" }).status !== 0) {
    throw new Error(
      "tailcat is not installed; run `brew install tailcat` or see https://github.com/tailscale/tailcat#install",
    );
  }
}

async function waitForTailcatAddress(
  readAddressFile: () => Promise<string>,
  waitMs: number,
  readServerLog?: () => Promise<string>,
): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < waitMs) {
    const addressMatch = TAILCAT_ADDRESS_PATTERN.exec(await readAddressFile());
    if (addressMatch) {
      return addressMatch[0];
    }
    await delay(300);
  }
  const serverLog = readServerLog ? `\n${await readServerLog()}` : "";
  throw new Error(
    `tailcat did not print an address within ${waitMs / 1000}s${serverLog}`,
  );
}

function abbreviate(address: string): string {
  return `${address.slice(0, 20)}…`;
}
