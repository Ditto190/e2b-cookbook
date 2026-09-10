from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Annotated, Literal, TypeAlias, cast, get_args

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    GetJsonSchemaHandler,
    SkipValidation,
    TypeAdapter,
    ValidationError,
)
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import CoreSchema
from typing_extensions import NotRequired, Required, TypedDict

from agent_api_sdk._errors import AgentAPIConfigurationError, AgentAPIResponseError

JsonValue: TypeAlias = object
JsonObject: TypeAlias = dict[str, JsonValue]

SessionStatus: TypeAlias = Literal["idle", "in_progress", "failed", "requires_action"]
SessionListOrder: TypeAlias = Literal["asc", "desc"]
SessionItemListOrder: TypeAlias = Literal["asc", "desc"]
SessionTurnListOrder: TypeAlias = Literal["asc", "desc"]
TelemetryExporterProtocol: TypeAlias = Literal["otlp_http_protobuf"]
EnvironmentStatus: TypeAlias = Literal["pending", "ready", "connected", "disconnected", "failed"]
SubagentStatus: TypeAlias = Literal["active", "closed"]
NetworkAccess: TypeAlias = Literal["disabled", "restricted"]
InputRole: TypeAlias = Literal["user"]
Verbosity: TypeAlias = Literal["low", "medium", "high"]
ReasoningEffort: TypeAlias = Literal[
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
]
ServiceTier: TypeAlias = Literal["auto", "default", "flex", "priority", "fast"]
McpConnectionOrigin: TypeAlias = Literal["service", "environment"]
WebSearchMode: TypeAlias = Literal["disabled", "cached", "live"]
WebSearchContextSize: TypeAlias = Literal["low", "medium", "high"]
SubagentTool: TypeAlias = Literal[
    "spawn_agent",
    "send_input",
    "resume_agent",
    "wait",
    "close_agent",
]
FunctionCallStatus: TypeAlias = Literal[
    "in_progress",
    "completed",
    "failed",
    "incomplete",
]
StateUploadErrorCode: TypeAlias = Literal[
    "state_upload_invalid_destination",
    "state_upload_unauthorized",
    "state_upload_not_found",
    "state_upload_rejected",
    "state_upload_unavailable",
    "state_upload_failed",
]
OutputEventType: TypeAlias = Literal[
    "error",
    "session.created",
    "session.turn.created",
    "session.turn.in_progress",
    "session.turn.completed",
    "session.turn.failed",
    "session.turn.cancelled",
    "session.turn.item.added",
    "session.turn.item.done",
    "session.turn.output_text.added",
    "session.turn.content_part.added",
    "session.turn.content_part.done",
    "session.turn.output_text.delta",
    "session.turn.output_text.done",
    "session.turn.reasoning_summary_text.added",
    "session.turn.reasoning_summary_part.added",
    "session.turn.reasoning_summary_part.done",
    "session.turn.reasoning_summary_text.delta",
    "session.turn.reasoning_summary_text.done",
    "session.idle",
    "session.in_progress",
    "session.requires_action",
    "session.failed",
    "session.state.uploaded",
    "session.state.upload_failed",
    "session.environment.pending",
    "session.environment.connected",
    "session.environment.disconnected",
    "session.environment.failed",
    "session.subagent.created",
    "session.subagent.closed",
    "session.thread.created",
    "session.thread.status_changed",
    "agent.output.item",
    "agent.output.command_execution_output.delta",
    "agent.thread.message.sent",
    "agent.thread.message.received",
    "session.subagent.active",
]


class McpOAuthTokenEndpointAuthNoneParam(TypedDict):
    type: Required[Literal["none"]]


class McpOAuthTokenEndpointAuthClientSecretBasicParam(TypedDict):
    client_secret: Required[str]
    type: Required[Literal["client_secret_basic"]]


class McpOAuthTokenEndpointAuthClientSecretPostParam(TypedDict):
    client_secret: Required[str]
    type: Required[Literal["client_secret_post"]]


class McpOAuthRefreshParam(TypedDict):
    client_id: Required[str]
    refresh_token: Required[str]
    resource: NotRequired[str | None]
    scope: NotRequired[str | None]
    token_endpoint: Required[str]
    token_endpoint_auth: Required[McpOAuthTokenEndpointAuthParam]


class McpOAuthVaultCredentialAuthParam(TypedDict):
    access_token: Required[str]
    expires_at: NotRequired[str | None]
    mcp_server_url: Required[str]
    refresh: NotRequired[McpOAuthRefreshParam | None]
    type: Required[Literal["mcp_oauth"]]


class RotateMcpOAuthTokenEndpointAuthClientSecretBasicParam(TypedDict):
    client_secret: NotRequired[str | None]
    type: Required[Literal["client_secret_basic"]]


class RotateMcpOAuthTokenEndpointAuthClientSecretPostParam(TypedDict):
    client_secret: NotRequired[str | None]
    type: Required[Literal["client_secret_post"]]


class RotateMcpOAuthRefreshParam(TypedDict):
    refresh_token: NotRequired[str | None]
    scope: NotRequired[str | None]
    token_endpoint_auth: NotRequired[RotateMcpOAuthTokenEndpointAuthParam | None]


class RotateMcpOAuthVaultCredentialAuthParam(TypedDict):
    access_token: NotRequired[str | None]
    expires_at: NotRequired[str | None]
    refresh: NotRequired[RotateMcpOAuthRefreshParam | None]
    type: Required[Literal["mcp_oauth"]]


class PersistedAgentToolConfigParamFunction(TypedDict):
    defer_loading: NotRequired[bool]
    description: Required[str]
    name: Required[str]
    parameters: Required[JsonObject]
    type: Required[Literal["function"]]


class PersistedAgentToolConfigParamToolSearch(TypedDict):
    type: Required[Literal["tool_search"]]


class PersistedAgentToolConfigParamProgrammaticToolCalling(TypedDict):
    type: Required[Literal["programmatic_tool_calling"]]
    enabled: NotRequired[bool]


class PersistedMcpTransportConfigParamHttp(TypedDict):
    server_url: Required[str]
    type: Required[Literal["http"]]
    headers: NotRequired[Mapping[str, str] | None]


