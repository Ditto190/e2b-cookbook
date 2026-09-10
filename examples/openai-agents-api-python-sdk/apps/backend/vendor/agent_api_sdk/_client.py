from __future__ import annotations

import json
from collections.abc import AsyncGenerator, Awaitable, Callable, Mapping
from contextlib import aclosing
from typing import Any, cast
from urllib.parse import quote

import httpx

from agent_api_sdk._errors import (
    AgentAPIError,
    AgentAPIResponseError,
)
from agent_api_sdk._sse import aiter_sse
from agent_api_sdk._types import JsonObject, SessionEvent, parse_session_event


class _AgentAPIClient:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        timeout: float | httpx.Timeout,
        http_client: httpx.AsyncClient | None,
        organization: str | None = None,
        project: str | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_root_url = _api_root_url(self._base_url)
        headers = httpx.Headers(
            {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }
        )
        if organization is not None:
            headers["OpenAI-Organization"] = organization
        if project is not None:
            headers["OpenAI-Project"] = project
        self._headers = headers
        self._http = http_client or httpx.AsyncClient(timeout=timeout)
        self._owns_http = http_client is None

    async def aclose(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    async def request(
        self,
        method: str,
        path: str,
        body: JsonObject | None = None,
        *,
        params: Mapping[str, str | int | float | bool | None] | None = None,
        idempotency_key: str | None = None,
    ) -> JsonObject:
        headers = self._headers.copy()
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        response = await self._http.request(
            method,
            self._url(path),
            json=body,
            params=_query_params(params),
            headers=headers,
        )
        return _decode_response(response)

    async def vault_request(
        self,
        method: str,
        path: str,
        body: JsonObject | None = None,
        *,
        params: Mapping[str, str | int | float | bool | None] | None = None,
    ) -> JsonObject:
        response = await self._http.request(
            method,
            self._vault_url(path),
            json=body,
            params=_query_params(params),
            headers=self._headers,
        )
        return _decode_response(response)

    async def download(self, path: str) -> bytes:
        return b"".join([chunk async for chunk in self.stream_download(path)])

    async def stream_download(self, path: str) -> AsyncGenerator[bytes, None]:
        async with self._http.stream(
            "GET",
            self._url(path),
            headers=self._headers,
            follow_redirects=False,
        ) as response:
            if not response.is_redirect:
                if not response.is_success:
                    await response.aread()
                    raise AgentAPIError.from_response(response)
                async for chunk in response.aiter_bytes():
                    yield chunk
                return

            location = response.headers.get("Location")
            if location is None:
                raise AgentAPIResponseError(
                    "State download redirect did not include a Location header."
                )
            redirect_url = response.url.join(location)

        request_template = self._http.build_request("GET", redirect_url)
        request = httpx.Request(
            "GET",
            redirect_url,
            headers={"Accept": "application/octet-stream"},
            extensions=request_template.extensions,
        )
        redirected = await self._http.send(
            request,
            stream=True,
            auth=None,
            follow_redirects=True,
        )
        try:
            if not redirected.is_success:
                await redirected.aread()
                raise AgentAPIError.from_response(redirected)
            async for chunk in redirected.aiter_bytes():
                yield chunk
        finally:
            await redirected.aclose()

    async def stream_events(
        self,
        session_id: str,
        *,
        on_open: Callable[[], Awaitable[None]] | None = None,
        replay_last_turn: bool = False,
    ) -> AsyncGenerator[SessionEvent, None]:
        async with aclosing(
            self._stream_events(
                "GET",
                f"/sessions/{path_segment(session_id)}/events",
                stream=True,
                on_open=on_open,
                replay_last_turn=replay_last_turn,
            )
        ) as events:
            async for event in events:
                yield event

    async def stream_create_session(
        self,
        body: JsonObject,
    ) -> AsyncGenerator[SessionEvent, None]:
        async with aclosing(
            self._stream_events(
                "POST",
                "/sessions",
                body=body,
            )
        ) as events:
            async for event in events:
                yield event

    async def _stream_events(
        self,
        method: str,
        path: str,
        *,
        stream: bool = False,
        body: JsonObject | None = None,
        on_open: Callable[[], Awaitable[None]] | None = None,
        replay_last_turn: bool = False,
    ) -> AsyncGenerator[SessionEvent, None]:
        request_kwargs: dict[str, Any] = {
            "headers": {**self._headers, "Accept": "text/event-stream"},
        }
        if stream:
            request_kwargs["params"] = {
                "stream": "true",
                **({"replay_last_turn": "true"} if replay_last_turn else {}),
            }
        if body is not None:
            request_kwargs["json"] = body
        async with self._http.stream(
            method,
            self._url(path),
            **request_kwargs,
        ) as response:
            if not response.is_success:
                await response.aread()
                raise AgentAPIError.from_response(response)
            if on_open is not None:
                await on_open()
            async for sse_event in aiter_sse(response.aiter_lines()):
                payload = _decode_event_data(sse_event.data)
                yield parse_session_event(
                    payload,
                    event_name=sse_event.event,
                    event_id=sse_event.event_id,
                )

    def _url(self, path: str) -> str:
        return f"{self._base_url}/{path.lstrip('/')}"

    def _vault_url(self, path: str) -> str:
        suffix = path.strip("/")
        return f"{self._api_root_url}/vaults{f'/{suffix}' if suffix else ''}"


def path_segment(value: str) -> str:
    return quote(value, safe="")


def _api_root_url(agents_base_url: str) -> str:
    return agents_base_url.removesuffix("/agents")


def _query_params(
    params: Mapping[str, str | int | float | bool | None] | None,
) -> dict[str, str | int | float | bool] | None:
    if params is None:
        return None
    return {key: value for key, value in params.items() if value is not None}


def _decode_response(response: httpx.Response) -> JsonObject:
    if not response.is_success:
        raise AgentAPIError.from_response(response)
    if not response.content:
        return {}
    try:
        payload = response.json()
    except ValueError as exc:
        raise AgentAPIResponseError("API response was not valid JSON.") from exc
    if not isinstance(payload, dict):
        raise AgentAPIResponseError("API response was not a JSON object.")
    return cast(JsonObject, payload)


def _decode_event_data(data: str) -> JsonObject:
    try:
        payload = json.loads(data)
    except ValueError as exc:
        raise AgentAPIResponseError("SSE event data was not valid JSON.") from exc
    if not isinstance(payload, dict):
        raise AgentAPIResponseError("SSE event data was not a JSON object.")
    return cast(JsonObject, payload)
