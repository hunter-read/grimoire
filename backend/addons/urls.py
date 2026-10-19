"""Which add-on index URLs Grimoire will fetch from.

An index lists each add-on's download URL *and* its SHA-256, and the install
step checks the download against that hash. Over plain HTTP, whoever can
change the traffic can change both, so the check proves nothing; HTTPS is
required, except for a host on loopback or a private network (a local mirror
or a test server), where there is no untrusted network path to worry about.
"""
import ipaddress
from typing import Optional
from urllib.parse import urlsplit

_LOCAL_NAMES = {"localhost"}


def _is_local_host(host: str) -> bool:
    if host.lower() in _LOCAL_NAMES or host.lower().endswith(".localhost"):
        return True
    try:
        addr = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return False
    return addr.is_loopback or addr.is_private or addr.is_link_local


def index_url_problem(url: str) -> Optional[str]:
    """Why ``url`` can't be used as an add-on index, or None if it can."""
    parts = urlsplit(url.strip())
    if parts.scheme == "https" and parts.hostname:
        return None
    if parts.scheme == "http" and parts.hostname:
        if _is_local_host(parts.hostname):
            return None
        return (
            f"index URL '{url}' must use https:// - plain http:// is only allowed "
            "for localhost and private network addresses"
        )
    return f"index URL '{url}' must be an http(s) URL"
