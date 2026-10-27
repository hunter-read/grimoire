"""Register a route that answers HEAD as well as GET, with one OpenAPI operation.

A single route with ``methods=["GET", "HEAD"]`` puts two operations in the schema
under one operationId, and which method's suffix that id carries follows set
ordering, so it could change between restarts (issue #709). Duplicate ids break
client generators and Swagger UI's "try it out".

So GET is registered as usual and HEAD as a twin left out of the schema. HEAD
runs the same handler and Starlette drops the body, so the twin answers with the
real status and headers; it just isn't documented separately from the GET.
"""
from typing import Any, Callable

from fastapi import APIRouter


def add_get_and_head_route(
    router: APIRouter, path: str, endpoint: Callable[..., Any], **kwargs: Any
) -> None:
    """``router.add_api_route(path, endpoint, **kwargs)`` for GET, plus a hidden HEAD."""
    router.add_api_route(path, endpoint, methods=["GET"], **kwargs)
    router.add_api_route(
        path,
        endpoint,
        methods=["HEAD"],
        include_in_schema=False,
        **{k: v for k, v in kwargs.items() if k != "include_in_schema"},
    )
