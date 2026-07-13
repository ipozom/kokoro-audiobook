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
    kokoro_repo_id: str = Field(default="hexgrad/Kokoro-82M")
    kokoro_lang_code: str = Field(default="a")
    kokoro_model_file: str = Field(default="kokoro-v1_0.pth")
    kokoro_config_file: str = Field(default="config.json")
    kokoro_voice_file: str = Field(default="voices/af_sarah.pt")
    kokoro_model_path: str | None = Field(default=None)
    kokoro_config_path: str | None = Field(default=None)
    kokoro_voice_path: str | None = Field(default=None)
    log_level: str = Field(default="INFO")
    max_workers: int = Field(default=1)

    @property
    def resolved_model_path(self) -> Path | None:
        """Resolve an explicitly configured Kokoro model path if one is provided."""

        if not self.kokoro_model_path:
            return None
        return Path(self.kokoro_model_path).expanduser().resolve()

    @property
    def resolved_config_path(self) -> Path | None:
        """Resolve an explicitly configured Kokoro config path if one is provided."""

        if not self.kokoro_config_path:
            return None
        return Path(self.kokoro_config_path).expanduser().resolve()

    @property
    def resolved_voice_path(self) -> Path | None:
        """Resolve an explicitly configured Kokoro voice path if one is provided."""

        if not self.kokoro_voice_path:
            return None
        return Path(self.kokoro_voice_path).expanduser().resolve()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide cached settings instance."""

    return Settings()
