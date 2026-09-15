"""Code running inside an E2B sandbox tests a development server on your laptop.

Sandboxes have no inbound route to your machine. With Tailcat the laptop runs a
listener in front of a local port, and the sandbox connects out to it. The
listener only admits the sandbox's own client key (`--allow`), so nothing else
that learns the address can reach your laptop.

Two ways to consume it inside the sandbox:
  1. `tailcat socks <address> <cmd>` runs <cmd> with an all_proxy SOCKS5 proxy (curl, pip, git, ...).
  2. socat turns the Tailcat pipe into a plain local port for tools that do not speak SOCKS (psql, redis-cli, ...).
"""

import http.server
import json
import os
import socketserver
import sys
import threading

from dotenv import load_dotenv

from .e2b_sandbox import (
    CommandResult,
    CommandRunner,
    assert_command_succeeded,
    create_sandbox,
    sandbox_command_runner,
)
from .tailcat_server import (
    start_local_tailcat_server,
    wait_until_reachable,
)

LOCAL_PORT = int(os.environ.get("DEMO_LOCAL_PORT", "8765"))
RESPONSES = {
    "/health": {"status": "ok"},
    "/api/project": {"name": "tailcat-demo", "environment": "local"},
    "/api/check": {"accepted": True},
}


class DemoHttpRequestHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        payload = RESPONSES.get(self.path, {"error": "not found"})
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(200 if self.path in RESPONSES else 404)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        pass


def serve_local_http() -> socketserver.TCPServer:
    """Start a tiny stand-in for the development server already running locally."""
    http_server = socketserver.TCPServer(("127.0.0.1", LOCAL_PORT), DemoHttpRequestHandler)
    threading.Thread(target=http_server.serve_forever, daemon=True).start()
    return http_server


def report_successful_check(label: str, result: CommandResult, expected: dict) -> None:
    assert_command_succeeded(result)
    actual = json.loads(result.output.strip())
    if actual != expected:
        raise RuntimeError(f"{label}: unexpected response {result.output.strip()}")
    print(f"✓ {label}")


def test_through_socks(run_in_sandbox: CommandRunner, laptop_address: str) -> None:
    health_check = run_in_sandbox(
        f"tailcat socks {laptop_address} curl -fsS http://server.tailcat:{LOCAL_PORT}/health"
    )
    report_successful_check("GET /health returned the local server status", health_check, {"status": "ok"})

    project_check = run_in_sandbox(
        f"tailcat socks {laptop_address} curl -fsS http://server.tailcat:{LOCAL_PORT}/api/project"
    )
    report_successful_check(
        "GET /api/project returned the local project",
        project_check,
        {"name": "tailcat-demo", "environment": "local"},
    )


def test_through_local_port(run_in_sandbox: CommandRunner, laptop_address: str) -> None:
    run_in_sandbox(
        f"socat TCP-LISTEN:{LOCAL_PORT},fork,reuseaddr,bind=127.0.0.1 "
        f"EXEC:'tailcat {laptop_address} {LOCAL_PORT}' >/tmp/socat.log 2>&1 &"
    )
    api_check = run_in_sandbox(
        f"sleep 1; curl -fsS --retry 5 --retry-connrefused http://127.0.0.1:{LOCAL_PORT}/api/check"
    )
    report_successful_check("GET /api/check worked through a sandbox-local port", api_check, {"accepted": True})


def verify_other_identities_are_rejected(run_in_sandbox: CommandRunner, laptop_address: str) -> None:
    foreign_key_ping = run_in_sandbox(f"tailcat --key=new ping --timeout 5s {laptop_address}")
    if foreign_key_ping.exit_code == 0:
        raise RuntimeError("a different Tailcat identity was unexpectedly allowed")
    print("✓ A different Tailcat identity was rejected")


def main() -> None:
    sys.stdout.reconfigure(line_buffering=True)
    load_dotenv()
    local_http_server = serve_local_http()
    print(f"[laptop] local development server listening on http://127.0.0.1:{LOCAL_PORT}")
    sandbox = create_sandbox()
    try:
        run_in_sandbox = sandbox_command_runner(sandbox, timeout_seconds=120)

        # The sandbox gets its own identity; the laptop only admits that key.
        key_generation = run_in_sandbox(
            "tailcat genkey --client --key=client-default 2>/dev/null | grep -o 'nodekey:[0-9a-f]*'"
        )
        assert_command_succeeded(key_generation)
        sandbox_client_public_key = key_generation.output.strip()
        print(f"[sandbox] client key {sandbox_client_public_key[:24]}…")

        laptop_tailcat_server = start_local_tailcat_server(f"serve --allow={sandbox_client_public_key} {LOCAL_PORT}")
        try:
            connection = wait_until_reachable(run_in_sandbox, laptop_tailcat_server.address)
            print(f"[sandbox] {connection}")
            print("\nTesting the development server on your laptop...\n")

            test_through_socks(run_in_sandbox, laptop_tailcat_server.address)
            test_through_local_port(run_in_sandbox, laptop_tailcat_server.address)
            verify_other_identities_are_rejected(run_in_sandbox, laptop_tailcat_server.address)
            print("\n4 checks passed")
        finally:
            laptop_tailcat_server.stop()
    finally:
        sandbox.kill()
        local_http_server.shutdown()
        local_http_server.server_close()


if __name__ == "__main__":
    main()
