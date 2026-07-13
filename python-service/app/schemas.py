"""Request and response models for the Kokoro GPU TTS service."""

from pydantic import BaseModel, Field, field_validator


class HealthResponse(BaseModel):
    """Health and GPU status payload."""

    status: str
    cuda_available: bool
    device: str
    device_name: str
    vram_total_mb: float | None = None
    vram_reserved_mb: float | None = None
    vram_allocated_mb: float | None = None
    warm: bool
    model_loaded: bool
    model_repo_id: str
    model_config_path: str
    model_weights_path: str
    default_voice_path: str


class SynthesisChunk(BaseModel):
    """A text unit scheduled for synthesis."""

    chunk_id: str = Field(min_length=1, max_length=128)
    sentence_index: int = Field(ge=0)
    text: str = Field(min_length=1, max_length=700)

    @field_validator("text")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        """Trim and normalize surrounding whitespace before synthesis."""

        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("text must not be blank")
        return normalized


class SynthesisRequest(BaseModel):
    """Batch synthesis request."""

    voice: str = Field(min_length=1, max_length=64, default="af_sarah")
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    chunks: list[SynthesisChunk] = Field(min_length=1, max_length=8)


class SynthesisItem(BaseModel):
    """Metadata describing the synthesized audio for one chunk."""

    chunk_id: str
    sentence_index: int
    duration_ms: int
    sample_rate: int
    audio_base64: str


class SynthesisResponse(BaseModel):
    """Batch synthesis response."""

    device: str
    device_name: str
    voice: str
    items: list[SynthesisItem]
