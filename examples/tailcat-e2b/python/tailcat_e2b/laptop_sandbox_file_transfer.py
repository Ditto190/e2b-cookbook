"""Transfer a large file in both directions and verify every copy.

Upload:   the sandbox runs `tailcat recv` (a write-only drop box), the laptop runs `tailcat cp`.
Download: the sandbox runs `tailcat serve files` (read-only), the laptop runs `tailcat ls` and `tailcat cp`.
Bytes flow over WireGuard through a DERP relay and never touch the E2B API.
"""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time

from dotenv import load_dotenv
from e2b import Sandbox

from .e2b_sandbox import (
    CommandResult,
    assert_command_succeeded,
    create_sandbox,
    run_sandbox_command,
)
from .tailcat_server import (
    require_local_tailcat,
    start_sandbox_tailcat_server,
    wait_until_reachable,
)

FILE_SIZE_MIB = int(os.environ.get("DEMO_FILE_SIZE_MIB", "10"))
FILE_SIZE_BYTES = FILE_SIZE_MIB * 1024 * 1024


# A stalled relay transfer would otherwise hang scp forever, past the sandbox timeout.
LOCAL_TAILCAT_TIMEOUT_SECONDS = 300


def run_local_tailcat(*tailcat_arguments: str) -> None:
    try:
        subprocess.run(["tailcat", *tailcat_arguments], check=True, timeout=LOCAL_TAILCAT_TIMEOUT_SECONDS)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        # Do not re-raise the original: its message carries the full argv, and the
        # tailcat address in it is a bearer credential.
        reason = f"exit {error.returncode}" if isinstance(error, subprocess.CalledProcessError) else "timed out"
        raise RuntimeError(
            f"tailcat {tailcat_arguments[0]} failed ({reason}). "
            "Transfers through the public DERP relay can stall; retry or lower DEMO_FILE_SIZE_MIB."
        ) from None


def run_local_command(command: str) -> CommandResult:
    result = subprocess.run(command, shell=True, capture_output=True, text=True)
    return CommandResult(result.returncode, result.stdout + result.stderr)


def compute_local_md5(path: str) -> str:
    digest = hashlib.md5()
    with open(path, "rb") as file:
        while chunk := file.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def compute_sandbox_md5(sandbox: Sandbox, path: str) -> str:
    result = run_sandbox_command(sandbox, f"md5sum {path}")
    assert_command_succeeded(result)
    return result.output.split()[0]


def transfer_speed(size_bytes: int, seconds: float) -> str:
    return f"{size_bytes * 8 / seconds / 1e6:.0f} Mbit/s"


def upload_to_sandbox(sandbox: Sandbox, local_file: str, local_input_md5: str) -> None:
    sandbox.commands.run("mkdir -p /home/user/inbox")
    # --accept-dirs keeps the uploaded name; the default flat drop box stores
    # each upload under a server-chosen name (tailcat 0.5+).
    upload_receiver = start_sandbox_tailcat_server(sandbox, "recv --accept-dirs /home/user/inbox", "recv")
    try:
        connection = wait_until_reachable(run_local_command, upload_receiver.address)
        print(f"[laptop] {connection}")

        started_at = time.time()
        run_local_tailcat("cp", local_file, f"{upload_receiver.address}:")
        elapsed_seconds = time.time() - started_at

        checksum_matches = compute_sandbox_md5(sandbox, "/home/user/inbox/input.bin") == local_input_md5
        if not checksum_matches:
            raise RuntimeError("the uploaded file checksum does not match the local file")
        print(
            f"[laptop -> sandbox] {FILE_SIZE_MIB} MiB in {elapsed_seconds:.1f}s "
            f"({transfer_speed(FILE_SIZE_BYTES, elapsed_seconds)}), md5 ok"
        )
    finally:
        upload_receiver.stop()


def download_from_sandbox(sandbox: Sandbox, working_directory: str, local_input_md5: str) -> None:
    prepare_results_command = " && ".join(
        [
            "mkdir -p /home/user/results",
            "cd /home/user/results",
            f"head -c {FILE_SIZE_BYTES} /dev/urandom > output.bin",
            "input_md5=$(md5sum /home/user/inbox/input.bin | cut -d' ' -f1)",
            "output_md5=$(md5sum output.bin | cut -d' ' -f1)",
            f"printf '{{\"inputBytes\":{FILE_SIZE_BYTES},\"inputMd5\":\"%s\","
            f"\"outputBytes\":{FILE_SIZE_BYTES},\"outputMd5\":\"%s\"}}\\n' "
            '"$input_md5" "$output_md5" > transfer-report.json',
        ]
    )
    sandbox.commands.run(prepare_results_command)
    download_server = start_sandbox_tailcat_server(sandbox, "serve --files=/home/user/results:ro files", "files")
    try:
        wait_until_reachable(run_local_command, download_server.address)

        print("[laptop] tailcat ls -l <sandbox>:")
        run_local_tailcat("ls", "-l", download_server.address)

        started_at = time.time()
        run_local_tailcat("cp", f"{download_server.address}:output.bin", working_directory)
        elapsed_seconds = time.time() - started_at

        local_output_md5 = compute_local_md5(os.path.join(working_directory, "output.bin"))
        sandbox_output_md5 = compute_sandbox_md5(sandbox, "/home/user/results/output.bin")
        checksum_matches = local_output_md5 == sandbox_output_md5
        if not checksum_matches:
            raise RuntimeError("the downloaded file checksum does not match the sandbox file")
        print(
            f"[sandbox -> laptop] {FILE_SIZE_MIB} MiB in {elapsed_seconds:.1f}s "
            f"({transfer_speed(FILE_SIZE_BYTES, elapsed_seconds)}), md5 ok"
        )

        run_local_tailcat("cp", f"{download_server.address}:transfer-report.json", working_directory)
        report_path = os.path.join(working_directory, "transfer-report.json")
        with open(report_path) as report_file:
            transfer_report = json.load(report_file)
        expected_report = {
            "inputBytes": FILE_SIZE_BYTES,
            "inputMd5": local_input_md5,
            "outputBytes": FILE_SIZE_BYTES,
            "outputMd5": local_output_md5,
        }
        if transfer_report != expected_report:
            raise RuntimeError("the transfer report does not match the copied files")
        print(f"\nTransfer report saved to {report_path}:\n" + json.dumps(transfer_report, indent=2))
    finally:
        download_server.stop()


def main() -> None:
    sys.stdout.reconfigure(line_buffering=True)
    load_dotenv()
    require_local_tailcat()
    sandbox = create_sandbox()
    try:
        working_directory = tempfile.mkdtemp(prefix="tailcat-laptop-sandbox-file-transfer-")
        local_file = os.path.join(working_directory, "input.bin")
        with open(local_file, "wb") as input_file:
            input_file.write(os.urandom(FILE_SIZE_BYTES))
        local_input_md5 = compute_local_md5(local_file)

        upload_to_sandbox(sandbox, local_file, local_input_md5)
        download_from_sandbox(sandbox, working_directory, local_input_md5)
    finally:
        sandbox.kill()


if __name__ == "__main__":
    main()
