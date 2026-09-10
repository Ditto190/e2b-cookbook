from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx


class AgentAPISDKError(Exception):
    """Base exception for SDK and API errors."""


class AgentAPIConfigurationError(AgentAPISDKError):
    """Raised when required client configuration is missing or invalid."""


class AgentAPIResponseError(AgentAPISDKError):
    """Raised when the API returns a response the SDK cannot decode."""


@dataclass
class AgentAPIError(AgentAPISDKError):
    message: str
    status_code: int
    code: str | None
    error_type: str | None
    response: httpx.Response

    def __str__(self) -> str:
        code = f" {self.code}" if self.code else ""
        return f"{self.status_code}{code}: {self.message}"

    @classmethod
    def from_response(cls, response: httpx.Response) -> "AgentAPIError":
        message = response.text
        code: str | None = None
        error_type: str | None = None
        try:
            payload = response.json()
        except ValueError:
            payload = None
        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict):
                message = _string_or_fallback(error.get("message"), message)
                code = _optional_string(error.get("code"))
                error_type = _optional_string(error.get("type"))
            elif isinstance(error, str):
                message = error
            detail = payload.get("detail")
            if isinstance(detail, dict):
                message = _string_or_fallback(detail.get("message"), message)
                code = code or _optional_string(detail.get("code"))
                error_type = error_type or _optional_string(detail.get("type"))
            elif isinstance(detail, str):
                message = detail
            else:
                message = _string_or_fallback(payload.get("message"), message)
        return cls(
            message=message,
            status_code=response.status_code,
            code=code,
            error_type=error_type,
            response=response,
        )


def _optional_string(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _string_or_fallback(value: Any, fallback: str) -> str:
    return value if isinstance(value, str) else fallback
