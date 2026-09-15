import { CommandExitError, Sandbox } from "e2b";
import { TAILCAT_URL, TEMPLATE_ALIAS } from "../template/template";

const INSTALL_TAILCAT_CMD =
  `curl -fsSL -o /tmp/tailcat.tgz ${TAILCAT_URL} && mkdir -p /tmp/tc && tar xzf /tmp/tailcat.tgz -C /tmp/tc` +
  " && sudo install -m 0755 $(find /tmp/tc -type f -name tailcat) /usr/local/bin/tailcat && rm -rf /tmp/tc /tmp/tailcat.tgz";

export interface CommandResult {
  exitCode: number;
  output: string;
}

export type CommandRunner = (command: string) => Promise<CommandResult>;

/** Create a sandbox from the Tailcat template, with a runtime-install fallback. */
export async function createSandbox(timeoutMs = 600_000): Promise<Sandbox> {
  const startedAt = Date.now();
  let sandbox: Sandbox;

  try {
    sandbox = await Sandbox.create(TEMPLATE_ALIAS, { timeoutMs });
  } catch (error) {
    if (!String(error).includes("404")) {
      throw error;
    }

    sandbox = await Sandbox.create({ timeoutMs });
    await sandbox.commands.run(INSTALL_TAILCAT_CMD, { timeoutMs: 120_000 });
    console.log(
      `[${sandbox.sandboxId}] template '${TEMPLATE_ALIAS}' not found; installed Tailcat at runtime`,
    );
  }

  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  console.log(
    `[${sandbox.sandboxId}] sandbox ready in ${elapsedSeconds.toFixed(1)}s`,
  );
  return sandbox;
}

/** Run a sandbox command and preserve non-zero exit details for assertions. */
export async function runSandboxCommand(
  sandbox: Sandbox,
  command: string,
  timeoutMs = 60_000,
): Promise<CommandResult> {
  try {
    const result = await sandbox.commands.run(command, { timeoutMs });
    return { exitCode: result.exitCode, output: result.stdout + result.stderr };
  } catch (error) {
    if (error instanceof CommandExitError) {
      return { exitCode: error.exitCode, output: error.stdout + error.stderr };
    }
    throw error;
  }
}

export function sandboxCommandRunner(
  sandbox: Sandbox,
  timeoutMs = 120_000,
): CommandRunner {
  return (command) => runSandboxCommand(sandbox, command, timeoutMs);
}

export function assertCommandSucceeded(result: CommandResult): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `command failed (exit ${result.exitCode}):\n${result.output}`,
    );
  }
}
