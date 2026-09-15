/**
 * Transfer a large file in both directions and verify every copy.
 *
 * Upload:   the sandbox runs `tailcat recv` (a write-only drop box), the laptop runs `tailcat cp`.
 * Download: the sandbox runs `tailcat serve files` (read-only), the laptop runs `tailcat ls` and `tailcat cp`.
 * Bytes flow over WireGuard through a DERP relay and never touch the E2B API.
 */
import "dotenv/config";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox } from "e2b";
import type { CommandResult } from "./e2bSandbox";
import {
  assertCommandSucceeded,
  createSandbox,
  runSandboxCommand,
} from "./e2bSandbox";
import {
  requireLocalTailcat,
  startSandboxTailcatServer,
  waitUntilReachable,
} from "./tailcatServer";

const FILE_SIZE_MIB = Number(process.env.DEMO_FILE_SIZE_MIB ?? 10);
const FILE_SIZE_BYTES = FILE_SIZE_MIB * 1024 * 1024;

// A stalled relay transfer would otherwise hang scp forever, past the sandbox timeout.
const LOCAL_TAILCAT_TIMEOUT_MS = 300_000;

function runLocalTailcat(...tailcatArguments: string[]): void {
  try {
    execFileSync("tailcat", tailcatArguments, {
      stdio: "inherit",
      timeout: LOCAL_TAILCAT_TIMEOUT_MS,
    });
  } catch (error) {
    // Do not rethrow the original error: Node prints the full argv, and the
    // tailcat address in it is a bearer credential.
    const { status, code } = error as { status?: number | null; code?: string };
    // eslint-disable-next-line preserve-caught-error -- the cause would print that argv again
    throw new Error(
      `tailcat ${tailcatArguments[0] ?? ""} failed (${code ?? `exit ${status ?? "?"}`}). ` +
        "Transfers through the public DERP relay can stall; retry or lower DEMO_FILE_SIZE_MIB.",
    );
  }
}

function runLocalCommand(command: string): Promise<CommandResult> {
  const result = spawnSync(command, { shell: true, encoding: "utf8" });
  return Promise.resolve({
    exitCode: result.status ?? 1,
    output: (result.stdout ?? "") + (result.stderr ?? ""),
  });
}

function computeLocalMd5(path: string): string {
  return createHash("md5").update(readFileSync(path)).digest("hex");
}

async function computeSandboxMd5(
  sandbox: Sandbox,
  path: string,
): Promise<string> {
  const result = await runSandboxCommand(sandbox, `md5sum ${path}`);
  assertCommandSucceeded(result);
  return result.output.trim().split(/\s+/)[0] ?? "";
}

function transferSpeed(bytes: number, seconds: number): string {
  return `${Math.round((bytes * 8) / seconds / 1e6)} Mbit/s`;
}

async function uploadToSandbox(
  sandbox: Sandbox,
  localFile: string,
  localInputMd5: string,
): Promise<void> {
  await sandbox.commands.run("mkdir -p /home/user/inbox");
  const uploadReceiver = await startSandboxTailcatServer(
    sandbox,
    // --accept-dirs keeps the uploaded name; the default flat drop box stores
    // each upload under a server-chosen name (tailcat 0.5+).
    "recv --accept-dirs /home/user/inbox",
    "recv",
  );
  try {
    const connection = await waitUntilReachable(
      runLocalCommand,
      uploadReceiver.address,
    );
    console.log(`[laptop] ${connection}`);

    const startedAt = Date.now();
    runLocalTailcat("cp", localFile, `${uploadReceiver.address}:`);
    const elapsedSeconds = (Date.now() - startedAt) / 1000;

    const checksumMatches =
      (await computeSandboxMd5(sandbox, "/home/user/inbox/input.bin")) ===
      localInputMd5;
    if (!checksumMatches) {
      throw new Error(
        "the uploaded file checksum does not match the local file",
      );
    }
    console.log(
      `[laptop -> sandbox] ${FILE_SIZE_MIB} MiB in ${elapsedSeconds.toFixed(
        1,
      )}s ` + `(${transferSpeed(FILE_SIZE_BYTES, elapsedSeconds)}), md5 ok`,
    );
  } finally {
    await uploadReceiver.stop();
  }
}

