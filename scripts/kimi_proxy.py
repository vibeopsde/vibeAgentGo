#!/usr/bin/env python3
"""
Kimi Code CORS proxy for vibeAgentGo.
Runs behind Caddy on localhost:8456.
"""

from flask import Flask, request, Response, request as flask_request
import requests
import os

app = Flask(__name__)

TARGET_BASE = "https://api.kimi.com/coding/v1"
ALLOWED_ORIGIN = "https://vag.vibeops.de"


def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN
    response.headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response


@app.route("/api/kimi/<path:path>", methods=["GET", "POST", "OPTIONS", "PUT", "DELETE"])
def proxy(path):
    if request.method == "OPTIONS":
        return add_cors_headers(Response(status=204))

    target_url = f"{TARGET_BASE}/{path}"
    if request.query_string:
        target_url += "?" + request.query_string.decode()

    headers = {}
    for key in ["Authorization", "Content-Type"]:
        if key in request.headers:
            headers[key] = request.headers[key]

    try:
        resp = requests.request(
            method=request.method,
            url=target_url,
            headers=headers,
            data=request.get_data(),
            timeout=60,
            stream=True,
        )
    except Exception as e:
        return add_cors_headers(Response(str(e), status=502))

    response = Response(
        resp.iter_content(chunk_size=8192),
        status=resp.status_code,
        content_type=resp.headers.get("Content-Type", "application/json"),
    )
    return add_cors_headers(response)


if __name__ == "__main__":
    from waitress import serve
    serve(app, host="127.0.0.1", port=8456)
