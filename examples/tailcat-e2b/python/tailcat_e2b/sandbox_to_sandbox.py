"""Two E2B sandboxes exchange encrypted data through Tailcat's DERP relay.

The producer sandbox generates a dataset and serves a read-write directory.
The consumer sandbox pulls the dataset over Tailcat, analyzes it, and pushes
a JSON report back into the producer's directory. The orchestrator only passes
the producer's address to the consumer; file bytes do not pass through it.
"""

import os
import sys
import time

from dotenv import load_dotenv
from e2b import Sandbox

from .e2b_sandbox import (
    assert_command_succeeded,
    create_sandbox,
    run_sandbox_command,
    sandbox_command_runner,
)
from .tailcat_server import (
    start_sandbox_tailcat_server,
    wait_until_reachable,
)

FILE_SIZE_MIB = int(os.environ.get("DEMO_FILE_SIZE_MIB", "10"))
FILE_SIZE_BYTES = FILE_SIZE_MIB * 1024 * 1024


def compute_sandbox_md5(sandbox: Sandbox, path: str) -> str:
    result = run_sandbox_command(sandbox, f"md5sum {path}")
    assert_command_succeeded(result)
    return result.output.split()[0]


def transfer_speed(size_bytes: int, seconds: float) -> str:
    return f"{size_bytes * 8 / seconds / 1e6:.0f} Mbit/s"


def main() -> None:
    sys.stdout.reconfigure(line_buffering=True)
    load_dotenv()
    producer_sandbox = create_sandbox()
    consumer_sandbox = create_sandbox()
    try:
        # Producer: generate a dataset and share its directory read-write.
        producer_sandbox.commands.run(
            f"mkdir -p /home/user/share && head -c {FILE_SIZE_BYTES} /dev/urandom > /home/user/share/dataset.bin",
        )
        shared_directory_server = start_sandbox_tailcat_server(
            producer_sandbox, "serve --files=/home/user/share:rw files", "share"
        )
        try:

            # Consumer: connect using only the address string.
            run_in_consumer = sandbox_command_runner(consumer_sandbox, timeout_seconds=300)
            connection = wait_until_reachable(run_in_consumer, shared_directory_server.address)
            print(f"[consumer] {connection}")

            directory_listing = run_in_consumer(f"tailcat ls -l {shared_directory_server.address}")
            assert_command_succeeded(directory_listing)
            print("[consumer] tailcat ls -l <producer>:\n" + directory_listing.output.strip())

            started_at = time.time()
            assert_command_succeeded(
                run_in_consumer(f"tailcat cp {shared_directory_server.address}:dataset.bin /home/user/dataset.bin")
            )
            elapsed_seconds = time.time() - started_at
            checksum_matches = compute_sandbox_md5(consumer_sandbox, "/home/user/dataset.bin") == compute_sandbox_md5(
                producer_sandbox, "/home/user/share/dataset.bin"
            )
            if not checksum_matches:
                raise RuntimeError("the dataset checksum differs between the producer and consumer")
            print(
                f"[producer -> consumer] {FILE_SIZE_MIB} MiB in {elapsed_seconds:.1f}s "
                f"({transfer_speed(FILE_SIZE_BYTES, elapsed_seconds)}), md5 ok"
            )

            # Consumer: analyze the dataset, then push a useful result back to the producer.
            analysis = run_in_consumer(
                "checksum=$(sha256sum /home/user/dataset.bin | cut -d' ' -f1); "
                f"printf '{{\"bytesProcessed\":{FILE_SIZE_BYTES},\"status\":\"complete\","
                "\"generatedBy\":\"worker-sandbox\",\"sha256\":\"%s\"}\\n' "
                '"$checksum" > /home/user/analysis-report.json'
            )
            assert_command_succeeded(analysis)
            started_at = time.time()
            assert_command_succeeded(
                run_in_consumer(f"tailcat cp /home/user/analysis-report.json {shared_directory_server.address}:")
            )
            elapsed_seconds = time.time() - started_at
            processed_result = run_sandbox_command(
                producer_sandbox, "python3 -m json.tool /home/user/share/analysis-report.json"
            )
            assert_command_succeeded(processed_result)
            print(f"[consumer -> producer] analysis-report.json returned in {elapsed_seconds:.1f}s")
            print("\nFinal report:\n" + processed_result.output.strip())

            # Streaming variant: bare `tailcat` accepts one connection, copies it to
            # stdout and exits, so the producer receives whatever the consumer pipes in.
            stream_receiver = start_sandbox_tailcat_server(producer_sandbox, "", "stream")
            try:
                wait_until_reachable(run_in_consumer, stream_receiver.address)
                assert_command_succeeded(
                    run_in_consumer(f"seq 1 5 | sed 's/^/log line /' | tailcat {stream_receiver.address}")
                )
                received_stream = stream_receiver.wait()
                print("[consumer -> producer stream] producer received:\n" + received_stream.strip())
            finally:
                stream_receiver.stop()
        finally:
            shared_directory_server.stop()
    finally:
        producer_sandbox.kill()
        consumer_sandbox.kill()


if __name__ == "__main__":
    main()
