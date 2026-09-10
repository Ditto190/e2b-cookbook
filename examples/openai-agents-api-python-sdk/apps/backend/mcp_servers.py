"""Selectable MCP servers: the picker's catalog and the tool payloads it builds.

Three connection origins, and the differences are not cosmetic:

- `service` — OpenAI's Agents API service dials the server over HTTP. Works
  before the sandbox exists and needs no packages in the image.
- `environment` — the self-hosted environment (our E2B sandbox, via
  `codex exec-server`) spawns the server as a stdio subprocess. That is how
  the no-HTTP-endpoint servers get in: the sandbox is the gateway, so they
  inherit its filesystem and network egress and only work once the executor
  is up.
- `gateway` — E2B's hosted MCP catalog, every server the installed SDK knows
  (`e2b.sandbox.mcp.McpServer`). The coordinator starts `mcp-gateway` in the
  sandbox for the ones a chat picked, with that chat's option values (API keys
  and the like) as the server config; the gateway pulls each server's image on
  first use, or serves it instantly when `Template.addMcpServer()` cached it
  into the image at build time (template/executor/mcp-catalog.json is that
  prepull list). They share ONE authenticated HTTP endpoint on sandbox
  loopback, so the whole selection costs a single `mcp` tool entry.

Tools bind at session creation. Changing a chat's selection reconnects its
workspace to a replacement session with retained transcript context.
"""

from __future__ import annotations

import ast
import inspect
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import e2b.sandbox.mcp as e2b_mcp

# uvx fetches each stdio server from PyPI on first launch, so the sandbox
# image needs no preinstalled MCP packages — it does need uv on PATH and
# network egress. Override for an image that pins versions, vendors the
# packages, or runs offline.
STDIO_LAUNCHER = os.environ.get("MCP_STDIO_LAUNCHER", "uvx")

TOOL_SEARCH_TOOL: dict[str, object] = {"type": "tool_search"}

# The sandbox-local mcp-gateway endpoint. Loopback only — nothing listens on an
# inbound sandbox port, so the environment (not OpenAI's service) dials it.
GATEWAY_URL = "http://127.0.0.1:50005/mcp"
GATEWAY_LABEL = "e2b_gateway"
# Shared with the template build, which passes these ids to addMcpServer():
# the catalog servers whose images are cached in the executor image. Anything
# else in the catalog still works, it just pulls on first use.
PREPULL_CATALOG_PATH = (
    Path(__file__).resolve().parents[2] / "template" / "executor" / "mcp-catalog.json"
)
# Option keys that hold credentials render as password fields and are redacted
# from logs like the API keys themselves.
SECRET_OPTION_PATTERN = re.compile(
    r"key|token|secret|password|passwd|credential|auth|bearer|pat$", re.IGNORECASE
)


@dataclass(frozen=True)
class McpOption:
    """One field of a catalog server's config object (`{apiKey: ...}`)."""

    key: str
    required: bool
    description: str = ""

    @property
    def secret(self) -> bool:
        return bool(SECRET_OPTION_PATTERN.search(self.key))

    def summary(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "required": self.required,
            "description": self.description,
            "secret": self.secret,
        }


