"""Adapter layer around a locally installed Kokoro inference runtime."""

from __future__ import annotations

import logging
from collections.abc import Iterable
from pathlib import Path
from time import perf_counter

from huggingface_hub import hf_hub_download
import numpy as np
import torch
from kokoro import KModel, KPipeline

from app.config import Settings


LOGGER = logging.getLogger(__name__)


class KokoroRuntimeAdapter:
    """Load and drive the real Kokoro runtime through its published API."""

    def __init__(self, settings: Settings, device: torch.device) -> None:
        self._settings = settings
        self._device = device
        self._pipelines: dict[str, KPipeline] = {}
        self._config_path = self._resolve_asset(
            explicit_path=self._settings.resolved_config_path,
            repo_filename=self._settings.kokoro_config_file,
        )
        self._model_path = self._resolve_asset(
            explicit_path=self._settings.resolved_model_path,
            repo_filename=self._settings.kokoro_model_file,
        )
        self._default_voice_path = self._resolve_asset(
            explicit_path=self._settings.resolved_voice_path,
            repo_filename=self._settings.kokoro_voice_file,
        )
        self._model = self._load_runtime()
        self._first_inference_logged = False

    @property
    def model_loaded(self) -> bool:
        """Expose whether the Kokoro model instance was created successfully."""

        return self._model is not None

    @property
    def model_path(self) -> Path:
        """Return the resolved local model weights path."""

        return self._model_path

    @property
    def config_path(self) -> Path:
        """Return the resolved local model config path."""

        return self._config_path

    @property
    def default_voice_path(self) -> Path:
        """Return the resolved local default voice path."""

        return self._default_voice_path

    def _resolve_asset(self, explicit_path: Path | None, repo_filename: str) -> Path:
        if explicit_path is not None:
            if not explicit_path.exists():
                raise FileNotFoundError(f"Configured Kokoro asset does not exist: {explicit_path}")
            return explicit_path

        resolved = Path(
            hf_hub_download(repo_id=self._settings.kokoro_repo_id, filename=repo_filename)
        ).resolve()
        LOGGER.info("Resolved Kokoro asset %s to %s", repo_filename, resolved)
        return resolved

    def _load_runtime(self) -> KModel:
        start = perf_counter()
        LOGGER.info(
            "Initializing Kokoro model repo=%s device=%s config=%s model=%s voice=%s",
            self._settings.kokoro_repo_id,
            self._device,
            self._config_path,
            self._model_path,
            self._default_voice_path,
        )
        model = KModel(
            repo_id=self._settings.kokoro_repo_id,
            config=str(self._config_path),
            model=str(self._model_path),
        ).to(str(self._device)).eval()
        elapsed_ms = round((perf_counter() - start) * 1000, 2)
        LOGGER.info("Kokoro model loaded successfully in %s ms", elapsed_ms)
        return model

    def _pipeline_for_voice(self, voice: str) -> KPipeline:
        lang_code = self._language_code_for_voice(voice)
        pipeline = self._pipelines.get(lang_code)
        if pipeline is None:
            pipeline = KPipeline(
                lang_code=lang_code,
                repo_id=self._settings.kokoro_repo_id,
                model=self._model,
                device=str(self._device),
            )
            self._pipelines[lang_code] = pipeline
            LOGGER.info("Initialized Kokoro pipeline for lang_code=%s voice=%s", lang_code, voice)
        return pipeline

    def _language_code_for_voice(self, voice: str) -> str:
        prefix = voice.strip().lower()[:1]
        if not prefix:
            return self._settings.kokoro_lang_code
        return prefix

    def synthesize(self, texts: Iterable[str], voice: str, speed: float) -> list[np.ndarray]:
        """Synthesize text chunks into mono float32 PCM arrays."""

        texts = list(texts)
        pipeline = self._pipeline_for_voice(voice)
        results: list[np.ndarray] = []

        start = perf_counter()
        for text in texts:
            segments = list(pipeline(text=text, voice=voice, speed=speed, split_pattern=None, model=self._model))
            if not segments:
                raise RuntimeError(f"Kokoro returned no audio for text chunk: {text!r}")

            combined = [self._coerce_audio(segment) for segment in segments]
            results.append(np.concatenate(combined) if len(combined) > 1 else combined[0])

        elapsed_ms = round((perf_counter() - start) * 1000, 2)
        if not self._first_inference_logged:
            LOGGER.info(
                "First Kokoro inference complete on %s in %s ms for %s chunk(s)",
                self._device,
                elapsed_ms,
                len(texts),
            )
            self._first_inference_logged = True
        else:
            LOGGER.info("Kokoro inference complete in %s ms for %s chunk(s)", elapsed_ms, len(texts))

        return results

    def warmup(self) -> None:
        """Run one short synthesis pass to preallocate GPU kernels and caches."""

        self.synthesize([self._settings.warmup_text], self._settings.default_voice, 1.0)

    @staticmethod
    def _coerce_audio(item) -> np.ndarray:
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
