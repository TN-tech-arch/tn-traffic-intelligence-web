"""Structured, field-level error contracts (spec 3.5.3 / 13.1)."""

from __future__ import annotations

from typing import Any, Iterable


class Issue(dict):
    """A single machine-readable validation issue."""

    def __init__(
        self,
        path: str,
        code: str,
        severity: str,
        message: str,
        suggestion: str = "",
        received_value: Any = None,
        group: str | None = None,
    ) -> None:
        super().__init__(
            path=path,
            code=code,
            severity=severity,
            message=message,
            suggestion=suggestion,
            received_value=received_value,
        )
        if group:
            self["group"] = group


def error(path: str, code: str, message: str, suggestion: str = "", received: Any = None, group: str | None = None) -> Issue:
    return Issue(path, code, "error", message, suggestion, received, group)


def warning(path: str, code: str, message: str, suggestion: str = "", received: Any = None, group: str | None = None) -> Issue:
    return Issue(path, code, "warning", message, suggestion, received, group)


def info(path: str, code: str, message: str, suggestion: str = "", received: Any = None, group: str | None = None) -> Issue:
    return Issue(path, code, "info", message, suggestion, received, group)


def has_errors(issues: Iterable[Issue]) -> bool:
    return any(i["severity"] == "error" for i in issues)


class RequestRejected(Exception):
    """Raised when a request must be rejected; carries structured issues.

    ``status_code`` follows the contract: 422 for field/schema level failures,
    409 for cross-resource conflicts.  Rejection always happens *before* any
    job is created or any persisted object is modified.
    """

    def __init__(self, issues: list[Issue], status_code: int = 422, message: str = "请求参数校验未通过") -> None:
        super().__init__(message)
        self.issues = issues
        self.status_code = status_code
        self.message = message


class NotFound(Exception):
    def __init__(self, message: str, code: str = "NOT_FOUND") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


class Conflict(Exception):
    """Cross-resource rule violation (delete protection, scope mismatch...)."""

    def __init__(self, message: str, code: str = "CONFLICT", issues: list[Issue] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.issues = issues or []