async function downloadFromSandbox(
  sandbox: Sandbox,
  workingDirectory: string,
  localInputMd5: string,
): Promise<void> {
  const prepareResultsCommand = [
    "mkdir -p /home/user/results",
    "cd /home/user/results",
    `head -c ${FILE_SIZE_BYTES} /dev/urandom > output.bin`,
    "input_md5=$(md5sum /home/user/inbox/input.bin | cut -d' ' -f1)",
    "output_md5=$(md5sum output.bin | cut -d' ' -f1)",
    `printf '{"inputBytes":${FILE_SIZE_BYTES},"inputMd5":"%s","outputBytes":${FILE_SIZE_BYTES},` +
      `"outputMd5":"%s"}\\n' "$input_md5" "$output_md5" > transfer-report.json`,
  ].join(" && ");
  await sandbox.commands.run(prepareResultsCommand);
  const downloadServer = await startSandboxTailcatServer(
    sandbox,
    "serve --files=/home/user/results:ro files",
    "files",
  );
  try {
    await waitUntilReachable(runLocalCommand, downloadServer.address);

    console.log("[laptop] tailcat ls -l <sandbox>:");
    runLocalTailcat("ls", "-l", downloadServer.address);

    const startedAt = Date.now();
    runLocalTailcat(
      "cp",
      `${downloadServer.address}:output.bin`,
      workingDirectory,
    );
    const elapsedSeconds = (Date.now() - startedAt) / 1000;

    const localOutputMd5 = computeLocalMd5(
      join(workingDirectory, "output.bin"),
    );
    const sandboxOutputMd5 = await computeSandboxMd5(
      sandbox,
      "/home/user/results/output.bin",
    );
    const checksumMatches = localOutputMd5 === sandboxOutputMd5;
    if (!checksumMatches) {
      throw new Error(
        "the downloaded file checksum does not match the sandbox file",
      );
    }
    console.log(
      `[sandbox -> laptop] ${FILE_SIZE_MIB} MiB in ${elapsedSeconds.toFixed(
        1,
      )}s ` + `(${transferSpeed(FILE_SIZE_BYTES, elapsedSeconds)}), md5 ok`,
    );

    runLocalTailcat(
      "cp",
      `${downloadServer.address}:transfer-report.json`,
      workingDirectory,
    );
    const reportPath = join(workingDirectory, "transfer-report.json");
    const transferReport = readFileSync(reportPath, "utf8").trim();
    const expectedReport = JSON.stringify({
      inputBytes: FILE_SIZE_BYTES,
      inputMd5: localInputMd5,
      outputBytes: FILE_SIZE_BYTES,
      outputMd5: localOutputMd5,
    });
    if (transferReport !== expectedReport) {
      throw new Error("the transfer report does not match the copied files");
    }
    console.log(`\nTransfer report saved to ${reportPath}:\n${transferReport}`);
  } finally {
    await downloadServer.stop();
  }
}

requireLocalTailcat();
const sandbox = await createSandbox();
try {
  const workingDirectory = mkdtempSync(
    join(tmpdir(), "tailcat-laptop-sandbox-file-transfer-"),
  );
  const localFile = join(workingDirectory, "input.bin");
  writeFileSync(localFile, randomBytes(FILE_SIZE_BYTES));
  if (statSync(localFile).size !== FILE_SIZE_BYTES) {
    throw new Error("test file was not written completely");
  }
  const localInputMd5 = computeLocalMd5(localFile);

  await uploadToSandbox(sandbox, localFile, localInputMd5);
  await downloadFromSandbox(sandbox, workingDirectory, localInputMd5);
} finally {
  await sandbox.kill();
}
