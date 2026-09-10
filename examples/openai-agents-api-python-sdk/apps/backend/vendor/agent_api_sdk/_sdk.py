from __future__ import annotations

import os
from collections.abc import AsyncGenerator, Mapping, Sequence
from contextlib import aclosing
from copy import deepcopy
from typing import cast

import httpx

from agent_api_sdk._client import _AgentAPIClient, path_segment
from agent_api_sdk._errors import AgentAPIConfigurationError, AgentAPIError, AgentAPIResponseError
from agent_api_sdk._session import (
    AsyncAgentSession,
    AsyncToolHandler,
    run_result,
)
from agent_api_sdk._types import (
    AgentInfo,
    AgentList,
    AgentParam,
    AgentRunResult,
    DeletedAgentInfo,
    DeletedSessionInfo,
    DeletedTelemetryExporterInfo,
    DeletedVaultCredentialInfo,
    DeletedVaultInfo,
    EnvironmentParam,
    InputLike,
    JsonObject,
    MultiAgentParam,
    OpenAIManagedVaultCredentialSourceParam,
    PersistedAgentToolParam,
    ReasoningParam,
    RetentionPolicyParam,
    RotateVaultCredentialAuthParam,
    ServiceTier,
    SessionCreatedEvent,
    SessionEvent,
    SessionInfo,
    SessionItemList,
    SessionItemListOrder,
    SessionList,
    SessionListOrder,
    SessionSubagentList,
    SessionTurnList,
    SessionTurnListOrder,
    SubagentInfo,
    TelemetryExporterInfo,
    TelemetryExporterList,
    TelemetryExporterProtocol,
    TextParam,
    TracingConfigParam,
    TurnInfo,
    VaultCredentialAuthParam,
    VaultCredentialInfo,
    VaultCredentialList,
    VaultInfo,
    VaultList,
    input_messages,
)

_DEFAULT_BASE_URL = "https://api.openai.com/v1/agents"
_DEFAULT_TIMEOUT_SECONDS = 600.0


_NOT_GIVEN = object()


class AsyncAgentsResource:
    def __init__(self, client: _AgentAPIClient) -> None:
        self._client = client

    async def create(
        self,
        *,
        instructions: str | None = None,
        model: str,
        multi_agent: MultiAgentParam | None = None,
        reasoning: ReasoningParam | None = None,
        service_tier: ServiceTier | None = None,
        text: TextParam | None = None,
        tools: Sequence[PersistedAgentToolParam] | None = None,
        name: str | None = None,
    ) -> AgentInfo:
        # HTTPX normalizes this dot segment to the exact /v1/agents collection URL.
        payload = await self._client.request(
            "POST",
            ".",
            _json_object(
                {
                    **({"instructions": instructions} if instructions is not None else {}),
                    "model": model,
                    **({"multi_agent": multi_agent} if multi_agent is not None else {}),
                    **({"reasoning": reasoning} if reasoning is not None else {}),
                    **({"service_tier": service_tier} if service_tier is not None else {}),
                    **({"text": text} if text is not None else {}),
                    **({"tools": tools} if tools is not None else {}),
                    **({"name": name} if name is not None else {}),
                }
            ),
        )
        return AgentInfo.model_validate(payload)

    async def list(
        self,
        *,
        cursor: str | None = None,
        limit: int | None = None,
        order: SessionListOrder | None = None,
    ) -> AgentList:
        payload = await self._client.request(
            "GET",
            ".",
            params={
                **({"cursor": cursor} if cursor is not None else {}),
                **({"limit": limit} if limit is not None else {}),
                **({"order": order} if order is not None else {}),
            },
        )
        return AgentList.model_validate(payload)

    async def retrieve(self, agent_id: str) -> AgentInfo:
        payload = await self._client.request("GET", f"/{path_segment(agent_id)}")
        return AgentInfo.model_validate(payload)

    async def update(
        self,
        agent_id: str,
        *,
        instructions: str | None = cast(str | None, _NOT_GIVEN),
        model: str | None = cast(str | None, _NOT_GIVEN),
        multi_agent: MultiAgentParam | None = cast(MultiAgentParam | None, _NOT_GIVEN),
        reasoning: ReasoningParam | None = cast(ReasoningParam | None, _NOT_GIVEN),
        service_tier: ServiceTier | None = cast(ServiceTier | None, _NOT_GIVEN),
        text: TextParam | None = cast(TextParam | None, _NOT_GIVEN),
        tools: Sequence[PersistedAgentToolParam] | None = cast(
            Sequence[PersistedAgentToolParam] | None, _NOT_GIVEN
        ),
        name: str | None = cast(str | None, _NOT_GIVEN),
    ) -> AgentInfo:
        payload = await self._client.request(
            "POST",
            f"/{path_segment(agent_id)}",
            _json_object(
                {
                    **({"instructions": instructions} if instructions is not _NOT_GIVEN else {}),
                    **({"model": model} if model is not _NOT_GIVEN else {}),
                    **({"multi_agent": multi_agent} if multi_agent is not _NOT_GIVEN else {}),
                    **({"reasoning": reasoning} if reasoning is not _NOT_GIVEN else {}),
                    **({"service_tier": service_tier} if service_tier is not _NOT_GIVEN else {}),
                    **({"text": text} if text is not _NOT_GIVEN else {}),
                    **({"tools": tools} if tools is not _NOT_GIVEN else {}),
                    **({"name": name} if name is not _NOT_GIVEN else {}),
                }
            ),
        )
        return AgentInfo.model_validate(payload)

    async def delete(self, agent_id: str) -> DeletedAgentInfo:
        payload = await self._client.request("DELETE", f"/{path_segment(agent_id)}")
        return DeletedAgentInfo.model_validate(payload)