class PersistedMcpTransportConfigParamStdio(TypedDict):
    args: NotRequired[Sequence[str] | None]
    command: Required[str]
    cwd: Required[str]
    env_vars: NotRequired[Sequence[str] | None]
    type: Required[Literal["stdio"]]


class PersistedAgentToolConfigParamMcp(TypedDict):
    allowed_tools: NotRequired[Sequence[str] | None]
    connection_origin: NotRequired[McpConnectionOrigin | None]
    request_metadata: NotRequired[JsonObject | None]
    server_label: Required[str]
    transport: Required[PersistedMcpTransportParam]
    type: Required[Literal["mcp"]]
    credential_id: NotRequired[str | None]
    required: NotRequired[bool]


class PersistedAgentToolConfigParamWebSearch(TypedDict):
    allowed_domains: NotRequired[Sequence[str] | None]
    context_size: NotRequired[WebSearchContextSize | None]
    location: NotRequired[WebSearchLocationParam | None]
    mode: NotRequired[WebSearchMode | None]
    type: Required[Literal["web_search"]]


class FunctionToolParam(TypedDict):
    type: Required[Literal["function"]]
    name: Required[str]
    description: Required[str]
    parameters: Required[JsonObject]
    defer_loading: NotRequired[bool]


class ToolSearchToolParam(TypedDict):
    type: Required[Literal["tool_search"]]


class ProgrammaticToolCallingToolParam(TypedDict):
    type: Required[Literal["programmatic_tool_calling"]]
    enabled: NotRequired[bool]


class McpHttpTransportParam(TypedDict):
    type: Required[Literal["http"]]
    server_url: Required[str]
    authorization: NotRequired[str | None]
    headers: NotRequired[Mapping[str, str] | None]


class McpStdioTransportParam(TypedDict):
    type: Required[Literal["stdio"]]
    command: Required[str]
    args: NotRequired[Sequence[str] | None]
    cwd: Required[str]
    env: NotRequired[Mapping[str, str] | None]
    env_vars: NotRequired[Sequence[str] | None]


McpTransportParam: TypeAlias = McpHttpTransportParam | McpStdioTransportParam


class McpToolParam(TypedDict):
    type: Required[Literal["mcp"]]
    server_label: Required[str]
    transport: Required[McpTransportParam]
    allowed_tools: NotRequired[Sequence[str] | None]
    connection_origin: NotRequired[McpConnectionOrigin | None]
    request_metadata: NotRequired[JsonObject | None]
    credential_id: NotRequired[str | None]
    required: NotRequired[bool]


class WebSearchLocationParam(TypedDict):
    country: NotRequired[str | None]
    region: NotRequired[str | None]
    city: NotRequired[str | None]
    timezone: NotRequired[str | None]


class WebSearchToolParam(TypedDict):
    type: Required[Literal["web_search"]]
    mode: NotRequired[WebSearchMode]
    context_size: NotRequired[WebSearchContextSize]
    allowed_domains: NotRequired[Sequence[str]]
    location: NotRequired[WebSearchLocationParam]


AgentToolParam: TypeAlias = (
    FunctionToolParam
    | ToolSearchToolParam
    | ProgrammaticToolCallingToolParam
    | McpToolParam
    | WebSearchToolParam
)


class MultiAgentDisabledParam(TypedDict):
    type: Required[Literal["disabled"]]


class MultiAgentEnabledParam(TypedDict):
    type: Required[Literal["enabled"]]
    max_agents: NotRequired[int]


class MultiAgentConfigParam(TypedDict):
    enabled: Required[bool]
    max_concurrent_subagents: NotRequired[int]


MultiAgentParam: TypeAlias = (
    MultiAgentDisabledParam | MultiAgentEnabledParam | MultiAgentConfigParam
)


class JsonSchemaTextFormatParam(TypedDict):
    type: Required[Literal["json_schema"]]
    schema: Required[JsonObject]


class ReasoningParam(TypedDict):
    effort: NotRequired[ReasoningEffort]
    summary: NotRequired[ReasoningSummaryParam | None]


class TextParam(TypedDict):
    format: NotRequired[JsonSchemaTextFormatParam]
    verbosity: NotRequired[Verbosity]


class AgentParam(TypedDict):
    model: NotRequired[str]
    reasoning: NotRequired[ReasoningParam | None]
    text: NotRequired[TextParam | None]
    service_tier: NotRequired[ServiceTier | None]
    instructions: NotRequired[str | None]
    tools: NotRequired[Sequence[AgentToolParam] | None]
    multi_agent: NotRequired[MultiAgentParam | None]


class EnvironmentPackagesParam(TypedDict):
    python: NotRequired[Sequence[str]]
    system: NotRequired[Sequence[str]]


class NetworkPolicyParam(TypedDict):
    access: Required[NetworkAccess]
    allowed_domains: NotRequired[Sequence[str]]


class NoEnvironmentParam(TypedDict):
    type: Required[Literal["none"]]


class SelfHostedEnvironmentParam(TypedDict):
    type: Required[Literal["self_hosted"]]
    workspace_directory: Required[str]
    capability_directories: NotRequired[Sequence[str]]


EnvironmentParam: TypeAlias = NoEnvironmentParam | SelfHostedEnvironmentParam


class DeletesAfterRetentionPolicyParam(TypedDict):
    type: Required[Literal["deletes_after"]]
    anchor: Required[Literal["idle_at"]]
    minutes: Required[int]
    state_upload_url: NotRequired[str]


RetentionPolicyParam: TypeAlias = DeletesAfterRetentionPolicyParam


class TracingConfigParam(TypedDict):
    enabled: NotRequired[bool]
    exporter_ids: NotRequired[Sequence[str] | None]


class CreateTelemetryExporterParam(TypedDict):
    name: Required[str]
    endpoint: Required[str]
    protocol: NotRequired[TelemetryExporterProtocol]
    headers: NotRequired[Mapping[str, str]]


class UpdateTelemetryExporterParam(TypedDict):
    name: NotRequired[str | None]
    endpoint: NotRequired[str | None]
    protocol: NotRequired[TelemetryExporterProtocol | None]
    headers: NotRequired[Mapping[str, str | None] | None]


