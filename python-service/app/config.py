"""Runtime configuration for the Kokoro GPU TTS service."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-backed service configuration."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8001)
    api_key: str = Field(default="change-me")
    require_cuda: bool = Field(default=True)
    sample_rate: int = Field(default=24000)
    default_voice: str = Field(default="af_sarah")
    max_text_chars: int = Field(default=700)
    max_batch_items: int = Field(default=8)
    warmup_text: str = Field(default="Kokoro GPU warmup complete.")
    kokoro_module: str = Field(default="kokoro")
    kokoro_factory: str = Field(default="KPipeline")
    kokoro_model_path: str = Field(default="models/kokoro-82m")
    log_level: str = Field(default="INFO")
    max_workers: int = Field(default=1)

    @property
    def resolved_model_path(self) -> Path:
        """Resolve the configured Kokoro model path relative to the service root."""

        return Path(self.kokoro_model_path).expanduser().resolve()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide cached settings instance."""

    return Settings()
