import type { PlaybackProgress, SynthesisQueueItem, TtsHealth, UploadResponse } from "../types";

/** Upload a PDF to the Node boundary for validation and extraction. */
export async function uploadPdf(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("pdf", file);

  const response = await fetch("/api/documents/upload", {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<UploadResponse>;
}

/** Persist playback progress through the API so reloads resume cleanly. */
export async function saveProgress(progress: PlaybackProgress): Promise<void> {
  const response = await fetch(`/api/progress/${progress.documentId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(progress)
  });

  if (!response.ok) {
    throw new Error("Failed to save progress");
  }
}

/** Request sentence audio in small batches to balance latency and GPU efficiency. */
export async function queueSynthesis(input: {
  voice: string;
  speed: number;
  sentences: Array<{ id: string; pageNumber: number; sentenceIndex: number; text: string }>;
}): Promise<SynthesisQueueItem[]> {
  const response = await fetch("/api/tts/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error("Failed to synthesize text");
  }

  const payload = (await response.json()) as { items: SynthesisQueueItem[] };
  return payload.items;
}

/** Load the current GPU service health for display and troubleshooting. */
export async function fetchTtsHealth(): Promise<TtsHealth> {
  const response = await fetch("/api/tts/health");
  if (!response.ok) {
    throw new Error("Failed to fetch TTS health");
  }
  return response.json() as Promise<TtsHealth>;
}
