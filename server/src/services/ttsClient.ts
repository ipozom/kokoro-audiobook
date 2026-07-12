import type { SentenceChunk, SynthesisQueueItem, SynthesisQueueRequest } from "../types.js";
import { serverConfig } from "../config.js";
import { HttpError } from "../utils/errors.js";

interface PythonSynthesisResponse {
  items: Array<{
    chunk_id: string;
    sentence_index: number;
    duration_ms: number;
    sample_rate: number;
    audio_base64: string;
  }>;
}

/** Call the local Python Kokoro service through a narrow authenticated contract. */
export async function synthesizeSentences(request: SynthesisQueueRequest): Promise<SynthesisQueueItem[]> {
  const response = await fetch(`${serverConfig.pythonTtsUrl}/synthesize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": serverConfig.pythonTtsApiKey
    },
    body: JSON.stringify({
      voice: request.voice,
      speed: request.speed,
      chunks: request.sentences.map((sentence: SentenceChunk) => ({
        chunk_id: sentence.id,
        sentence_index: sentence.sentenceIndex,
        text: sentence.text
      }))
    })
  });

  if (!response.ok) {
    throw new HttpError("Python TTS service rejected the synthesis request", 502, await safeJson(response));
  }

  const payload = (await response.json()) as PythonSynthesisResponse;
  return payload.items.map((item) => ({
    chunkId: item.chunk_id,
    sentenceIndex: item.sentence_index,
    durationMs: item.duration_ms,
    sampleRate: item.sample_rate,
    audioBase64: item.audio_base64
  }));
}

/** Proxy the Python health payload so the frontend only trusts the Node boundary. */
export async function getTtsHealth(): Promise<unknown> {
  const response = await fetch(`${serverConfig.pythonTtsUrl}/health`, {
    headers: { "X-API-Key": serverConfig.pythonTtsApiKey }
  });

  if (!response.ok) {
    throw new HttpError("Python TTS health check failed", 502, await safeJson(response));
  }

  return response.json();
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
