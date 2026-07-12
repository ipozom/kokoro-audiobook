"""GPU-aware Kokoro text-to-speech orchestration."""

from __future__ import annotations

import base64
import io
import logging
import wave
from threading import Lock

import torch

from app.config import Settings
from app.kokoro_adapter import KokoroRuntimeAdapter
from app.schemas import HealthResponse, SynthesisChunk, SynthesisItem


LOGGER = logging.getLogger(__name__)


class TTSEngine:
    """Own the Kokoro runtime lifecycle, CUDA checks, and audio encoding.

    The engine serializes inference by default because a GTX 1080 Ti has finite
    VRAM and a single local model instance typically yields better latency
    predictability than oversubscribing GPU kernels from concurrent requests.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._lock = Lock()
        self._warm = False
        self._device = self._select_device()
        self._adapter = KokoroRuntimeAdapter(settings=settings, device=self._device)

    def _select_device(self) -> torch.device:
        cuda_available = torch.cuda.is_available()
        if self._settings.require_cuda and not cuda_available:
            raise RuntimeError("CUDA is required but torch.cuda.is_available() is false")
        return torch.device("cuda:0" if cuda_available else "cpu")

    def warmup(self) -> None:
        """Warm the model so the first user request avoids CUDA startup overhead."""

        with self._lock:
            if self._warm:
                return
            self._adapter.warmup()
            if self._device.type == "cuda":
                torch.cuda.synchronize(self._device)
            self._warm = True
            LOGGER.info("TTS warmup complete on %s", self._device)

    def health(self) -> HealthResponse:
        """Return service and GPU readiness information."""

        device_name = "CPU"
        total_mb = reserved_mb = allocated_mb = None
        if self._device.type == "cuda":
            props = torch.cuda.get_device_properties(self._device)
            device_name = props.name
            total_mb = round(props.total_memory / 1024 / 1024, 2)
            reserved_mb = round(torch.cuda.memory_reserved(self._device) / 1024 / 1024, 2)
            allocated_mb = round(torch.cuda.memory_allocated(self._device) / 1024 / 1024, 2)

        return HealthResponse(
            status="ok",
            cuda_available=self._device.type == "cuda",
            device_name=device_name,
            vram_total_mb=total_mb,
            vram_reserved_mb=reserved_mb,
            vram_allocated_mb=allocated_mb,
            warm=self._warm,
        )

    def synthesize_batch(self, chunks: list[SynthesisChunk], voice: str, speed: float) -> list[SynthesisItem]:
        """Synthesize a bounded chunk batch and encode each result as base64 WAV."""

        with self._lock:
            audios = self._adapter.synthesize([chunk.text for chunk in chunks], voice=voice, speed=speed)
            if self._device.type == "cuda":
                torch.cuda.synchronize(self._device)

            items: list[SynthesisItem] = []
            for chunk, audio in zip(chunks, audios, strict=True):
                wav_bytes, duration_ms = self._encode_wav(audio)
                items.append(
                    SynthesisItem(
                        chunk_id=chunk.chunk_id,
                        sentence_index=chunk.sentence_index,
                        duration_ms=duration_ms,
                        sample_rate=self._settings.sample_rate,
                        audio_base64=base64.b64encode(wav_bytes).decode("ascii"),
                    )
                )

            self._cleanup_cuda_cache()
            return items

    def _encode_wav(self, audio) -> tuple[bytes, int]:
        """Encode float32 PCM into 16-bit mono WAV for browser playback."""

        clipped = audio.clip(-1.0, 1.0)
        pcm16 = (clipped * 32767.0).astype("int16")
        duration_ms = int(len(pcm16) / self._settings.sample_rate * 1000)

        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(self._settings.sample_rate)
            wav_file.writeframes(pcm16.tobytes())

        return buffer.getvalue(), duration_ms

    def _cleanup_cuda_cache(self) -> None:
        """Release unneeded cached GPU memory between batches."""

        if self._device.type != "cuda":
            return
        torch.cuda.empty_cache()
