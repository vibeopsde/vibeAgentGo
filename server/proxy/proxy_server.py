from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import Response, StreamingResponse
import httpx
import ipaddress
import os
import socket
from urllib.parse import urlparse

app = FastAPI(title="vibeAgentGo CORS Proxy")

# Allowed destination schemes
ALLOWED_SCHEMES = {"http", "https"}

# Optional: restrict destinations. Empty list = allow all.
# NOTE: even with an empty allowlist the SSRF guard below always applies and
# blocks private/loopback/link-local/reserved IP targets (127.0.0.1,
# 169.254.169.254, RFC1918, etc.).
ALLOWLIST = [h.strip().lower() for h in os.environ.get("VAG_PROXY_ALLOWLIST", "").split(",") if h.strip()]

# Only these request headers are forwarded upstream. Everything else (cookie,
# user-agent, origin, referer, accept-encoding, ...) is dropped so browser
# credentials are never leaked to arbitrary upstream targets.
FORWARDED_REQUEST_HEADERS = {"content-type", "accept", "authorization"}

MAX_REDIRECTS = 5

DEFAULT_TIMEOUT = httpx.Timeout(15.0, connect=5.0)


def _is_blocked_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def _validate_target_url(target: str) -> None:
    """Validate a target URL against scheme, allowlist and SSRF rules.

    Raises HTTPException if the target must not be proxied.
    """
    try:
        parsed = urlparse(target)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid URL: {e}") from e

    if parsed.scheme not in ALLOWED_SCHEMES:
        raise HTTPException(status_code=400, detail=f"Scheme not allowed: {parsed.scheme}")

    host = (parsed.hostname or "").lower()
    if not host:
        raise HTTPException(status_code=400, detail="Missing host in URL")

    if ALLOWLIST and host not in ALLOWLIST:
        raise HTTPException(status_code=403, detail=f"Host not allowed: {host}")

    # SSRF guard: resolve the hostname and block if any resulting address is
    # private/loopback/link-local/reserved. Applies even with an empty ALLOWLIST.
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise HTTPException(status_code=400, detail=f"Cannot resolve host: {host}") from e
    for info in infos:
        ip_str = info[4][0]
        if _is_blocked_ip(ip_str):
            raise HTTPException(status_code=403, detail=f"Blocked target address: {host}")

@app.get("/api/proxy/")
async def proxy_get(request: Request):
    target = request.query_params.get("url")
    if not target:
        raise HTTPException(status_code=400, detail="Missing ?url= query parameter")

    _validate_target_url(target)

    method = request.method.upper()
    body = await request.body()
    headers = {}
    for name, value in request.headers.items():
        if name.lower() in FORWARDED_REQUEST_HEADERS:
            headers[name] = value

    # follow_redirects is disabled: each redirect destination is re-validated
    # (allowlist + SSRF guard) before being followed, so no 302 from an
    # allowed host can lead to internal targets.
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT, follow_redirects=False) as client:
        url = target
        redirects = 0
        while True:
            try:
                upstream = await client.request(method, url, headers=headers, content=body)
            except httpx.RequestError as e:
                raise HTTPException(status_code=502, detail=f"Upstream error: {e}") from e
            if upstream.status_code not in (301, 302, 303, 307, 308):
                break
            if redirects >= MAX_REDIRECTS:
                raise HTTPException(status_code=502, detail="Too many redirects")
            location = upstream.headers.get("location")
            if not location:
                break
            if redirects == 0 and method == "POST" and upstream.status_code == 303:
                method = "GET"
            url = str(upstream.url.join(location))
            _validate_target_url(url)
            redirects += 1

    response_headers = dict(upstream.headers)
    response_headers.pop("content-encoding", None)
    response_headers.pop("content-length", None)
    response_headers.pop("transfer-encoding", None)
    response_headers.pop("set-cookie", None)
    response_headers["Access-Control-Allow-Origin"] = "*"
    response_headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response_headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"

    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=response_headers,
        media_type=response_headers.get("content-type", "application/octet-stream"),
    )


@app.options("/api/proxy/")
async def proxy_options():
    return Response(
        status_code=204,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
    )


@app.post("/api/proxy/")
async def proxy_post(request: Request):
    return await proxy_get(request)