class UrlPreviousStateParam(TypedDict):
    type: Required[Literal["url"]]
    url: Required[str]


class InlinePreviousStateParam(TypedDict):
    type: Required[Literal["inline"]]
    data: Required[str]


PreviousStateParam: TypeAlias = UrlPreviousStateParam | InlinePreviousStateParam


class StaticBearerVaultCredentialAuthParam(TypedDict):
    type: Required[Literal["static_bearer"]]
    mcp_server_url: Required[str]
    token: Required[str]


class RotateStaticBearerVaultCredentialAuthParam(TypedDict):
    type: Required[Literal["static_bearer"]]
    token: Required[str]


class OpenAIManagedVaultCredentialSourceParam(TypedDict):
    type: Required[Literal["openai_managed"]]


class InputTextParam(TypedDict):
    type: Required[Literal["input_text"]]
    text: Required[str]


class InputImageParam(TypedDict):
    type: Required[Literal["input_image"]]
    image_url: Required[str]


InputContentParam: TypeAlias = InputTextParam | InputImageParam


class InputMessageParam(TypedDict):
    type: NotRequired[Literal["message"]]
    role: Required[InputRole]
    content: Required[Sequence[InputContentParam]]


InputLike: TypeAlias = str | InputMessageParam | Sequence[InputMessageParam]


class SessionInputMessageParam(TypedDict):
    type: Required[Literal["session.input.message"]]
    input: Required[Sequence[InputMessageParam]]


class SessionInputCancelParam(TypedDict):
    type: Required[Literal["session.input.cancel"]]


class SessionInputToolResultParam(TypedDict):
    type: Required[Literal["session.input.tool_result"]]
    call_id: Required[str]
    success: Required[bool]
    turn_id: Required[str]
    output: NotRequired[FunctionCallOutputParam]
    error: NotRequired[str]


SessionInputParam: TypeAlias = (
    SessionInputMessageParam | SessionInputCancelParam | SessionInputToolResultParam
)


FunctionCallOutputParam: TypeAlias = str | Sequence[InputContentParam]


SessionAgentParam: TypeAlias = AgentParam


PersistedMcpTransportParam: TypeAlias = (
    PersistedMcpTransportConfigParamHttp | PersistedMcpTransportConfigParamStdio
)


PersistedAgentToolParam: TypeAlias = (
    PersistedAgentToolConfigParamFunction
    | PersistedAgentToolConfigParamToolSearch
    | PersistedAgentToolConfigParamProgrammaticToolCalling
    | PersistedAgentToolConfigParamMcp
    | PersistedAgentToolConfigParamWebSearch
)


McpOAuthTokenEndpointAuthParam: TypeAlias = (
    McpOAuthTokenEndpointAuthNoneParam
    | McpOAuthTokenEndpointAuthClientSecretBasicParam
    | McpOAuthTokenEndpointAuthClientSecretPostParam
)


VaultCredentialAuthParam: TypeAlias = (
    McpOAuthVaultCredentialAuthParam | StaticBearerVaultCredentialAuthParam
)


RotateMcpOAuthTokenEndpointAuthParam: TypeAlias = (
    RotateMcpOAuthTokenEndpointAuthClientSecretBasicParam
    | RotateMcpOAuthTokenEndpointAuthClientSecretPostParam
)


RotateVaultCredentialAuthParam: TypeAlias = (
    RotateMcpOAuthVaultCredentialAuthParam | RotateStaticBearerVaultCredentialAuthParam
)


ReasoningSummaryParam: TypeAlias = Literal["concise", "detailed", "auto"]


class AgentAPIModel(BaseModel):
    model_config = ConfigDict(extra="allow", frozen=True, populate_by_name=True)


class OutputTextInfo(AgentAPIModel):
    text: str
    type: Literal["output_text"]


class EncryptedContentInfo(AgentAPIModel):
    encrypted_content: str
    type: Literal["encrypted_content"]


AgentContentInfo: TypeAlias = Annotated[
    OutputTextInfo | EncryptedContentInfo, Field(discriminator="type")
]


class MultiAgentConfigInfo(AgentAPIModel):
    enabled: bool
    max_concurrent_subagents: int | None


TurnStatusInfo: TypeAlias = Literal[
    "queued",
    "in_progress",
    "waiting",
    "completed",
    "failed",
    "cancelled",
]


class _TurnErrorPayload(TypedDict):
    code: Required[SessionTurnErrorCodeInfo]
    message: Required[str]


class _TurnInputTokensDetailsPayload(TypedDict):
    cached_tokens: Required[int]


class _TurnOutputTokensDetailsPayload(TypedDict):
    reasoning_tokens: Required[int]


class _TurnUsagePayload(TypedDict):
    input_tokens: Required[int]
    input_tokens_details: Required[_TurnInputTokensDetailsPayload]
    output_tokens: Required[int]
    output_tokens_details: Required[_TurnOutputTokensDetailsPayload]
    total_tokens: Required[int]


class TurnPayload(TypedDict):
    agent_id: Required[str]
    completed_at: Required[int | None]
    created_at: Required[int]
    error: Required[_TurnErrorPayload | None]
    id: Required[str]
    object: Required[Literal["session.turn"]]
    session_id: Required[str]
    started_at: Required[int | None]
    status: Required[TurnStatusInfo]
    subagent_id: Required[str | None]
    usage: Required[_TurnUsagePayload | None]


class TurnInfo(AgentAPIModel):
    agent_id: str
    completed_at: int | None
    created_at: int
    error: SessionTurnErrorInfo | None
    id: str
    object: Literal["session.turn"]
    session_id: str
    started_at: int | None
    status: TurnStatusInfo
    subagent_id: str | None
    usage: TokenUsageInfo | None


class SessionTurnList(AgentAPIModel):
    object: Literal["list"]
    data: list[TurnInfo]
    first_id: str | None
    last_id: str | None
    has_more: bool


class TelemetryExporterInfo(AgentAPIModel):
    # Exporter headers contain credentials and are strictly write-only. Fail closed
    # if a malformed response unexpectedly includes them or another secret field.
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)

    id: str
    object: Literal["agent.telemetry.exporter"]
    name: str
    protocol: TelemetryExporterProtocol
    endpoint: str
    header_names: list[str]