class AsyncSessionTurnsResource:
    def __init__(self, client: _AgentAPIClient) -> None:
        self._client = client

    async def list(
        self,
        session_id: str,
        *,
        after: str | None = None,
        limit: int | None = None,
        order: SessionTurnListOrder | None = None,
    ) -> SessionTurnList:
        payload = await self._client.request(
            "GET",
            f"/sessions/{path_segment(session_id)}/turns",
            params={
                **({"after": after} if after is not None else {}),
                **({"limit": limit} if limit is not None else {}),
                **({"order": order} if order is not None else {}),
            },
        )
        return SessionTurnList.model_validate(payload)

    async def retrieve(self, session_id: str, turn_id: str) -> TurnInfo:
        payload = await self._client.request(
            "GET",
            f"/sessions/{path_segment(session_id)}/turns/{path_segment(turn_id)}",
        )
        return TurnInfo.model_validate(payload)


class AsyncSessionSubagentTurnsResource:
    def __init__(self, client: _AgentAPIClient) -> None:
        self._client = client

    async def list(
        self,
        session_id: str,
        subagent_id: str,
        *,
        limit: int | None = None,
        order: SessionListOrder | None = None,
        after: str | None = None,
    ) -> SessionTurnList:
        payload = await self._client.request(
            "GET",
            f"/sessions/{path_segment(session_id)}/subagents/{path_segment(subagent_id)}/turns",
            params={
                **({"limit": limit} if limit is not None else {}),
                **({"order": order} if order is not None else {}),
                **({"after": after} if after is not None else {}),
            },
        )
        return SessionTurnList.model_validate(payload)

    async def retrieve(
        self,
        session_id: str,
        subagent_id: str,
        turn_id: str,
    ) -> TurnInfo:
        payload = await self._client.request(
            "GET",
            f"/sessions/{path_segment(session_id)}/subagents/{path_segment(subagent_id)}/turns/{path_segment(turn_id)}",
        )
        return TurnInfo.model_validate(payload)

    async def list_items(
        self,
        session_id: str,
        subagent_id: str,
        turn_id: str,
        *,
        limit: int | None = None,
        order: SessionItemListOrder | None = None,
        after: str | None = None,
    ) -> SessionItemList:
        payload = await self._client.request(
            "GET",
            f"/sessions/{path_segment(session_id)}/subagents/{path_segment(subagent_id)}/turns/{path_segment(turn_id)}/items",
            params={
                **({"limit": limit} if limit is not None else {}),
                **({"order": order} if order is not None else {}),
                **({"after": after} if after is not None else {}),
            },
        )
        return SessionItemList.model_validate(payload)


