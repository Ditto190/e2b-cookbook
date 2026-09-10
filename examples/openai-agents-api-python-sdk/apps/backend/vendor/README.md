# Vendored Agents API preview SDK

This directory contains `agent_api_sdk` version `0.3.0` (plus unreleased changes) vendored from the OpenAI Agents API Python preview SDK, which is not yet published as a package.

It is temporarily vendored so the public E2B template can run a self-contained demo before the preview SDK has a distributable package. The upstream project is MIT licensed; its license is included here.

Replace this directory with an installed package as soon as the preview SDK is published. When updating it, rerun the full tagged-template smoke because the Agents API event and execution-policy schemas are preview contracts.

Local compatibility patch: token usage counters and detail objects are optional so
sparse usage does not abort a terminal event or turn retrieval. Missing values
remain absent in workbench output.

Local compatibility patch: the client always sends `OpenAI-Beta: agents=v1`. The
Agents API rejects requests without it (`400 invalid_beta`), and callers that
construct `AgentAPISDK` without a custom `http_client` would otherwise miss it.

Local compatibility patch: session input events are posted as
`agent.session.input.message` / `.cancel` / `.tool_result`; the API rejects the
unprefixed names with `400 invalid_request_error`. Incoming `agent.session.*`
stream events are normalized back to the `session.*` names the SDK and backend
match on, so both spellings parse. Turn and subagent resources likewise accept
`object: agent.session.turn` / `agent.session.subagent` next to the old names.
