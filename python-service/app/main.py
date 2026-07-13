"""FastAPI entrypoint for the Kokoro GPU TTS service."""

from __future__ import annotations

import logging

from fastapi import Depends, FastAPI, Header, HTTPException, status

from app.config import Settings, get_settings
from app.schemas import HealthResponse, SynthesisRequest, SynthesisResponse
from app.tts_engine import TTSEngine


logging.basicConfig(level=logging.INFO)

settings = get_settings()
engine = TTSEngine(settings)

app = FastAPI(
    title="Kokoro GPU TTS Service",
    version="1.0.0",
    description="Local CUDA-backed TTS microservice for the audiobook player.",
)


def validate_api_key(
    x_api_key: str = Header(default="", alias="X-API-Key"),
    runtime_settings: Settings = Depends(get_settings),
) -> None:
    """Reject unauthenticated requests at the service boundary."""

    if x_api_key != runtime_settings.api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid API key")


@app.on_event("startup")
def warmup_model() -> None:
    """Preload model weights and CUDA kernels during service startup."""

    engine.warmup()


@app.get("/health", response_model=HealthResponse, dependencies=[Depends(validate_api_key)])
def health() -> HealthResponse:
    """Return runtime health, CUDA state, and VRAM counters."""

    return engine.health()


def _synthesize_impl(request: SynthesisRequest) -> SynthesisResponse:
    """Synthesize a batch of text chunks into base64-encoded WAV items."""

    if any(len(chunk.text) > settings.max_text_chars for chunk in request.chunks):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="chunk exceeds max_text_chars")
    if len(request.chunks) > settings.max_batch_items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="batch exceeds max_batch_items")

    items = engine.synthesize_batch(chunks=request.chunks, voice=request.voice, speed=request.speed)
    runtime_health = engine.health()
    return SynthesisResponse(
        device=runtime_health.device,
        device_name=runtime_health.device_name,
        voice=request.voice,
        items=items,
    )


@app.post("/synthesize", response_model=SynthesisResponse, dependencies=[Depends(validate_api_key)])
def synthesize(request: SynthesisRequest) -> SynthesisResponse:
    """Backward-compatible synthesis endpoint."""

    return _synthesize_impl(request)


@app.post("/tts", response_model=SynthesisResponse, dependencies=[Depends(validate_api_key)])
def tts(request: SynthesisRequest) -> SynthesisResponse:
    """Primary runtime synthesis endpoint for direct verification."""

    return _synthesize_impl(request)