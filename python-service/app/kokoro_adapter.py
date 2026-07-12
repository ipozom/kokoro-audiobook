"""Adapter layer around a locally installed Kokoro inference runtime."""

from __future__ import annotations

import importlib
import logging
from collections.abc import Iterable
from typing import Any

import numpy as np
import torch

from app.config import Settings


LOGGER = logging.getLogger(__name__)


class KokoroRuntimeAdapter:
    """Load and drive a Kokoro runtime with a narrow, documented interface.

    The Kokoro ecosystem currently has multiple community wrappers. This adapter
    standardizes the local interface expected by the service:

    - a configurable module name such as `kokoro`
    - a configurable factory such as `KPipeline`
    - an object that either exposes `generate(...)` or is directly callable

    The wrapper keeps the integration explicit and easy to replace without
    changing the rest of the service.
    """

    def __init__(self, settings: Settings, device: torch.device) -> None:
        self._settings = settings
        self._device = device
        self._runtime = self._load_runtime()

    def _load_runtime(self) -> Any:
        module = importlib.import_module(self._settings.kokoro_module)
        factory = getattr(module, self._settings.kokoro_factory)
        kwargs = {
            "model_path": str(self._settings.resolved_model_path),
            "device": str(self._device),
            "voice": self._settings.default_voice,
            "sample_rate": self._settings.sample_rate,
        }

        try:
            runtime = factory(**kwargs)
        except TypeError:
            kwargs.pop("sample_rate", None)
            runtime = factory(**kwargs)

        LOGGER.info("Loaded Kokoro runtime from %s.%s", self._settings.kokoro_module, self._settings.kokoro_factory)
        return runtime

    def synthesize(self, texts: Iterable[str], voice: str, speed: float) -> list[np.ndarray]:
        """Synthesize text chunks into mono float32 PCM arrays."""

        texts = list(texts)
        if hasattr(self._runtime, "generate"):
            generated = self._runtime.generate(texts=texts, voice=voice, speed=speed)
        elif callable(self._runtime):
            generated = self._runtime(texts=texts, voice=voice, speed=speed)
        else:
            raise RuntimeError("Unsupported Kokoro runtime interface: missing generate() or __call__()")

        return [self._coerce_audio(item) for item in generated]

    def warmup(self) -> None:
        """Run one short synthesis pass to preallocate GPU kernels and caches."""

        self.synthesize([self._settings.warmup_text], self._settings.default_voice, 1.0)

    @staticmethod
    def _coerce_audio(item: Any) -> np.ndarray:
        """Normalize runtime-specific outputs into a mono float32 PCM array."""

        if isinstance(item, np.ndarray):
            audio = item
        elif hasattr(item, "audio"):
            audio = np.asarray(item.audio)
        elif isinstance(item, dict) and "audio" in item:
            audio = np.asarray(item["audio"])
        else:
            audio = np.asarray(item)

        if audio.ndim > 1:
            audio = audio.reshape(-1)

        return audio.astype(np.float32, copy=False)