class AsyncSessionSubagentsResource:
    def __init__(self, client: _AgentAPIClient) -> None:
        self._client = client
        self.turns = AsyncSessionSubagentTurnsResource(client)

    async def list(
        self,
        session_id: str,
        *,
        limit: int | None = None,
        order: SessionListOrder | None = None,
        after: str | None = None,
    ) -> SessionSubagentList:
        payload = await self._client.request(
            "GET",
            f"/sessions/{path_segment(session_id)}/subagents",
            params={
                **({"limit": limit} if limit is not None else {}),
                **({"order": order} if order is not None else {}),
                **({"after": after} if after is not None else {}),
            },
        )
        return SessionSubagentList.model_validate(payload)

    async def retrieve(
        self,
        session_id: str,
        subagent_id: str,
    ) -> SubagentInfo:
        payload = await self._client.request(
            "GET", f"/sessions/{path_segment(session_id)}/subagents/{path_segment(subagent_id)}"
        )
        return SubagentInfo.model_validate(payload)

    async def list_items(
        self,
        session_id: str,
        subagent_id: str,
        *,
        limit: int | None = None,
        order: SessionItemListOrder | None = None,
        after: str | None = None,
    ) -> SessionItemList:
        payload = await self._client.request(
            "GET",
            f"/sessions/{path_segment(session_id)}/subagents/{path_segment(subagent_id)}/items",
            params={
                **({"limit": limit} if limit is not None else {}),
                **({"order": order} if order is not None else {}),
                **({"after": after} if after is not None else {}),
            },
        )
        return SessionItemList.model_validate(payload)


