type AudioLogPayload = Record<string, unknown> | unknown;

function emit(level: "debug" | "info" | "warn" | "error", scope: string, label: string, payload?: AudioLogPayload): void {
  const logger = console[level] ?? console.log;
  if (payload === undefined) {
    logger(`[${scope}] ${label}`);
    return;
  }

  logger(`[${scope}] ${label}`, payload);
}

export function logDebug(label: string, payload?: AudioLogPayload): void {
  if (import.meta.env.DEV) {
    emit("debug", "audio-debug", label, payload);
  }
}

export function logAudioInfo(label: string, payload?: AudioLogPayload): void {
  emit("info", "audio", label, payload);
}

export function logAudioWarn(label: string, payload?: AudioLogPayload): void {
  emit("warn", "audio", label, payload);
}

export function logAudioError(label: string, payload?: AudioLogPayload): void {
  emit("error", "audio", label, payload);
}