@dataclass(frozen=True)
class McpServerSpec:
    label: str
    name: str
    description: str
    connection_origin: str
    # service origin
    server_url: str | None = None
    # environment origin
    command: str | None = None
    args: tuple[str, ...] = ()
    # gateway origin: the server's config fields, and whether its image is
    # already cached in the executor image.
    options: tuple[McpOption, ...] = ()
    prepulled: bool = False

    @property
    def needs_config(self) -> bool:
        """False for the "free" servers: usable with no option values at all."""
        return any(option.required for option in self.options)

    @property
    def runs_in_sandbox(self) -> bool:
        return self.connection_origin in {"environment", "gateway"}

    @property
    def on_gateway(self) -> bool:
        return self.connection_origin == "gateway"

    def tool(self, workspace: str) -> dict[str, object]:
        """This server as an `mcp` entry in the session's tool list. Gateway
        servers have none of their own — see `gateway_tool`."""
        if self.connection_origin == "service":
            transport: dict[str, object] = {"type": "http", "server_url": self.server_url}
            return {
                "type": "mcp",
                "server_label": self.label,
                "transport": transport,
                "connection_origin": "service",
            }
        return {
            "type": "mcp",
            "server_label": self.label,
            "transport": {
                "type": "stdio",
                "command": self.command,
                "args": list(self.args),
                "cwd": workspace,
            },
            "connection_origin": "environment",
            # Best effort: a server that cannot start (no launcher on PATH, no
            # egress for uvx) drops its own tools instead of failing the turn.
            "required": False,
        }

    def summary(self) -> dict[str, Any]:
        """What the picker renders. No secrets here — every field is static."""
        return {
            "label": self.label,
            "name": self.name,
            "description": self.description,
            "connection_origin": self.connection_origin,
            "runs_in_sandbox": self.runs_in_sandbox,
            "server_url": self.server_url,
            "options": [option.summary() for option in self.options],
            "needs_config": self.needs_config,
            "prepulled": self.prepulled,
            "launch": (
                f"mcp-gateway --config '{{\"{self.label}\":{{}}}}'"
                if self.on_gateway
                else " ".join([self.command, *self.args])
                if self.command
                else None
            ),
        }


MCP_SERVERS: tuple[McpServerSpec, ...] = (
    McpServerSpec(
        label="openai_docs",
        name="OpenAI Docs",
        description="Search and read the OpenAI platform documentation.",
        connection_origin="service",
        server_url="https://developers.openai.com/mcp",
    ),
    McpServerSpec(
        label="duckduckgo",
        name="DuckDuckGo",
        description="Web search and page fetching through DuckDuckGo. No API key.",
        connection_origin="environment",
        command=STDIO_LAUNCHER,
        args=("duckduckgo-mcp-server",),
    ),
    McpServerSpec(
        label="wikipedia",
        name="Wikipedia",
        description="Look up Wikipedia articles, summaries, sections and links.",
        connection_origin="environment",
        command=STDIO_LAUNCHER,
        args=("wikipedia-mcp",),
    ),
    McpServerSpec(
        label="time",
        name="Time",
        description="Current time in any IANA timezone, and conversions between them.",
        connection_origin="environment",
        command=STDIO_LAUNCHER,
        args=("mcp-server-time", "--local-timezone=UTC"),
    ),
)

def _humanize(key: str) -> str:
    """`youtubeTranscript` → `Youtube Transcript`, `aks` → `Aks`."""
    names = {"hackernews": "Hacker News", "context7": "Context7", "deepwiki": "DeepWiki"}
    if key in names:
        return names[key]
    words = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", key).split()
    return " ".join(word[:1].upper() + word[1:] for word in words) or key


def _attribute_docs(node: ast.ClassDef) -> dict[str, tuple[str, str]]:
    """TypedDict members as {name: (annotation source, docstring)}. The SDK
    module is generated with `from __future__ import annotations`, so the
    runtime `__required_keys__` cannot see `NotRequired[...]`; the source can."""
    out: dict[str, tuple[str, str]] = {}
    body = node.body
    for index, item in enumerate(body):
        if not (isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name)):
            continue
        doc = ""
        follower = body[index + 1] if index + 1 < len(body) else None
        if (isinstance(follower, ast.Expr) and isinstance(follower.value, ast.Constant)
                and isinstance(follower.value.value, str)):
            doc = inspect.cleandoc(follower.value.value)
        out[item.target.id] = (ast.unparse(item.annotation), doc)
    return out


def _prepulled_ids() -> frozenset[str]:
    """Ids the template build cached. A missing file is not fatal: every
    server then simply pulls on first use, which is the truth for an image
    built before the prepull list existed."""
    try:
        catalog = json.loads(PREPULL_CATALOG_PATH.read_text())
    except (OSError, ValueError):
        return frozenset()
    return frozenset(entry["id"] for entry in catalog if isinstance(entry, dict))