class AsyncSessionsResource:
    def __init__(self, client: _AgentAPIClient) -> None:
        self._client = client
        self.turns = AsyncSessionTurnsResource(client)
        self.subagents = AsyncSessionSubagentsResource(client)

    async def create(
        self,
        *,
        agent: AgentParam | None = None,
        environment: EnvironmentParam,
        vault_ids: Sequence[str] | None = None,
        input: InputLike | None = None,
        retention_policy: RetentionPolicyParam | None = None,
        tracing: TracingConfigParam | None = None,
        agent_id: str | None = None,
    ) -> AsyncAgentSession:
        body = _session_body(
            agent=agent,
            environment=environment,
            vault_ids=vault_ids,
            input=input,
            retention_policy=retention_policy,
            tracing=tracing,
            agent_id=agent_id,
        )
        try:
            payload = await self._client.request("POST", "/sessions", body)
        except AgentAPIError as error:
            if not _requires_legacy_session_body(error):
                raise
            payload = await self._client.request("POST", "/sessions", _legacy_session_body(body))
        info = SessionInfo.from_payload(payload)
        return AsyncAgentSession(
            client=self._client,
            info=info,
        )

    async def create_stream(
        self,
        *,
        agent: AgentParam | None = None,
        environment: EnvironmentParam,
        vault_ids: Sequence[str] | None = None,
        input: InputLike | None = None,
        retention_policy: RetentionPolicyParam | None = None,
        tracing: TracingConfigParam | None = None,
        agent_id: str | None = None,
    ) -> AsyncGenerator[SessionEvent, None]:
        body = _session_body(
            agent=agent,
            environment=environment,
            vault_ids=vault_ids,
            input=input,
            retention_policy=retention_policy,
            tracing=tracing,
            stream=True,
            agent_id=agent_id,
        )
        try:
            async with aclosing(self._client.stream_create_session(body)) as events:
                async for event in events:
                    yield event
        except AgentAPIError as error:
            if not _requires_legacy_session_body(error):
                raise
            async with aclosing(
                self._client.stream_create_session(_legacy_session_body(body))
            ) as events:
                async for event in events:
                    yield event

    async def retrieve(self, session_id: str) -> AsyncAgentSession:
        payload = await self._client.request("GET", f"/sessions/{path_segment(session_id)}", None)
        info = SessionInfo.from_payload(payload)
        return AsyncAgentSession(
            client=self._client,
            info=info,
        )

    async def list(
        self,
        *,
        cursor: str | None = None,
        limit: int | None = None,
        order: SessionListOrder | None = None,
    ) -> SessionList:
        payload = await self._client.request(
            "GET",
            "/sessions",
            params={"cursor": cursor, "limit": limit, "order": order},
        )
        return SessionList.from_payload(payload)

    async def delete(self, session_id: str) -> DeletedSessionInfo:
        payload = await self._client.request(
            "DELETE",
            f"/sessions/{path_segment(session_id)}",
            None,
        )
        return DeletedSessionInfo.model_validate(payload)

    async def update(
        self,
        session_id: str,
        *,
        state_upload_url: str | None,
    ) -> SessionInfo:
        payload = await self._client.request(
            "POST",
            f"/sessions/{path_segment(session_id)}",
            {"state_upload_url": state_upload_url},
        )
        return SessionInfo.from_payload(payload)

    async def download_state(self, session_id: str) -> bytes:
        return await self._client.download(f"/sessions/{path_segment(session_id)}/state")

    async def stream_state(self, session_id: str) -> AsyncGenerator[bytes, None]:
        async with aclosing(
            self._client.stream_download(f"/sessions/{path_segment(session_id)}/state")
        ) as chunks:
            async for chunk in chunks:
                yield chunk

    async def list_items(
        self,
        session_id: str,
        *,
        limit: int | None = None,
        after: str | None = None,
        order: SessionItemListOrder | None = None,
    ) -> SessionItemList:
        payload = await self._client.request(
            "GET",
            f"/sessions/{path_segment(session_id)}/items",
            params={"limit": limit, "after": after, "order": order},
        )
        return SessionItemList.model_validate(payload)

    async def stream_events(
        self,
        session_id: str,
    ) -> AsyncGenerator[SessionEvent, None]:
        async with aclosing(self._client.stream_events(session_id)) as events:
            async for event in events:
                yield event

    async def events(
        self,
        session_id: str,
    ) -> AsyncGenerator[SessionEvent, None]:
        """Stream session events (alias for stream_events)."""
        async with aclosing(self.stream_events(session_id)) as events:
            async for event in events:
                yield event


