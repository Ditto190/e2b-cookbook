# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "agent-api-sdk",
#     "httpx>=0.27,<1",
# ]
#
# [tool.uv.sources]
# agent-api-sdk = { git = "https://github.com/OpenAI-Early-Access/agents-api-python-preview.git" }
# ///

"""Use Agents API without importing a sandbox provider SDK."""

from __future__ import annotations

import argparse
import asyncio
import json

import httpx
from agent_api_sdk import AgentAPISDK, AsyncAgentSession

# The Agents API rejects requests without this header (400 invalid_beta) and the
# preview SDK does not send it yet, so inject it via a custom httpx client.
BETA_HEADERS = {"OpenAI-Beta": "agents=v1"}

# The API renamed input events to `agent.session.input.*`; the preview SDK still
# posts `session.input.*` (400 invalid_request_error). Rewrite until upstream catches up.
_post_events = AsyncAgentSession._post_events


async def _post_prefixed_events(self: AsyncAgentSession, events: list, **kwargs):
    for event in events:
        if str(event.get("type", "")).startswith("session.input."):
            event["type"] = f"agent.{event['type']}"
    return await _post_events(self, events, **kwargs)


AsyncAgentSession._post_events = _post_prefixed_events  # type: ignore[method-assign]


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--create-agent", metavar="NAME")
    parser.add_argument("--agent-id")
    parser.add_argument("--session-id")
    parser.add_argument("--delete", action="store_true")
    parser.add_argument("--model", default="gpt-5.6-sol")
    parser.add_argument("--workspace", default="/workspace")
    parser.add_argument("--input", default="Run a shell command to print hello from the sandbox.")
    args = parser.parse_args()

    async with AgentAPISDK(
        http_client=httpx.AsyncClient(timeout=600, headers=BETA_HEADERS)
    ) as client:
        if args.create_agent:
            agent = await client.agents.create(model=args.model, name=args.create_agent)
            print(json.dumps({"agent_id": agent.id}))
            return
        if args.delete:
            if not args.session_id:
                parser.error("--delete requires --session-id; stop provider compute separately")
            await client.sessions.delete(args.session_id)
            print(json.dumps({"deleted": args.session_id}))
            return
        if args.session_id:
            session = await client.sessions.retrieve(args.session_id)
        else:
            if not args.agent_id:
                parser.error("Pass --agent-id from --create-agent, or an existing --session-id")
            session = await client.sessions.create(
                agent_id=args.agent_id,
                environment={"type": "self_hosted", "workspace_directory": args.workspace},
            )
        print(json.dumps({"session_id": session.id}), flush=True)
        completed = False
        async for event in session.stream(input=args.input):
            if event.type in {"session.turn.failed", "session.turn.cancelled", "session.failed"}:
                raise RuntimeError(f"Agent failed: {event.type}")
            if event.output_text_delta:
                print(event.output_text_delta, end="", flush=True)
            if event.type == "session.turn.completed":
                completed = True
        if not completed:
            raise RuntimeError("Stream ended without a completed turn")
        print()


if __name__ == "__main__":
    asyncio.run(main())