def _gateway_specs(taken: frozenset[str]) -> tuple[McpServerSpec, ...]:
    """Every server in E2B's catalog, read off the installed SDK's `McpServer`
    TypedDict (the same source `Sandbox.create(mcp=...)` is typed against):
    one member per server, its docstring the description, its value type the
    config object whose fields become the picker's option inputs.

    `taken` labels are skipped: a hand-listed server above already owns that
    label (the uvx stdio servers), and labels
    must stay unique for the selection to mean one thing."""
    tree = ast.parse(inspect.getsource(e2b_mcp))
    classes = {node.name: node for node in tree.body if isinstance(node, ast.ClassDef)}
    prepulled = _prepulled_ids()
    specs: list[McpServerSpec] = []
    for key, (annotation, doc) in _attribute_docs(classes["McpServer"]).items():
        if key in taken:
            continue
        config_type = annotation.removeprefix("NotRequired[").removesuffix("]")
        options = tuple(
            McpOption(
                key=field,
                required=not field_annotation.startswith("NotRequired["),
                description=field_doc,
            )
            for field, (field_annotation, field_doc)
            in _attribute_docs(classes[config_type]).items()
        ) if config_type in classes else ()
        specs.append(McpServerSpec(
            label=key,
            name=_humanize(key),
            description=doc.split("\n\n")[0] or f"{_humanize(key)} MCP server.",
            connection_origin="gateway",
            options=options,
            prepulled=key in prepulled,
        ))
    return tuple(specs)


MCP_SERVERS = (*MCP_SERVERS, *_gateway_specs(frozenset(spec.label for spec in MCP_SERVERS)))

MCP_SERVERS_BY_LABEL: dict[str, McpServerSpec] = {
    spec.label: spec for spec in MCP_SERVERS
}
# Selected for new chats unless the client supplies an explicit list.
DEFAULT_MCP_SERVERS: tuple[str, ...] = ("hackernews", "context7", "deepwiki", "openai_docs")


def unknown_servers(labels: list[str]) -> list[str]:
    """Labels this build does not know — the API boundary rejects these so a
    typo from the picker is a 400 rather than a silently smaller tool set."""
    return sorted({label for label in labels if label not in MCP_SERVERS_BY_LABEL})


def normalize_servers(labels: list[str]) -> list[str]:
    """Deduplicate a selection and put it in registry order, so two chats that
    picked the same servers send the same payload.

    Lenient by design: unknown labels are dropped, not rejected. This runs on
    every rehydrated chat record and archived transcript, so retiring a server
    from the registry must not make old chats unparseable.
    """
    picked = set(labels)
    return [spec.label for spec in MCP_SERVERS if spec.label in picked]


def gateway_labels(labels: list[str] | tuple[str, ...]) -> list[str]:
    """The picked servers that ride E2B's gateway, in registry order."""
    picked = set(labels)
    return [
        spec.label for spec in MCP_SERVERS if spec.on_gateway and spec.label in picked
    ]


McpOptions = dict[str, dict[str, str]]


def gateway_config(labels: list[str] | tuple[str, ...], options: McpOptions | None = None) -> str:
    """The `mcp-gateway --config` payload: every picked catalog server with the
    option values the chat supplied (API keys etc.), restricted to the fields
    the catalog declares so a typo cannot smuggle anything else in."""
    options = options or {}
    return json.dumps({
        label: {
            option.key: options[label][option.key]
            for option in MCP_SERVERS_BY_LABEL[label].options
            if option.key in options.get(label, {})
        }
        for label in gateway_labels(labels)
    })


def unknown_options(options: McpOptions, labels: list[str] | tuple[str, ...]) -> list[str]:
    """`label.key` pairs the catalog does not declare, or for servers that
    were not picked. Rejected at the API boundary like unknown labels."""
    picked = set(labels)
    bad: list[str] = []
    for label, values in options.items():
        spec = MCP_SERVERS_BY_LABEL.get(label)
        if spec is None or label not in picked:
            bad.append(label)
            continue
        known = {option.key for option in spec.options}
        bad.extend(f"{label}.{key}" for key in values if key not in known)
    return sorted(bad)


def missing_options(labels: list[str] | tuple[str, ...], options: McpOptions) -> list[str]:
    """Required `label.key` fields a picked server still lacks a value for."""
    return sorted(
        f"{spec.label}.{option.key}"
        for spec in MCP_SERVERS
        if spec.label in set(labels)
        for option in spec.options
        if option.required and not options.get(spec.label, {}).get(option.key, "").strip()
    )