class AsyncTelemetryExportersResource:
    def __init__(self, client: _AgentAPIClient) -> None:
        self._client = client

    async def create(
        self,
        *,
        name: str,
        endpoint: str,
        protocol: TelemetryExporterProtocol | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> TelemetryExporterInfo:
        body: JsonObject = {
            "name": name,
            "endpoint": endpoint,
            **({"protocol": protocol} if protocol is not None else {}),
            **({"headers": dict(headers)} if headers is not None else {}),
        }
        payload = await self._client.request("POST", "/telemetry/exporters", body)
        return self._validate_exporter(payload)

    async def list(
        self,
        *,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> TelemetryExporterList:
        payload = await self._client.request(
            "GET",
            "/telemetry/exporters",
            params={
                **({"cursor": cursor} if cursor is not None else {}),
                **({"limit": limit} if limit is not None else {}),
            },
        )
        data = payload.get("data")
        if isinstance(data, Sequence) and not isinstance(data, (str, bytes)):
            for exporter in data:
                if isinstance(exporter, Mapping) and "headers" in exporter:
                    raise AgentAPIResponseError(
                        "Telemetry exporter response included write-only headers."
                    )
        return TelemetryExporterList.model_validate(payload)

    async def retrieve(self, exporter_id: str) -> TelemetryExporterInfo:
        payload = await self._client.request(
            "GET", f"/telemetry/exporters/{path_segment(exporter_id)}"
        )
        return self._validate_exporter(payload)

    async def update(
        self,
        exporter_id: str,
        *,
        name: str | None = cast(str | None, _NOT_GIVEN),
        endpoint: str | None = cast(str | None, _NOT_GIVEN),
        protocol: TelemetryExporterProtocol | None = cast(
            TelemetryExporterProtocol | None, _NOT_GIVEN
        ),
        headers: Mapping[str, str | None] | None = cast(
            Mapping[str, str | None] | None, _NOT_GIVEN
        ),
    ) -> TelemetryExporterInfo:
        body: JsonObject = {
            **({"name": name} if name is not _NOT_GIVEN else {}),
            **({"endpoint": endpoint} if endpoint is not _NOT_GIVEN else {}),
            **({"protocol": protocol} if protocol is not _NOT_GIVEN else {}),
        }
        if headers is not _NOT_GIVEN:
            body["headers"] = None if headers is None else dict(headers)
        payload = await self._client.request(
            "POST", f"/telemetry/exporters/{path_segment(exporter_id)}", body
        )
        return self._validate_exporter(payload)

    async def delete(self, exporter_id: str) -> DeletedTelemetryExporterInfo:
        payload = await self._client.request(
            "DELETE", f"/telemetry/exporters/{path_segment(exporter_id)}"
        )
        return DeletedTelemetryExporterInfo.model_validate(payload)

    @staticmethod
    def _validate_exporter(payload: JsonObject) -> TelemetryExporterInfo:
        if "headers" in payload:
            raise AgentAPIResponseError("Telemetry exporter response included write-only headers.")
        return TelemetryExporterInfo.model_validate(payload)


class AsyncTelemetryResource:
    def __init__(self, client: _AgentAPIClient) -> None:
        self._client = client
        self.exporters = AsyncTelemetryExportersResource(client)


class AsyncVaultCredentialsResource:
    def __init__(self, client: _AgentAPIClient) -> None:
        self._client = client

    async def create(
        self,
        vault_id: str,
        *,
        display_name: str,
        auth: VaultCredentialAuthParam,
        source: OpenAIManagedVaultCredentialSourceParam | None = None,
    ) -> VaultCredentialInfo:
        payload = await self._client.vault_request(
            "POST",
            f"/{path_segment(vault_id)}/credentials",
            {
                "display_name": display_name,
                "auth": _json_object(auth),
                "source": _json_object(source or {"type": "openai_managed"}),
            },
        )
        return VaultCredentialInfo.model_validate(payload)

    async def list(
        self,
        vault_id: str,
        *,
        cursor: str | None = None,
        limit: int | None = None,
        include_archived: bool = False,
    ) -> VaultCredentialList:
        payload = await self._client.vault_request(
            "GET",
            f"/{path_segment(vault_id)}/credentials",
            params={
                "cursor": cursor,
                "limit": limit,
                "include_archived": include_archived,
            },
        )
        return VaultCredentialList.model_validate(payload)

    async def retrieve(self, vault_id: str, credential_id: str) -> VaultCredentialInfo:
        payload = await self._client.vault_request(
            "GET",
            f"/{path_segment(vault_id)}/credentials/{path_segment(credential_id)}",
        )
        return VaultCredentialInfo.model_validate(payload)

    async def rotate(
        self,
        vault_id: str,
        credential_id: str,
        *,
        auth: RotateVaultCredentialAuthParam,
    ) -> VaultCredentialInfo:
        payload = await self._client.vault_request(
            "POST",
            f"/{path_segment(vault_id)}/credentials/{path_segment(credential_id)}",
            {"auth": _json_object(auth)},
        )
        return VaultCredentialInfo.model_validate(payload)

    async def archive(self, vault_id: str, credential_id: str) -> VaultCredentialInfo:
        payload = await self._client.vault_request(
            "POST",
            f"/{path_segment(vault_id)}/credentials/{path_segment(credential_id)}/archive",
        )
        return VaultCredentialInfo.model_validate(payload)

    async def delete(self, vault_id: str, credential_id: str) -> DeletedVaultCredentialInfo:
        payload = await self._client.vault_request(
            "DELETE",
            f"/{path_segment(vault_id)}/credentials/{path_segment(credential_id)}",
        )
        return DeletedVaultCredentialInfo.model_validate(payload)


class AsyncVaultsResource:
    def __init__(self, client: _AgentAPIClient) -> None:
        self._client = client
        self.credentials = AsyncVaultCredentialsResource(client)

    async def create(
        self,
        *,
        display_name: str,
        metadata: Mapping[str, str] | None = None,
    ) -> VaultInfo:
        body: JsonObject = {"display_name": display_name}
        if metadata is not None:
            body["metadata"] = dict(metadata)
        payload = await self._client.vault_request("POST", "", body)
        return VaultInfo.model_validate(payload)

    async def list(
        self,
        *,
        cursor: str | None = None,
        limit: int | None = None,
        include_archived: bool = False,
    ) -> VaultList:
        payload = await self._client.vault_request(
            "GET",
            "",
            params={
                "cursor": cursor,
                "limit": limit,
                "include_archived": include_archived,
            },
        )
        return VaultList.model_validate(payload)

    async def retrieve(self, vault_id: str) -> VaultInfo:
        payload = await self._client.vault_request("GET", f"/{path_segment(vault_id)}")
        return VaultInfo.model_validate(payload)

    async def archive(self, vault_id: str) -> VaultInfo:
        payload = await self._client.vault_request(
            "POST",
            f"/{path_segment(vault_id)}/archive",
        )
        return VaultInfo.model_validate(payload)

    async def delete(self, vault_id: str) -> DeletedVaultInfo:
        payload = await self._client.vault_request("DELETE", f"/{path_segment(vault_id)}")
        return DeletedVaultInfo.model_validate(payload)


class AgentAPISDK:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float | httpx.Timeout | None = None,
        http_client: httpx.AsyncClient | None = None,
        organization: str | None = None,
        project: str | None = None,
    ) -> None:
        self._client = _AgentAPIClient(
            api_key=_resolve_api_key(api_key),
            base_url=_resolve_base_url(base_url),
            timeout=timeout or _DEFAULT_TIMEOUT_SECONDS,
            http_client=http_client,
            organization=organization or os.environ.get("OPENAI_ORG_ID"),
            project=project or os.environ.get("OPENAI_PROJECT_ID"),
        )
        self.sessions = AsyncSessionsResource(self._client)
        self.agents = AsyncAgentsResource(self._client)
        self.telemetry = AsyncTelemetryResource(self._client)
        self.vaults = AsyncVaultsResource(self._client)

    async def __aenter__(self) -> "AgentAPISDK":
        return self

    async def __aexit__(self, exc_type: object, exc_value: object, traceback: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def create_session(
        self,
        *,
        agent: AgentParam | None = None,
        environment: EnvironmentParam,
        vault_ids: Sequence[str] | None = None,
        input: InputLike | None = None,
        retention_policy: RetentionPolicyParam | None = None,
        tracing: TracingConfigParam | None = None,
        agent_id: str | None = None,
    ) -> AsyncAgentSession:
        return await self.sessions.create(
            agent=agent,
            environment=environment,
            vault_ids=vault_ids,
            input=input,
            retention_policy=retention_policy,
            tracing=tracing,
            agent_id=agent_id,
        )

    async def create_session_stream(
        self,
        *,
        agent: AgentParam | None = None,
        environment: EnvironmentParam,
        vault_ids: Sequence[str] | None = None,
        input: InputLike | None = None,
        retention_policy: RetentionPolicyParam | None = None,
        tracing: TracingConfigParam | None = None,
        agent_id: str | None = None,
    ) -> AsyncGenerator[SessionEvent, None]:
        async with aclosing(
            self.sessions.create_stream(
                agent=agent,
                environment=environment,
                vault_ids=vault_ids,
                input=input,
                retention_policy=retention_policy,
                tracing=tracing,
                agent_id=agent_id,
            )
        ) as events:
            async for event in events:
                yield event

    async def retrieve_session(self, session_id: str) -> AsyncAgentSession:
        return await self.sessions.retrieve(session_id)

    async def list_sessions(
        self,
        *,
        cursor: str | None = None,
        limit: int | None = None,
        order: SessionListOrder | None = None,
    ) -> SessionList:
        return await self.sessions.list(cursor=cursor, limit=limit, order=order)

    async def delete_session(self, session_id: str) -> DeletedSessionInfo:
        return await self.sessions.delete(session_id)

    async def update_session(
        self,
        session_id: str,
        *,
        state_upload_url: str | None,
    ) -> SessionInfo:
        return await self.sessions.update(
            session_id,
            state_upload_url=state_upload_url,
        )

    async def download_session_state(self, session_id: str) -> bytes:
        return await self.sessions.download_state(session_id)

    async def stream_session_state(self, session_id: str) -> AsyncGenerator[bytes, None]:
        async with aclosing(self.sessions.stream_state(session_id)) as chunks:
            async for chunk in chunks:
                yield chunk

    async def list_session_items(
        self,
        session_id: str,
        *,
        limit: int | None = None,
        after: str | None = None,
        order: SessionItemListOrder | None = None,
    ) -> SessionItemList:
        return await self.sessions.list_items(
            session_id,
            limit=limit,
            after=after,
            order=order,
        )

    async def list_session_turns(
        self,
        session_id: str,
        *,
        after: str | None = None,
        limit: int | None = None,
        order: SessionTurnListOrder | None = None,
    ) -> SessionTurnList:
        return await self.sessions.turns.list(
            session_id,
            after=after,
            limit=limit,
            order=order,
        )

    async def retrieve_session_turn(self, session_id: str, turn_id: str) -> TurnInfo:
        return await self.sessions.turns.retrieve(session_id, turn_id)

    async def stream_session_events(
        self,
        session_id: str,
    ) -> AsyncGenerator[SessionEvent, None]:
        async with aclosing(self.sessions.stream_events(session_id)) as events:
            async for event in events:
                yield event

    async def stream(
        self,
        *,
        agent: AgentParam | None = None,
        environment: EnvironmentParam,
        input: InputLike,
        vault_ids: Sequence[str] | None = None,
        retention_policy: RetentionPolicyParam | None = None,
        tracing: TracingConfigParam | None = None,
        tool_handlers: Mapping[str, AsyncToolHandler] | None = None,
        agent_id: str | None = None,
    ) -> AsyncGenerator[SessionEvent, None]:
        async with aclosing(
            self.sessions.create_stream(
                agent=agent,
                environment=environment,
                vault_ids=vault_ids,
                input=input,
                retention_policy=retention_policy,
                tracing=tracing,
                agent_id=agent_id,
            )
        ) as events:
            try:
                created = await anext(events)
            except StopAsyncIteration:
                raise AgentAPIResponseError(
                    "Session create stream ended before session.created."
                ) from None
            if not isinstance(created, SessionCreatedEvent):
                raise AgentAPIResponseError(
                    f"Session create stream returned {created.type} before session.created."
                )

            session = AsyncAgentSession(client=self._client, info=created.session)
            async with aclosing(
                session._stream_events_from(events, tool_handlers)
            ) as processed_events:
                async with aclosing(session._stream_one_run(processed_events)) as run_events:
                    async for event in run_events:
                        yield event

    async def run(
        self,
        *,
        agent: AgentParam | None = None,
        environment: EnvironmentParam,
        input: InputLike,
        vault_ids: Sequence[str] | None = None,
        retention_policy: RetentionPolicyParam | None = None,
        tracing: TracingConfigParam | None = None,
        tool_handlers: Mapping[str, AsyncToolHandler] | None = None,
        agent_id: str | None = None,
        raise_on_failure: bool = False,
    ) -> AgentRunResult:
        events = [
            event
            async for event in self.stream(
                agent=agent,
                environment=environment,
                input=input,
                vault_ids=vault_ids,
                retention_policy=retention_policy,
                tracing=tracing,
                tool_handlers=tool_handlers,
                agent_id=agent_id,
            )
        ]
        if not events:
            raise AgentAPIResponseError("Session create stream returned no run events.")
        session = await self.sessions.retrieve(events[-1].session_id)
        result = run_result(session.info, events)
        if raise_on_failure:
            result.raise_for_status()
        return result


def _session_body(
    *,
    agent: AgentParam | None = None,
    environment: EnvironmentParam,
    vault_ids: Sequence[str] | None = None,
    input: InputLike | None = None,
    retention_policy: RetentionPolicyParam | None = None,
    tracing: TracingConfigParam | None = None,
    stream: bool = False,
    agent_id: str | None = None,
) -> JsonObject:
    if agent is None and agent_id is None:
        raise AgentAPIConfigurationError("agent or agent_id must be provided")
    if agent_id is not None and not agent_id.strip():
        raise AgentAPIConfigurationError("agent_id must be a non-empty persisted agent ID")

    agent_body = _json_object(agent) if agent is not None else None
    model = agent_body.get("model") if agent_body is not None else None
    if agent_id is None and (not isinstance(model, str) or not model.strip()):
        raise AgentAPIConfigurationError("model is required without agent_id")

    if input is None and environment.get("type") == "none":
        raise AgentAPIConfigurationError(
            "conversation-only sessions currently require initial input"
        )

    body: JsonObject = {"environment": _json_object(environment)}
    if agent_body is not None:
        body["agent"] = agent_body
    if vault_ids is not None:
        body["vault_ids"] = list(vault_ids)
    if input is not None:
        messages = input_messages(input)
        if not messages:
            raise AgentAPIConfigurationError("initial input must include at least one message")
        has_content = False
        for message in messages:
            if not isinstance(message, Mapping) or message.get("role") != "user":
                raise AgentAPIConfigurationError("only user messages are supported")
            content = message.get("content")
            if not isinstance(content, Sequence) or isinstance(content, (str, bytes)):
                raise AgentAPIConfigurationError("initial input messages must include content")
            for item in content:
                has_content = True
                if not isinstance(item, Mapping):
                    raise AgentAPIConfigurationError(
                        "initial input content must be input_text or input_image"
                    )
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
                    raise AgentAPIConfigurationError(
                        "initial input content must be input_text or input_image"
                    )
        if not has_content:
            raise AgentAPIConfigurationError(
                "session.input.message must include at least one content item"
            )
        body["input"] = messages
    if retention_policy is not None:
        body["retention_policy"] = dict(retention_policy)
    if tracing is not None:
        body["tracing"] = dict(tracing)
    if agent_id is not None:
        body["agent_id"] = agent_id
    if stream:
        body["stream"] = True
    return body


def _requires_legacy_session_body(error: AgentAPIError) -> bool:
    if error.status_code != 400 or error.code != "invalid_request_error":
        return False
    if not (
        "Missing required parameter:" in error.message or "Unknown parameter:" in error.message
    ):
        return False
    return any(
        field in error.message
        for field in (
            "server_url",
            ".transport",
        )
    )


def _legacy_session_body(body: JsonObject) -> JsonObject:
    legacy = deepcopy(body)

    agent = legacy.get("agent")
    if not isinstance(agent, dict):
        return legacy

    tools = agent.get("tools")
    if not isinstance(tools, list):
        return legacy
    for tool in tools:
        if not isinstance(tool, dict) or tool.get("type") != "mcp":
            continue
        transport = tool.get("transport")
        if not isinstance(transport, dict) or transport.get("type") != "http":
            continue
        tool.pop("transport")
        for field in ("server_url", "authorization", "headers"):
            if field in transport:
                tool[field] = transport[field]

    return legacy


def _json_object(value: Mapping[str, object]) -> JsonObject:
    return cast(JsonObject, dict(value))


def _resolve_api_key(api_key: str | None) -> str:
    if api_key is not None:
        return api_key
    resolved = os.environ.get("OPENAI_API_KEY")
    if resolved is not None:
        return resolved
    raise AgentAPIConfigurationError("Set OPENAI_API_KEY or pass api_key= to use the Agents API.")


def _resolve_base_url(base_url: str | None) -> str:
    return base_url or os.environ.get("AGENT_API_BASE_URL") or _DEFAULT_BASE_URL