class TelemetryExporterList(AgentAPIModel):
    object: Literal["list"]
    data: list[TelemetryExporterInfo]
    first_id: str | None
    last_id: str | None
    has_more: bool
    next_cursor: str | None


class DeletedTelemetryExporterInfo(AgentAPIModel):
    id: str
    object: Literal["agent.telemetry.exporter.deleted"]
    deleted: bool


class TextFormatResourceText(AgentAPIModel):
    type: Literal["text"]


class RetentionPolicyResourceDeletesAfter(AgentAPIModel):
    anchor: Literal["idle_at"]
    minutes: int
    type: Literal["deletes_after"]


RetentionPolicyInfo: TypeAlias = Annotated[
    RetentionPolicyResourceDeletesAfter, Field(discriminator="type")
]


class SessionRequiredActionResourceFunctionCall(AgentAPIModel):
    arguments: JsonValue
    call_id: str
    name: str
    turn_id: str
    type: Literal["function_call"]


class SessionRequiredActionResourceEnvironmentConnection(AgentAPIModel):
    environment_id: str
    type: Literal["environment_connection"]


SessionRequiredActionInfo: TypeAlias = Annotated[
    SessionRequiredActionResourceFunctionCall | SessionRequiredActionResourceEnvironmentConnection,
    Field(discriminator="type"),
]


class MultiAgentConfigParamResourceDisabled(AgentAPIModel):
    type: Literal["disabled"]


class MultiAgentConfigParamResourceEnabled(AgentAPIModel):
    max_agents: int | None
    type: Literal["enabled"]


MultiAgentConfigParamInfo: TypeAlias = (
    MultiAgentConfigParamResourceDisabled | MultiAgentConfigParamResourceEnabled
)


ReasoningEffortParamInfo: TypeAlias = Literal[
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
]


class ReasoningParamInfo(AgentAPIModel):
    effort: ReasoningEffortParamInfo | None

    @property
    def summary(self) -> ReasoningSummaryParam | None:
        """Expose the existing extra value without changing published model state."""
        extra = self.model_extra
        return None if extra is None else cast(ReasoningSummaryParam | None, extra.get("summary"))


ServiceTierParamInfo: TypeAlias = Literal["auto", "default", "flex", "priority", "fast"]


class TextFormatParamResourceJsonSchema(AgentAPIModel):
    schema_: JsonObject = Field(alias="schema")
    type: Literal["json_schema"]


TextFormatParamInfo: TypeAlias = TextFormatParamResourceJsonSchema


VerbosityParamInfo: TypeAlias = Literal["low", "medium", "high"]


class TextParamInfo(AgentAPIModel):
    format: TextFormatParamInfo | TextFormatResourceText | None
    verbosity: VerbosityParamInfo | None


class PersistedAgentToolConfigParamResourceFunction(AgentAPIModel):
    defer_loading: bool | None = None
    description: str
    name: str
    parameters: JsonObject
    type: Literal["function"]


class PersistedAgentToolConfigParamResourceToolSearch(AgentAPIModel):
    type: Literal["tool_search"]


class PersistedAgentToolConfigParamResourceProgrammaticToolCalling(AgentAPIModel):
    type: Literal["programmatic_tool_calling"]
    enabled: bool = True


McpConnectionOriginParamInfo: TypeAlias = Literal["service", "environment"]


class PersistedMcpTransportConfigParamResourceHttp(AgentAPIModel):
    server_url: str
    type: Literal["http"]
    headers: dict[str, str] | None


class PersistedMcpTransportConfigParamResourceStdio(AgentAPIModel):
    args: list[str] | None
    command: str
    cwd: str
    env_vars: list[str] | None
    type: Literal["stdio"]


PersistedMcpTransportConfigParamInfo: TypeAlias = (
    PersistedMcpTransportConfigParamResourceHttp | PersistedMcpTransportConfigParamResourceStdio
)


class PersistedAgentToolConfigParamResourceMcp(AgentAPIModel):
    allowed_tools: list[str] | None
    connection_origin: McpConnectionOriginParamInfo | None
    request_metadata: JsonObject | None = None
    server_label: str
    transport: PersistedMcpTransportConfigParamInfo
    type: Literal["mcp"]
    credential_id: str | None

    @property
    def required(self) -> bool:
        """Expose the existing extra value without changing published model state."""
        extra = self.model_extra
        return False if extra is None else cast(bool, extra.get("required", False))


WebSearchContextSizeParamInfo: TypeAlias = Literal["low", "medium", "high"]


class WebSearchLocationParamInfo(AgentAPIModel):
    city: str | None
    country: str | None
    region: str | None
    timezone: str | None


WebSearchModeParamInfo: TypeAlias = Literal["disabled", "cached", "live"]


class PersistedAgentToolConfigParamResourceWebSearch(AgentAPIModel):
    allowed_domains: list[str] | None
    context_size: WebSearchContextSizeParamInfo | None
    location: WebSearchLocationParamInfo | None
    mode: WebSearchModeParamInfo | None
    type: Literal["web_search"]


PersistedAgentToolConfigParamInfo: TypeAlias = (
    PersistedAgentToolConfigParamResourceFunction
    | PersistedAgentToolConfigParamResourceToolSearch
    | PersistedAgentToolConfigParamResourceProgrammaticToolCalling
    | PersistedAgentToolConfigParamResourceMcp
    | PersistedAgentToolConfigParamResourceWebSearch
)


class AgentInfo(AgentAPIModel):
    created_at: int
    id: str
    instructions: str | None
    model: str
    multi_agent: MultiAgentConfigInfo
    object: Literal["agent"]
    reasoning: ReasoningParamInfo | None
    service_tier: ServiceTierParamInfo | None
    text: TextParamInfo | None
    tools: list[PersistedAgentToolConfigParamInfo] | None
    updated_at: int

    @property
    def name(self) -> str | None:
        """Expose the existing extra value without changing published model state."""
        extra = self.model_extra
        return None if extra is None else cast(str | None, extra.get("name"))