def configured_servers(labels: list[str] | tuple[str, ...], options: McpOptions) -> list[str]:
    """The picked servers whose required fields all have a value. A server
    without them is not configured: the picker shows it unselected and never
    saves it, and a new chat skips it the same way (a selection saved before
    a restart can still name one, since credentials live in process memory)."""
    lacking = {entry.split(".", 1)[0] for entry in missing_options(labels, options)}
    return [label for label in normalize_servers(list(labels)) if label not in lacking]


def option_secrets(options: McpOptions) -> list[str]:
    """Every option value that is a credential, for the output redactors."""
    return [
        value
        for label, values in options.items()
        for option in MCP_SERVERS_BY_LABEL.get(label, McpServerSpec(label, label, "", "gateway")).options
        if option.secret and (value := values.get(option.key, "").strip())
    ]


def gateway_tool(workspace: str) -> dict[str, object]:
    """One `mcp` entry covering every picked gateway server. `required` so a
    turn fails loudly rather than silently losing tools the chat asked for —
    the bridge inherits the coordinator's per-chat token from the executor."""
    return {
        "type": "mcp",
        "server_label": GATEWAY_LABEL,
        "transport": {
            # Direct environment HTTP fails during this gateway's SSE
            # handshake with codex 0.145.0-alpha.24. Let the MCP client bridge
            # streamable HTTP to executor stdio instead. Pin both packages:
            # newer MCP SDKs removed APIs this proxy version imports.
            "type": "stdio",
            "command": STDIO_LAUNCHER,
            "args": [
                "--with", "mcp==1.26.0", "mcp-proxy==0.11.0",
                "--transport", "streamablehttp", GATEWAY_URL,
            ],
            "cwd": workspace,
            "env_vars": ["API_ACCESS_TOKEN"],
        },
        "connection_origin": "environment",
        "required": True,
    }


def mcp_tools(
    labels: list[str] | tuple[str, ...],
    workspace: str,
    gateway_token: str | None = None,
) -> list[dict[str, object]]:
    """The `mcp` tool entries for a selection, in registry order. Gateway
    servers collapse into the single `e2b_gateway` entry at the end, and are
    dropped entirely without a token (no live sandbox to dial)."""
    picked = set(labels)
    tools = [
        spec.tool(workspace)
        for spec in MCP_SERVERS
        if spec.label in picked and not spec.on_gateway
    ]
    if gateway_token and gateway_labels(labels):
        tools.append(gateway_tool(workspace))
    return tools


def mcp_instructions(
    labels: list[str] | tuple[str, ...], tool_search: bool
) -> str:
    """Prose naming the attached servers (the model sees tool schemas, not the
    picker) plus, under tool search, a nudge to look before giving up.

    Explicit tests must call the requested MCPs and expose any failure.
    """
    lines: list[str] = []
    if labels:
        catalog = "; ".join(
            f"{spec.name} ({spec.label}) — {spec.description}"
            for spec in MCP_SERVERS
            if spec.label in set(labels)
        )
        lines.append(f"Connected MCP servers: {catalog}")
        lines.append(
            "When the user names an MCP or asks to test the connected MCPs, "
            "briefly acknowledge which servers you will use, then make actual "
            "calls to each requested server. For an MCP test, call the tools "
            "individually so their calls appear in the activity feed. Do not "
            "substitute web search, browser navigation, shell HTTP requests, "
            "or remembered answers unless the user explicitly permits a fallback. "
            "Tool discovery alone is not a successful test: invoke a substantive "
            "tool and inspect its result. Report the actual server and tool names "
            "used, and distinguish success, errors, and unavailable servers. "
            "Never claim an MCP worked without a successful result from it."
        )
    else:
        lines.append("No MCP servers are connected for this chat.")
    if tool_search:
        lines.append(
            "Tool search is enabled: tools from these servers are discovered on "
            "demand rather than listed up front, so search for a tool before "
            "concluding a capability is unavailable."
        )
    return "\n".join(lines)
