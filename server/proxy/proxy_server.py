from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import Response, StreamingResponse
import httpx
import os

app = FastAPI(title="vibeAgentGo CORS Proxy")

# Allowed destination schemes
ALLOWED_SCHEMES = {"http", "https"}

# Optional: restrict destinations. Empty list = allow all.
ALLOWLIST = [h.strip() for h in os.environ.get("VAG_PROXY_ALLOWLIST", "").split(",") if h.strip()]

DEFAULT_TIMEOUT = httpx.Timeout(15.0, connect=5.0)

@app.get("/api/proxy/")
async def proxy_get(request: Request):
    target = request.query_params.get("url")
    if not target:
        raise HTTPException(status_code=400, detail="Missing ?url= query parameter")

    try:
        parsed = httpx.URL(target)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid URL: {e}") from e

    if parsed.scheme not in ALLOWED_SCHEMES:
        raise HTTPException(status_code=400, detail=f"Scheme not allowed: {parsed.scheme}")

    if ALLOWLIST and parsed.host not in ALLOWLIST:
        raise HTTPException(status_code=403, detail=f"Host not allowed: {parsed.host}")

    method = request.method.upper()
    headers = {}
    for name, value in request.headers.items():
        if name.lower() in {"host", "origin", "referer", "accept-encoding"}:
            continue
        headers[name] = value

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT, follow_redirects=True) as client:
        try:
            upstream = await client.request(method, target, headers=headers, content=await request.body())
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"Upstream error: {e}") from e

    response_headers = dict(upstream.headers)
    response_headers.pop("content-encoding", None)
    response_headers.pop("content-length", None)
    response_headers.pop("transfer-encoding", None)
    response_headers["Access-Control-Allow-Origin"] = "https://vag.vibeops.de"
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
            "Access-Control-Allow-Origin": "https://vag.vibeops.de",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
    )


@app.post("/api/proxy/")
async def proxy_post(request: Request):
    return await proxy_get(request)