class AgentList(AgentAPIModel):
    has_more: bool
    next_cursor: str | None
    object: Literal["list"]
    page: list[AgentInfo]


class DeletedAgentInfo(AgentAPIModel):
    deleted: bool
    id: str
    object: Literal["agent.deleted"]


class InputTokensDetailsInfo(AgentAPIModel):
    cached_tokens: int | None = None


class OutputTokensDetailsInfo(AgentAPIModel):
    reasoning_tokens: int | None = None


class TokenUsageInfo(AgentAPIModel):
    input_tokens: int | None = None
    input_tokens_details: InputTokensDetailsInfo | None = None
    output_tokens: int | None = None
    output_tokens_details: OutputTokensDetailsInfo | None = None
    total_tokens: int | None = None


SessionTurnErrorCodeInfo: TypeAlias = Literal[
    "context_length_exceeded",
    "session_budget_exceeded",
    "usage_limit_exceeded",
    "rate_limit_exceeded",
    "server_overloaded",
    "cyber_policy",
    "connection_failed",
    "server_error",
    "authentication_error",
    "invalid_request",
    "resource_not_found",
    "sandbox_error",
    "active_turn_not_steerable",
    "request_timeout",
    "internal_error",
]


class SessionTurnErrorInfo(AgentAPIModel):
    code: SessionTurnErrorCodeInfo
    message: str


class NetworkPolicyInfo(AgentAPIModel):
    access: NetworkAccess
    allowed_domains: list[str] | None


class NoEnvironmentInfo(AgentAPIModel):
    type: Literal["none"]


class SelfHostedEnvironmentInfo(AgentAPIModel):
    type: Literal["self_hosted"]
    environment_id: str = Field(validation_alias=AliasChoices("environment_id", "id"))
    workspace_directory: str = "/workspace"
    capability_directories: list[str] = Field(default_factory=list)


EnvironmentInfo: TypeAlias = Annotated[
    NoEnvironmentInfo | SelfHostedEnvironmentInfo,
    Field(discriminator="type"),
]


class SessionInfo(AgentAPIModel):
    id: str
    object: Literal["agent.session"]
    created_at: int
    last_active_at: int
    status: SessionStatus
    error: str | None = None
    agent: JsonObject
    environment: EnvironmentInfo
    vault_ids: list[str] = Field(default_factory=list)
    retention_policy: RetentionPolicyParam | None = None
    idle_at: int | None = None
    expires_at: int | None = None
    raw: JsonObject = Field(default_factory=dict, exclude=True)

    usage: TokenUsageInfo | None = None

    required_actions: list[SessionRequiredActionInfo] = Field(default_factory=list)

    @classmethod
    def from_payload(cls, payload: Mapping[str, JsonValue]) -> SessionInfo:
        return cls.model_validate({**payload, "raw": dict(payload)})


class DeletedSessionInfo(AgentAPIModel):
    id: str
    object: Literal["agent.session.deleted"]
    deleted: bool


SessionListItem: TypeAlias = SessionInfo


class SessionList(AgentAPIModel):
    object: Literal["list"]
    page: list[SessionInfo]
    has_more: bool
    next_cursor: str | None

    @classmethod
    def from_payload(cls, payload: Mapping[str, JsonValue]) -> SessionList:
        raw_page = payload.get("page")
        sessions: list[SessionListItem] = []
        if isinstance(raw_page, Sequence) and not isinstance(raw_page, (str, bytes)):
            sessions = [
                _parse_session_list_item(cast(Mapping[str, JsonValue], session))
                for session in raw_page
                if isinstance(session, Mapping)
            ]
        return cls.model_validate({**payload, "page": sessions})


class SessionItemList(AgentAPIModel):
    data: list[JsonObject]
    has_more: bool
    before: str | None
    after: str | None


class VaultInfo(AgentAPIModel):
    id: str
    object: Literal["vault"]
    display_name: str
    metadata: dict[str, str]
    created_at: int
    updated_at: int
    archived_at: int | None


class VaultList(AgentAPIModel):
    object: Literal["list"]
    page: list[VaultInfo]
    has_more: bool
    next_cursor: str | None


class StaticBearerVaultCredentialAuthInfo(AgentAPIModel):
    type: Literal["static_bearer"]
    mcp_server_url: str


class OpenAIManagedVaultCredentialSourceInfo(AgentAPIModel):
    type: Literal["openai_managed"]


class McpOAuthTokenEndpointAuthNoneInfo(AgentAPIModel):
    type: Literal["none"]


class McpOAuthTokenEndpointAuthClientSecretBasicInfo(AgentAPIModel):
    type: Literal["client_secret_basic"]


class McpOAuthTokenEndpointAuthClientSecretPostInfo(AgentAPIModel):
    type: Literal["client_secret_post"]


McpOAuthTokenEndpointAuthInfo: TypeAlias = Annotated[
    McpOAuthTokenEndpointAuthNoneInfo
    | McpOAuthTokenEndpointAuthClientSecretBasicInfo
    | McpOAuthTokenEndpointAuthClientSecretPostInfo,
    Field(discriminator="type"),
]


class McpOAuthRefreshInfo(AgentAPIModel):
    client_id: str
    resource: str | None
    scope: str | None
    token_endpoint: str
    token_endpoint_auth: McpOAuthTokenEndpointAuthInfo


class McpOAuthVaultCredentialAuthInfo(AgentAPIModel):
    expires_at: str | None
    mcp_server_url: str
    refresh: McpOAuthRefreshInfo | None
    type: Literal["mcp_oauth"]


VaultCredentialAuthInfo: TypeAlias = Annotated[
    McpOAuthVaultCredentialAuthInfo | StaticBearerVaultCredentialAuthInfo,
    Field(discriminator="type"),
]


class VaultCredentialInfo(AgentAPIModel):
    id: str
    object: Literal["vault.credential"]
    vault_id: str
    display_name: str
    auth: VaultCredentialAuthInfo
    source: OpenAIManagedVaultCredentialSourceInfo
    created_at: int
    updated_at: int
    archived_at: int | None


class VaultCredentialList(AgentAPIModel):
    object: Literal["list"]
    page: list[VaultCredentialInfo]
    has_more: bool
    next_cursor: str | None


