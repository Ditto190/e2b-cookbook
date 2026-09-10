from __future__ import annotations

import asyncio
import inspect
import json
from collections.abc import AsyncGenerator, AsyncIterator, Awaitable, Callable, Mapping, Sequence
from contextlib import aclosing
from typing import Any, TypeAlias, cast

from agent_api_sdk._client import _AgentAPIClient, path_segment
from agent_api_sdk._errors import AgentAPIError, AgentAPIResponseError
from agent_api_sdk._types import (
    AgentRunResult,
    DeletedSessionInfo,
    InputLike,
    JsonObject,
    JsonValue,
    PreviousStateParam,
    SessionEvent,
    SessionInfo,
    SessionItemList,
    SessionItemListOrder,
    SessionStatus,
    SessionTurnList,
    SessionTurnListOrder,
    TurnInfo,
    input_messages,
)

AsyncToolHandler: TypeAlias = Callable[[JsonObject], JsonValue | Awaitable[JsonValue]]
_PENDING_TOOL_CALL_RETRY_DELAYS = (0.1, 0.3, 0.6)
_EXPIRED_RESTORE_FIRST_EVENT_TIMEOUT_SECONDS = 30.0


class AsyncAgentSession:
    def __init__(
        self,
        *,
        client: _AgentAPIClient,
        info: SessionInfo,
    ) -> None:
        self._client = client
        self.info = info
        self.id = info.id
        self.status = info.status
        self._completed_run_event_ids: set[str] = set()

    async def retrieve(self) -> SessionInfo:
        payload = await self._client.request("GET", f"/sessions/{path_segment(self.id)}", None)
        self.info = SessionInfo.from_payload(payload)
        self.status = self.info.status
        return self.info

    def _record_event(self, event: SessionEvent) -> None:
        info = getattr(event, "session", None)
        if isinstance(info, SessionInfo):
            payload = event.data.get("session")
            self.info = SessionInfo.from_payload(payload) if isinstance(payload, dict) else info
            self.status = self.info.status
            return
        if (
            event.type
            in {
                "session.idle",
                "session.in_progress",
                "session.failed",
                "session.requires_action",
            }
            and event.status is not None
        ):
            self.status = cast(SessionStatus, event.status)

    async def send_input(
        self,
        input: InputLike,
        *,
        previous_state: PreviousStateParam | None = None,
        state_upload_url: str | None = None,
        idempotency_key: str | None = None,
    ) -> None:
        await self._post_events(
            [{"type": "session.input.message", "input": input_messages(input)}],
            previous_state=previous_state,
            state_upload_url=state_upload_url,
            idempotency_key=idempotency_key,
        )

    async def send_cancel(self) -> None:
        await self._post_events([{"type": "session.input.cancel"}])

    async def send_tool_result(
        self,
        *,
        call_id: str,
        success: bool,
        turn_id: str,
        output: JsonValue | None = None,
        error: str | None = None,
    ) -> None:
        body: JsonObject = {
            "type": "session.input.tool_result",
            "turn_id": turn_id,
            "call_id": call_id,
            "success": success,
            "output": json.dumps(output, separators=(",", ":"))
            if isinstance(output, Mapping)
            else output,
            "error": error,
        }
        for delay in (*_PENDING_TOOL_CALL_RETRY_DELAYS, None):
            try:
                await self._post_events([body])
            except AgentAPIError as request_error:
                if (
                    delay is None
                    or request_error.status_code != 400
                    or request_error.code != "invalid_request_error"
                    or request_error.message != f"Unknown pending tool call: {call_id}"
                ):
                    raise
                await asyncio.sleep(delay)
            else:
                return

    async def input(
        self,
        input: InputLike,
        *,
        previous_state: PreviousStateParam | None = None,
        state_upload_url: str | None = None,
        idempotency_key: str | None = None,
    ) -> None:
        await self.send_input(
            input,
            previous_state=previous_state,
            state_upload_url=state_upload_url,
            idempotency_key=idempotency_key,
        )

    async def cancel(self) -> None:
        await self.send_cancel()

    async def tool_result(
        self,
        *,
        call_id: str,
        success: bool,
        turn_id: str,
        output: JsonValue | None = None,
        error: str | None = None,
    ) -> None:
        await self.send_tool_result(
            turn_id=turn_id,
            call_id=call_id,
            success=success,
            output=output,
            error=error,
        )

    async def _post_events(
        self,
        events: list[JsonObject],
        *,
        previous_state: PreviousStateParam | None = None,
        state_upload_url: str | None = None,
        idempotency_key: str | None = None,
    ) -> None:
        path = f"/sessions/{path_segment(self.id)}/events"
        body: JsonObject = {"events": events}
        if previous_state is not None:
            body["previous_state"] = dict(previous_state)
        if state_upload_url is not None:
            body["state_upload_url"] = state_upload_url
        request_options: dict[str, Any] = (
            {"idempotency_key": idempotency_key} if idempotency_key is not None else {}
        )
        try:
            await self._client.request("POST", path, body, **request_options)
        except AgentAPIError as error:
            if not _requires_legacy_single_event_body(error):
                raise
            for event in events:
                await self._client.request("POST", path, event, **request_options)

    async def download_state(self) -> bytes:
        """Download the session state bytes."""
        return await self._client.download(f"/sessions/{path_segment(self.id)}/state")

    async def stream_state(self) -> AsyncGenerator[bytes, None]:
        """Stream the current archive without buffering it in memory."""
        async with aclosing(
            self._client.stream_download(f"/sessions/{path_segment(self.id)}/state")
        ) as chunks:
            async for chunk in chunks:
                yield chunk

    async def update(self, *, state_upload_url: str | None) -> SessionInfo:
        payload = await self._client.request(
            "POST",
            f"/sessions/{path_segment(self.id)}",
            {"state_upload_url": state_upload_url},
        )
        self.info = SessionInfo.from_payload(payload)
        self.status = self.info.status
        return self.info

    async def delete(self) -> DeletedSessionInfo:
        payload = await self._client.request(
            "DELETE",
            f"/sessions/{path_segment(self.id)}",
            None,
        )
        return DeletedSessionInfo.model_validate(payload)

    async def list_items(
        self,
        *,
        limit: int | None = None,
        after: str | None = None,
        order: SessionItemListOrder | None = None,
    ) -> SessionItemList:
        payload = await self._client.request(
            "GET",
            f"/sessions/{path_segment(self.id)}/items",
            params={"limit": limit, "after": after, "order": order},
        )
        return SessionItemList.model_validate(payload)

    async def list_turns(
        self,
        *,
        after: str | None = None,
        limit: int | None = None,
        order: SessionTurnListOrder | None = None,
    ) -> SessionTurnList:
        payload = await self._client.request(
            "GET",
            f"/sessions/{path_segment(self.id)}/turns",
            params={
                **({"after": after} if after is not None else {}),
                **({"limit": limit} if limit is not None else {}),
                **({"order": order} if order is not None else {}),
            },
        )
        return SessionTurnList.model_validate(payload)

    async def retrieve_turn(self, turn_id: str) -> TurnInfo:
        payload = await self._client.request(
            "GET",
            f"/sessions/{path_segment(self.id)}/turns/{path_segment(turn_id)}",
        )
        return TurnInfo.model_validate(payload)

    async def stream_events(
        self,
        *,
        input: InputLike | None = None,
        previous_state: PreviousStateParam | None = None,
        state_upload_url: str | None = None,
        idempotency_key: str | None = None,
        tool_handlers: Mapping[str, AsyncToolHandler] | None = None,
    ) -> AsyncGenerator[SessionEvent, None]:
        if input is not None:
            input_messages(input)

        stream_opened = False

        async def send_input_after_open() -> None:
            nonlocal stream_opened
            stream_opened = True
            if input is not None:
                await self.input(
                    input,
                    previous_state=previous_state,
                    state_upload_url=state_upload_url,
                    idempotency_key=idempotency_key,
                )

        try:
            async with aclosing(
                self._client.stream_events(
                    self.id,
                    on_open=send_input_after_open if input is not None else None,
                )
            ) as events:
                async with aclosing(self._stream_events_from(events, tool_handlers)) as processed:
                    async for event in processed:
                        yield event
        except AgentAPIError as error:
            if input is None or previous_state is None or stream_opened or error.status_code != 404:
                raise

            await self.input(
                input,
                previous_state=previous_state,
                state_upload_url=state_upload_url,
                idempotency_key=idempotency_key,
            )
            async with aclosing(self._client.stream_events(self.id)) as events:
                async with aclosing(self._stream_events_from(events, tool_handlers)) as processed:
                    try:
                        first = await asyncio.wait_for(
                            anext(processed), timeout=_EXPIRED_RESTORE_FIRST_EVENT_TIMEOUT_SECONDS
                        )
                    except TimeoutError:
                        raise AgentAPIResponseError(
                            "The restored session did not emit a live event before the timeout. "
                            "Its turn may have finished before the subscription opened; retrieve "
                            "the session and list its retained items to recover the result."
                        ) from None
                    except StopAsyncIteration:
                        return
                    yield first
                    async for event in processed:
                        yield event

    async def _stream_events_from(
        self,
        events: AsyncIterator[SessionEvent],
        tool_handlers: Mapping[str, AsyncToolHandler] | None,
    ) -> AsyncGenerator[SessionEvent, None]:
        async for event in events:
            self._record_event(event)
            yield event
            await _maybe_handle_tool_call_async(self, event, tool_handlers)

    async def stream(
        self,
        *,
        input: InputLike | None = None,
        previous_state: PreviousStateParam | None = None,
        state_upload_url: str | None = None,
        idempotency_key: str | None = None,
        tool_handlers: Mapping[str, AsyncToolHandler] | None = None,
    ) -> AsyncGenerator[SessionEvent, None]:
        """Stream one run and return after its terminal status event.

        The raw session event stream intentionally remains open so that the
        same session can accept follow-up turns. Use :meth:`stream_events` to
        follow that long-lived live stream instead.
        """
        async with aclosing(
            self.stream_events(
                input=input,
                previous_state=previous_state,
                state_upload_url=state_upload_url,
                idempotency_key=idempotency_key,
                tool_handlers=tool_handlers,
            )
        ) as events:
            async with aclosing(self._stream_one_run(events)) as run_events:
                async for event in run_events:
                    yield event

    async def _stream_one_run(
        self,
        events: AsyncIterator[SessionEvent],
    ) -> AsyncGenerator[SessionEvent, None]:
        turn_id: str | None = None
        saw_turn_end = False
        run_event_ids: set[str] = set()
        async for event in events:
            if event.event_id in self._completed_run_event_ids:
                continue
            run_event_ids.add(event.event_id)
            if turn_id is None and event.turn_id is not None:
                turn_id = event.turn_id
            yield event
            saw_turn_end = saw_turn_end or _is_target_turn_end(event, turn_id)
            if _is_terminal_turn_event(event, turn_id, saw_turn_end):
                self._completed_run_event_ids.update(run_event_ids)
                return

        raise AgentAPIResponseError(
            "Session event stream ended before the run reached idle or failed."
        )

    async def events(self) -> AsyncGenerator[SessionEvent, None]:
        async with aclosing(self.stream_events()) as events:
            async for event in events:
                yield event


