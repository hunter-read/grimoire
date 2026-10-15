"""JSON-RPC error codes, and the exception that carries one out of a handler.

These are for a malformed or unanswerable *call*. A tool that ran and failed
answers with a normal result marked ``isError`` instead (see tools/).
"""

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603
# MCP's own code for resources/read on a URI that doesn't resolve.
RESOURCE_NOT_FOUND = -32002


class ProtocolError(Exception):
    """Raised by a method handler to answer with a JSON-RPC error."""

    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