class DeletedVaultInfo(AgentAPIModel):
    id: str
    object: Literal["vault.deleted"]


class DeletedVaultCredentialInfo(AgentAPIModel):
    id: str
    object: Literal["vault.credential.deleted"]


def _parse_session_list_item(payload: Mapping[str, JsonValue]) -> SessionListItem:
    return SessionInfo.from_payload(payload)


class CreatedByInfo(AgentAPIModel):
    tool_call_id: str
    source_event_id: str


class AgentThreadInfo(AgentAPIModel):
    id: str
    object: Literal["agent.thread"]
    parent_thread_id: str | None
    agent_role: str | None
    agent_nickname: str | None


class SubagentInfo(AgentAPIModel):
    id: str
    object: Literal["session.subagent"]
    session_id: str
    name: str
    instructions: list[AgentContentInfo] | None
    parent_agent_id: str
    status: SubagentStatus
    opened_at: int
    closed_at: int | None


class SessionSubagentList(AgentAPIModel):
    object: Literal["list"]
    data: list[SubagentInfo]
    first_id: str | None
    last_id: str | None
    has_more: bool


class BaseSessionEvent(AgentAPIModel):
    event_id: str
    session_id: str
    turn_id: str | None = None
    type: str
    data: JsonObject = Field(default_factory=dict, exclude=True)
    event_name: str | None = Field(default=None, exclude=True)
    sse_event_id: str | None = Field(default=None, exclude=True)

    @property
    def turn_info(self) -> TurnInfo | None:
        """Return validated turn details without changing the published raw turn mapping."""
        turn = getattr(self, "turn", None)
        if not isinstance(turn, dict):
            return None
        try:
            return TurnInfo.model_validate(turn)
        except ValidationError:
            return None

    @property
    def status(self) -> str | None:
        value = self.data.get("status")
        if value in {"idle", "in_progress", "failed"}:
            return value
        session = self.data.get("session")
        if isinstance(session, Mapping):
            session_status = session.get("status")
            if session_status in {"idle", "in_progress", "failed"}:
                return session_status
        return None

    @property
    def output_text_delta(self) -> str | None:
        value = self.data.get("delta")
        if self.type == "session.turn.output_text.delta" and isinstance(value, str):
            return value
        return None

    @property
    def output_text(self) -> str | None:
        value = self.data.get("text")
        if self.type == "session.turn.output_text.done" and isinstance(value, str):
            return value
        return None

    @property
    def item(self) -> JsonObject | None:
        value = self.data.get("item")
        return value if isinstance(value, dict) else None

    @property
    def function_call(self) -> JsonObject | None:
        item = self.item
        if item is not None and item.get("type") == "function_call":
            return item
        return None

    @property
    def subagent_tool_call(self) -> JsonObject | None:
        item = self.item
        if item is not None and item.get("type") in {
            "spawn_agent_call",
            "send_input_call",
            "resume_agent_call",
            "wait_for_agents_call",
            "close_agent_call",
        }:
            return item
        return None


class SessionCreatedEvent(BaseSessionEvent):
    type: Literal["session.created"]
    session: SessionInfo


class SessionErrorInfo(AgentAPIModel):
    type: str
    code: str | None
    message: str
    param: str | None


class SessionErrorEvent(BaseSessionEvent):
    type: Literal["error"]
    error: SessionErrorInfo