def run_result(session: SessionInfo, events: Sequence[SessionEvent]) -> AgentRunResult:
    output_text_parts = [event.output_text for event in events if event.output_text is not None]
    output_items = [
        event.item
        for event in events
        if event.type == "session.turn.item.done" and event.item is not None
    ]
    return AgentRunResult(
        session=session,
        output_text="".join(output_text_parts),
        events=tuple(events),
        output_items=tuple(output_items),
    )


async def _maybe_handle_tool_call_async(
    session: AsyncAgentSession,
    event: SessionEvent,
    handlers: Mapping[str, AsyncToolHandler] | None,
) -> None:
    if event.type != "session.turn.item.added":
        return
    call = event.function_call
    if call is None or handlers is None:
        return
    turn_id = event.turn_id
    name = call.get("name")
    call_id = call.get("call_id")
    arguments = _function_call_arguments(call.get("arguments"))
    if not isinstance(turn_id, str) or not isinstance(name, str) or not isinstance(call_id, str):
        return
    handler = handlers.get(name)
    if handler is None:
        return
    try:
        result = handler(arguments)
        output = await result if inspect.isawaitable(result) else result
    except Exception as exc:
        await session.tool_result(
            turn_id=turn_id,
            call_id=call_id,
            success=False,
            output=None,
            error=str(exc),
        )
    else:
        await session.tool_result(
            turn_id=turn_id,
            call_id=call_id,
            success=True,
            output=output,
            error=None,
        )


def _is_target_turn_end(event: SessionEvent, turn_id: str | None) -> bool:
    return (
        event.type
        in {
            "session.turn.completed",
            "session.turn.failed",
            "session.turn.cancelled",
        }
        and turn_id is not None
        and event.turn_id == turn_id
    )


def _requires_legacy_single_event_body(error: AgentAPIError) -> bool:
    return (
        error.status_code == 400
        and error.code == "invalid_request_error"
        and "Missing required parameter: 'type'" in error.message
    )


def _is_terminal_turn_event(
    event: SessionEvent,
    turn_id: str | None,
    saw_turn_end: bool,
) -> bool:
    if event.type == "session.failed":
        return event.turn_id is None or event.turn_id == turn_id
    if event.type == "session.idle":
        return saw_turn_end
    return False


def _function_call_arguments(value: JsonValue) -> JsonObject:
    if isinstance(value, dict):
        return cast(JsonObject, value)
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except ValueError:
            return {}
        if isinstance(decoded, dict):
            return cast(JsonObject, decoded)
    return {}
