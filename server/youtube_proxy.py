"""
vibeAgentGo — YouTube Transcript Proxy Server

A tiny FastAPI service that fetches YouTube transcripts server-side
(via youtube-transcript-api) and serves them to the PWA with CORS.

Endpoints:
  GET /api/youtube/transcript?video_id=VIDEO_ID&language=de&with_timestamps=false

Response JSON:
  {
    "video_id": "...",
    "title": "...",
    "language": "de",
    "transcript": [
      {"text": "...", "start": 0.0, "duration": 1.23},
      ...
    ]
  }

Run locally:
  uvicorn server.youtube_proxy:app --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import os
import re
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    TranscriptsDisabled,
    NoTranscriptFound,
    VideoUnavailable,
    InvalidVideoId,
    YouTubeTranscriptApiException,
)


APP_NAME = "vibeAgentGo YouTube Proxy"

# Origins that may call this proxy directly from a browser PWA.
# In production the request passes through Caddy, but we keep the list
# permissive enough for dev and mobile testing.
ALLOWED_ORIGINS = os.environ.get(
    "YOUTUBE_PROXY_CORS_ORIGINS",
    "https://vag.vibeops.de,https://dev-vag.vibeops.de,https://ki.vibeops.de,http://localhost:5173,http://localhost:4173",
).split(",")

# Optional allow-list to keep the proxy useful but not a public API.
ALLOWED_VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")


def _format_timestamp(seconds: float) -> str:
    """MM:SS or HH:MM:SS timestamp."""
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def _extract_video_id(url_or_id: str) -> str | None:
    """Accept a raw 11-char ID or extract from common YouTube URL formats."""
    value = url_or_id.strip()
    if not value:
        return None

    if ALLOWED_VIDEO_ID_PATTERN.match(value):
        return value

    patterns = [
        r"[?&]v=([A-Za-z0-9_-]{11})",
        r"youtu\.be/([A-Za-z0-9_-]{11})",
        r"youtube\.com/shorts/([A-Za-z0-9_-]{11})",
        r"youtube\.com/embed/([A-Za-z0-9_-]{11})",
        r"youtube\.com/live/([A-Za-z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, value)
        if match:
            return match.group(1)

    return None


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """Startup / shutdown hook."""
    yield


app = FastAPI(
    title=APP_NAME,
    description="Server-side proxy for YouTube transcript retrieval.",
    version="1.0.0",
    lifespan=_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS if o.strip()],
    allow_credentials=True,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(YouTubeTranscriptApiException)
async def _handle_ytt_api_exception(request, exc):
    detail = str(exc)
    status_code = 502
    if isinstance(exc, TranscriptsDisabled):
        status_code = 404
    elif isinstance(exc, NoTranscriptFound):
        status_code = 404
    elif isinstance(exc, VideoUnavailable):
        status_code = 404
    elif isinstance(exc, TooManyRequests):
        status_code = 429
    elif isinstance(exc, NotFound):
        status_code = 404
    elif isinstance(exc, InvalidVideoId):
        status_code = 400
    return JSONResponse({"error": detail}, status_code=status_code)


async def _fetch_transcript(
    video_id: str,
    language: str,
    with_timestamps: bool,
) -> dict[str, Any]:
    extracted = _extract_video_id(video_id)
    if not extracted:
        raise HTTPException(status_code=400, detail="Invalid or missing video_id.")

    try:
        # New API (>= 1.0) uses fetch(video_id, languages=...).
        langs = [language] if language else []
        entries = YouTubeTranscriptApi().fetch(extracted, languages=langs)
    except (TranscriptsDisabled, NoTranscriptFound, VideoUnavailable) as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except InvalidVideoId as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    if not entries:
        return {"video_id": extracted, "title": None, "language": language, "transcript": []}

    language_code = language or "auto"
    title = None  # youtube-transcript-api does not expose title; left empty.

    formatted_entries = []
    for entry in entries:
        if isinstance(entry, dict):
            text = entry.get("text", "").replace("\n", " ").strip()
            start = float(entry.get("start", 0.0))
            duration = float(entry.get("duration", 0.0))
        else:
            text = str(entry.text).replace("\n", " ").strip()
            start = float(entry.start)
            duration = float(entry.duration)
        formatted_entries.append(
            {
                "text": text,
                "start": start,
                "duration": duration,
                "timestamp": _format_timestamp(start) if with_timestamps else None,
            }
        )

    return {
        "video_id": extracted,
        "title": title,
        "language": language_code,
        "transcript": formatted_entries,
        "text": "\n".join(
            f"[{e['timestamp']}] {e['text']}" if with_timestamps else e["text"]
            for e in formatted_entries
        ),
    }


@app.get("/api/youtube/transcript")
async def get_transcript(
    video_id: str = Query(..., description="YouTube video ID or URL"),
    language: str = Query("", description="Preferred transcript language (e.g. de, en)"),
    with_timestamps: bool = Query(False, description="Include timestamps in text output"),
) -> dict[str, Any]:
    return await _fetch_transcript(video_id, language, with_timestamps)


@app.get("/transcript")
async def get_transcript_stripped(
    video_id: str = Query(..., description="YouTube video ID or URL"),
    language: str = Query("", description="Preferred transcript language (e.g. de, en)"),
    with_timestamps: bool = Query(False, description="Include timestamps in text output"),
) -> dict[str, Any]:
    return await _fetch_transcript(video_id, language, with_timestamps)


@app.get("/api/youtube/health")
async def health():
    return {"status": "ok"}


@app.get("/health")
async def health_stripped():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("YOUTUBE_PROXY_PORT", "8001"))
    host = os.environ.get("YOUTUBE_PROXY_HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=port)