class _SessionTurnLifecycleEvent(BaseSessionEvent):
    @property
    def turn(self) -> TurnPayload | None:
        """Expose the historical extra turn without changing model state or serialization."""
        extra = self.model_extra
        return None if extra is None else cast(TurnPayload | None, extra.get("turn"))

    @classmethod
    def __get_pydantic_json_schema__(
        cls, core_schema: CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        """Document the optional typed turn while keeping its runtime value in model_extra."""
        schema = handler.resolve_ref_schema(handler(core_schema))
        schema.setdefault("properties", {})["turn"] = {
            **handler(TypeAdapter(SkipValidation[TurnPayload] | None).core_schema),
            "default": None,
            "title": "Turn",
        }
        return schema


class SessionTurnCreatedEvent(_SessionTurnLifecycleEvent):
    type: Literal["session.turn.created"]


class SessionTurnInProgressEvent(_SessionTurnLifecycleEvent):
    type: Literal["session.turn.in_progress"]


class SessionTurnCompletedEvent(_SessionTurnLifecycleEvent):
    type: Literal["session.turn.completed"]
    usage: TokenUsageInfo | None = None


class SessionTurnFailedEvent(_SessionTurnLifecycleEvent):
    type: Literal["session.turn.failed"]
    error: SessionTurnErrorInfo | None = None
    usage: TokenUsageInfo | None = None


class SessionTurnCancelledEvent(_SessionTurnLifecycleEvent):
    type: Literal["session.turn.cancelled"]
    usage: TokenUsageInfo | None = None


class _SessionStatusEvent(BaseSessionEvent):
    session: SessionInfo

    @property
    def status(self) -> SessionStatus:
        return self.session.status

    @property
    def error(self) -> str | None:
        return self.session.error


class SessionIdleEvent(_SessionStatusEvent):
    type: Literal["session.idle"]


class SessionInProgressEvent(_SessionStatusEvent):
    type: Literal["session.in_progress"]


class SessionFailedEvent(_SessionStatusEvent):
    type: Literal["session.failed"]


class SessionRequiresActionEvent(_SessionStatusEvent):
    type: Literal["session.requires_action"]
    session: SessionInfo


SessionStatusEvent: TypeAlias = (
    SessionIdleEvent | SessionInProgressEvent | SessionFailedEvent | SessionRequiresActionEvent
)


class SessionStateUploadErrorInfo(AgentAPIModel):
    code: StateUploadErrorCode
    message: str


class SessionStateUploadedEvent(BaseSessionEvent):
    type: Literal["session.state.uploaded"]


class SessionStateUploadFailedEvent(BaseSessionEvent):
    type: Literal["session.state.upload_failed"]
    error: SessionStateUploadErrorInfo


class SessionEnvironmentErrorInfo(AgentAPIModel):
    type: str
    code: str
    message: str


class SessionEnvironmentStateInfo(AgentAPIModel):
    id: str
    type: str
    status: EnvironmentStatus
    error: SessionEnvironmentErrorInfo | None = None


class _SessionEnvironmentEvent(BaseSessionEvent):
    environment: SessionEnvironmentStateInfo


class SessionEnvironmentPendingEvent(_SessionEnvironmentEvent):
    type: Literal["session.environment.pending"]


class SessionEnvironmentConnectedEvent(_SessionEnvironmentEvent):
    type: Literal["session.environment.connected"]


class SessionEnvironmentDisconnectedEvent(_SessionEnvironmentEvent):
    type: Literal["session.environment.disconnected"]


class SessionEnvironmentReadyEvent(_SessionEnvironmentEvent):
    """Deprecated compatibility model, excluded from current event streams."""

    type: Literal["agent.session.environment.ready"]


class SessionEnvironmentFailedEvent(_SessionEnvironmentEvent):
    type: Literal["session.environment.failed"]


class SessionSubagentCreatedEvent(BaseSessionEvent):
    type: Literal["session.subagent.created"]
    subagent: SubagentInfo


class SessionSubagentClosedEvent(BaseSessionEvent):
    type: Literal["session.subagent.closed"]
    subagent: SubagentInfo


class SessionThreadCreatedEvent(BaseSessionEvent):
    type: Literal["session.thread.created"]
    thread_id: str
    parent_thread_id: str | None
    agent_role: str | None
    agent_nickname: str | None
    created_by: CreatedByInfo | None


class SessionThreadStatusChangedEvent(BaseSessionEvent):
    type: Literal["session.thread.status_changed"]
    thread_id: str
    session_status: SessionStatus = Field(alias="status")
    error: str | None

    @property
    def status(self) -> SessionStatus:
        return self.session_status


class AgentOutputItemEvent(BaseSessionEvent):
    type: Literal["agent.output.item"]
    output_item: JsonObject = Field(alias="item")

    @property
    def item(self) -> JsonObject:
        return self.output_item


class SessionTurnItemAddedEvent(BaseSessionEvent):
    type: Literal["session.turn.item.added"]
    output_index: int | None = None
    output_item: JsonObject = Field(alias="item")

    @property
    def item(self) -> JsonObject:
        return self.output_item


class SessionTurnItemDoneEvent(BaseSessionEvent):
    type: Literal["session.turn.item.done"]
    output_index: int | None = None
    output_item: JsonObject = Field(alias="item")

    @property
    def item(self) -> JsonObject:
        return self.output_item


class AgentCommandExecutionOutputDeltaEvent(BaseSessionEvent):
    type: Literal["agent.output.command_execution_output.delta"]
    item_id: str
    output_index: int
    delta: str


class _OutputTextEvent(BaseSessionEvent):
    item_id: str
    output_index: int
    content_index: int


class SessionTurnOutputTextAddedEvent(_OutputTextEvent):
    type: Literal["session.turn.output_text.added"]


class SessionTurnContentPartAddedEvent(_OutputTextEvent):
    type: Literal["session.turn.content_part.added"]
    part: JsonObject


class SessionTurnContentPartDoneEvent(_OutputTextEvent):
    type: Literal["session.turn.content_part.done"]
    part: JsonObject


class SessionTurnOutputTextDeltaEvent(_OutputTextEvent):
    type: Literal["session.turn.output_text.delta"]
    delta: str


class SessionTurnOutputTextDoneEvent(_OutputTextEvent):
    type: Literal["session.turn.output_text.done"]
    text: str


class _ReasoningSummaryTextEvent(BaseSessionEvent):
    item_id: str
    output_index: int
    summary_index: int = Field(validation_alias=AliasChoices("summary_index", "content_index"))


class SessionTurnReasoningSummaryTextAddedEvent(_ReasoningSummaryTextEvent):
    type: Literal["session.turn.reasoning_summary_text.added"]


class SessionTurnReasoningSummaryPartAddedEvent(_ReasoningSummaryTextEvent):
    type: Literal["session.turn.reasoning_summary_part.added"]
    part: JsonObject


class SessionTurnReasoningSummaryPartDoneEvent(_ReasoningSummaryTextEvent):
    type: Literal["session.turn.reasoning_summary_part.done"]
    part: JsonObject
    part_status: Literal["incomplete"] | None = Field(default=None, alias="status")

    @property
    def status(self) -> Literal["incomplete"] | None:
        return self.part_status


class SessionTurnReasoningSummaryTextDeltaEvent(_ReasoningSummaryTextEvent):
    type: Literal["session.turn.reasoning_summary_text.delta"]
    delta: str


class SessionTurnReasoningSummaryTextDoneEvent(_ReasoningSummaryTextEvent):
    type: Literal["session.turn.reasoning_summary_text.done"]
    text: str


class AgentThreadMessageSentEvent(BaseSessionEvent):
    type: Literal["agent.thread.message.sent"]
    from_thread_id: str
    to_thread_id: str
    operation: SubagentTool
    created_by: CreatedByInfo


class AgentThreadMessageReceivedEvent(BaseSessionEvent):
    type: Literal["agent.thread.message.received"]
    from_thread_id: str
    to_thread_id: str
    operation: SubagentTool
    function_call_status: FunctionCallStatus = Field(alias="status")
    created_by: CreatedByInfo

    @property
    def status(self) -> FunctionCallStatus:
        return self.function_call_status


class SessionSubagentActiveEvent(BaseSessionEvent):
    type: Literal["session.subagent.active"]
    subagent: SubagentInfo


KnownSessionEvent: TypeAlias = Annotated[
    SessionErrorEvent
    | SessionCreatedEvent
    | SessionTurnCreatedEvent
    | SessionTurnInProgressEvent
    | SessionTurnCompletedEvent
    | SessionTurnFailedEvent
    | SessionTurnCancelledEvent
    | SessionIdleEvent
    | SessionInProgressEvent
    | SessionFailedEvent
    | SessionStateUploadedEvent
    | SessionStateUploadFailedEvent
    | SessionEnvironmentPendingEvent
    | SessionEnvironmentConnectedEvent
    | SessionEnvironmentDisconnectedEvent
    | SessionEnvironmentFailedEvent
    | SessionSubagentCreatedEvent
    | SessionSubagentClosedEvent
    | SessionThreadCreatedEvent
    | SessionThreadStatusChangedEvent
    | AgentOutputItemEvent
    | SessionTurnItemAddedEvent
    | SessionTurnItemDoneEvent
    | AgentCommandExecutionOutputDeltaEvent
    | SessionTurnOutputTextAddedEvent
    | SessionTurnContentPartAddedEvent
    | SessionTurnContentPartDoneEvent
    | SessionTurnOutputTextDeltaEvent
    | SessionTurnOutputTextDoneEvent
    | SessionTurnReasoningSummaryTextAddedEvent
    | SessionTurnReasoningSummaryPartAddedEvent
    | SessionTurnReasoningSummaryPartDoneEvent
    | SessionTurnReasoningSummaryTextDeltaEvent
    | SessionTurnReasoningSummaryTextDoneEvent
    | AgentThreadMessageSentEvent
    | AgentThreadMessageReceivedEvent
    | SessionRequiresActionEvent
    | SessionSubagentActiveEvent,
    Field(discriminator="type"),
]


class UnknownSessionEvent(BaseSessionEvent):
    """A forward-compatible envelope for an event type unknown to this SDK version."""


SessionEvent: TypeAlias = KnownSessionEvent | UnknownSessionEvent

_KNOWN_SESSION_EVENT_ADAPTER: TypeAdapter[KnownSessionEvent] = TypeAdapter(KnownSessionEvent)


def parse_session_event(
    payload: Mapping[str, JsonValue],
    *,
    event_name: str | None,
    event_id: str | None,
) -> SessionEvent:
    event_payload = dict(payload)
    if "event_id" not in event_payload and event_id is not None:
        event_payload["event_id"] = event_id
    _fill_event_envelope_fields(event_payload)
    enriched_payload = {
        **event_payload,
        "data": dict(payload),
        "event_name": event_name,
        "sse_event_id": event_id,
    }
    try:
        return _KNOWN_SESSION_EVENT_ADAPTER.validate_python(enriched_payload)
    except ValidationError as error:
        event_type = event_payload.get("type")
        known_types = get_args(OutputEventType)
        if isinstance(event_type, str) and event_type not in known_types:
            return UnknownSessionEvent.model_validate(enriched_payload)
        raise error


def _fill_event_envelope_fields(event_payload: JsonObject) -> None:
    session = event_payload.get("session")
    if "session_id" not in event_payload and isinstance(session, Mapping):
        session_id = session.get("id")
        if isinstance(session_id, str):
            event_payload["session_id"] = session_id

    turn = event_payload.get("turn")
    if isinstance(turn, Mapping):
        if "turn_id" not in event_payload:
            turn_id = turn.get("id")
            if isinstance(turn_id, str):
                event_payload["turn_id"] = turn_id
        if "session_id" not in event_payload:
            session_id = turn.get("session_id")
            if isinstance(session_id, str):
                event_payload["session_id"] = session_id

    subagent = event_payload.get("subagent")
    if "session_id" not in event_payload and isinstance(subagent, Mapping):
        session_id = subagent.get("session_id")
        if isinstance(session_id, str):
            event_payload["session_id"] = session_id


class AgentRunResult(AgentAPIModel):
    session: SessionInfo
    output_text: str
    events: tuple[SessionEvent, ...]
    output_items: tuple[JsonObject, ...]

    @property
    def failed(self) -> bool:
        """Report failed or cancelled turns even after the session returns to idle."""
        return self.session.status == "failed" or any(
            isinstance(
                event,
                (SessionTurnFailedEvent, SessionTurnCancelledEvent, SessionFailedEvent),
            )
            for event in self.events
        )

    @property
    def turn_error(self) -> SessionTurnErrorInfo | None:
        """Return the most recent structured turn failure, when one was provided."""
        for event in reversed(self.events):
            if isinstance(event, SessionTurnFailedEvent):
                if event.error is not None:
                    return event.error
                turn = event.turn_info
                return turn.error if turn is not None else None
        return None

    def raise_for_status(self) -> None:
        """Raise for a failed session or turn without changing normal result handling."""
        if not self.failed:
            return
        error = self.turn_error
        if error is not None:
            message = f"Agent turn failed ({error.code}): {error.message}"
        elif any(isinstance(event, SessionTurnCancelledEvent) for event in self.events):
            message = "The agent turn was cancelled."
        elif self.session.error is not None:
            message = f"Agent session failed: {self.session.error}"
        else:
            message = "The agent session or turn failed."
        raise AgentAPIResponseError(message)


def input_messages(input: InputLike) -> list[JsonValue]:
    if isinstance(input, str):
        messages: list[JsonValue] = [
            {
                "role": "user",
                "content": [{"type": "input_text", "text": input}],
            }
        ]
    elif isinstance(input, Mapping):
        messages = [_json_object(input)]
    else:
        messages = [_json_object(message) for message in input]

    has_content = False
    for message in messages:
        if not isinstance(message, Mapping) or message.get("role") != "user":
            raise AgentAPIConfigurationError("only user messages are supported")
        content = message.get("content")
        if not isinstance(content, Sequence) or isinstance(content, (str, bytes)):
            raise AgentAPIConfigurationError("input messages must include content")
        for item in content:
            has_content = True
            if not isinstance(item, Mapping):
                raise AgentAPIConfigurationError("input content must be input_text or input_image")
            if item.get("type") == "input_text":
                text = item.get("text")
                if not isinstance(text, str) or not text:
                    raise AgentAPIConfigurationError(
                        "input_text content must include non-empty text"
                    )
            elif item.get("type") == "input_image":
                image_url = item.get("image_url")
                if not isinstance(image_url, str) or not image_url:
                    raise AgentAPIConfigurationError(
                        "input_image content must include a non-empty image_url"
                    )
            else:
                raise AgentAPIConfigurationError("input content must be input_text or input_image")
    if not has_content:
        raise AgentAPIConfigurationError(
            "session.input.message must include at least one content item"
        )
    return messages


def _json_object(value: Mapping[str, object]) -> JsonObject:
    return cast(JsonObject, dict(value))
