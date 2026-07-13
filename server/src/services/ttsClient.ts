import type { SentenceChunk, SynthesisQueueItem, SynthesisQueueRequest } from "../types.js";
import { serverConfig } from "../config.js";
import { RETRY_TTS_MAX_CHARS, SAFE_TTS_MAX_CHARS, normalizeTtsText, splitTextForTts } from "../utils/text.js";
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

interface PythonSynthesisChunk {
  chunk_id: string;
  sentence_index: number;
  text: string;
}

/** Call the local Python Kokoro service through a narrow authenticated contract. */
export async function synthesizeSentences(request: SynthesisQueueRequest): Promise<SynthesisQueueItem[]> {
  const sanitizedSentences = request.sentences
    .map((sentence) => ({
      ...sentence,
      text: normalizeTtsText(sentence.text)
    }))
    .filter((sentence) => sentence.text.length > 0);

  if (sanitizedSentences.length === 0) {
    return [];
  }

  try {
    return await requestPythonSynthesis({ ...request, sentences: sanitizedSentences }, "batch");
  } catch (error) {
    console.warn(
      "[ttsClient] batch synthesis failed, retrying sentence-by-sentence",
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        chunkCount: sanitizedSentences.length,
        textLengths: sanitizedSentences.map((sentence) => sentence.text.length)
      })
    );
  }

  const recoveredItems: SynthesisQueueItem[] = [];
  for (const sentence of sanitizedSentences) {
    const recoveredItem = await synthesizeWithFallback(sentence, request.voice, request.speed);
    if (recoveredItem) {
      recoveredItems.push(recoveredItem);
    }
  }

  return recoveredItems;
}

/** Proxy the Python health payload so the frontend only trusts the Node boundary. */
export async function getTtsHealth(): Promise<unknown> {
  const startedAt = performance.now();
  const response = await fetch(`${serverConfig.pythonTtsUrl}/health`, {
    headers: { "X-API-Key": serverConfig.pythonTtsApiKey }
  });

  console.info(
    "[ttsClient] python health response",
    JSON.stringify({
      status: response.status,
      ok: response.ok,
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100
    })
  );

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

async function requestPythonSynthesis(request: SynthesisQueueRequest, mode: string): Promise<SynthesisQueueItem[]> {
  const startedAt = performance.now();
  const chunks: PythonSynthesisChunk[] = request.sentences.map((sentence: SentenceChunk) => ({
    chunk_id: sentence.id,
    sentence_index: sentence.sentenceIndex,
    text: sentence.text
  }));

  console.info(
    "[ttsClient] forwarding synthesis request",
    JSON.stringify({
      mode,
      pythonUrl: `${serverConfig.pythonTtsUrl}/synthesize`,
      voice: request.voice,
      speed: request.speed,
      chunkCount: chunks.length,
      textLengths: chunks.map((chunk) => chunk.text.length),
      maxChunkChars: Math.max(...chunks.map((chunk) => chunk.text.length))
    })
  );

  const response = await fetch(`${serverConfig.pythonTtsUrl}/synthesize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": serverConfig.pythonTtsApiKey
    },
    body: JSON.stringify({
      voice: request.voice,
      speed: request.speed,
      chunks
    })
  });

  const latencyMs = Math.round((performance.now() - startedAt) * 100) / 100;
  console.info(
    "[ttsClient] python synthesis response",
    JSON.stringify({
      mode,
      status: response.status,
      ok: response.ok,
      latencyMs,
      chunkCount: chunks.length,
      textLengths: chunks.map((chunk) => chunk.text.length)
    })
  );

  if (!response.ok) {
    throw new HttpError("Python TTS service rejected the synthesis request", 502, {
      mode,
      response: await safeJson(response)
    });
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

async function synthesizeWithFallback(sentence: SentenceChunk, voice: string, speed: number): Promise<SynthesisQueueItem | null> {
  try {
    const [item] = await requestPythonSynthesis({ voice, speed, sentences: [sentence] }, "single-retry");
    return item ?? null;
  } catch (error) {
    console.warn(
      "[ttsClient] single sentence retry failed, trying smaller fragments",
      JSON.stringify({
        chunkId: sentence.id,
        sentenceIndex: sentence.sentenceIndex,
        textLength: sentence.text.length,
        preview: summarizeText(sentence.text),
        error: error instanceof Error ? error.message : String(error)
      })
    );
  }

  const retryFragments = splitTextForTts(sentence.text, Math.min(RETRY_TTS_MAX_CHARS, SAFE_TTS_MAX_CHARS));
  if (retryFragments.length <= 1) {
    console.error(
      "[ttsClient] skipping failed sentence after retry exhaustion",
      JSON.stringify({
        chunkId: sentence.id,
        sentenceIndex: sentence.sentenceIndex,
        textLength: sentence.text.length,
        preview: summarizeText(sentence.text)
      })
    );
    return null;
  }

  try {
    const fragmentItems: SynthesisQueueItem[] = [];
    for (let index = 0; index < retryFragments.length; index += 1) {
      const fragment = retryFragments[index];
      const [item] = await requestPythonSynthesis(
        {
          voice,
          speed,
          sentences: [
            {
              ...sentence,
              id: `${sentence.id}::${index}`,
              text: fragment
            }
          ]
        },
        "fragment-retry"
      );

      if (!item) {
        throw new Error("Missing synthesized fragment");
      }
      fragmentItems.push(item);
    }

    return combineSynthesisItems(sentence, fragmentItems);
  } catch (error) {
    console.error(
      "[ttsClient] skipping failed sentence after fragment retry",
      JSON.stringify({
        chunkId: sentence.id,
        sentenceIndex: sentence.sentenceIndex,
        textLength: sentence.text.length,
        fragmentCount: retryFragments.length,
        preview: summarizeText(sentence.text),
        error: error instanceof Error ? error.message : String(error)
      })
    );
    return null;
  }
}

function combineSynthesisItems(sentence: SentenceChunk, fragments: SynthesisQueueItem[]): SynthesisQueueItem {
  const decoded = fragments.map((fragment) => decodeWav(Buffer.from(fragment.audioBase64, "base64")));
  const base = decoded[0];

  for (const wav of decoded.slice(1)) {
    if (wav.sampleRate !== base.sampleRate || wav.numChannels !== base.numChannels || wav.bitsPerSample !== base.bitsPerSample) {
      throw new Error("Incompatible WAV fragments returned from Python TTS service");
    }
  }

  const combinedData = Buffer.concat(decoded.map((wav) => wav.data));
  const combinedWav = encodeWav(base.sampleRate, base.numChannels, base.bitsPerSample, combinedData);
  const totalDurationMs = fragments.reduce((sum, fragment) => sum + fragment.durationMs, 0);

  console.info(
    "[ttsClient] fragment retry succeeded",
    JSON.stringify({
      chunkId: sentence.id,
      sentenceIndex: sentence.sentenceIndex,
      fragmentCount: fragments.length,
      totalDurationMs
    })
  );

  return {
    chunkId: sentence.id,
    sentenceIndex: sentence.sentenceIndex,
    durationMs: totalDurationMs,
    sampleRate: base.sampleRate,
    audioBase64: combinedWav.toString("base64")
  };
}

function summarizeText(text: string): string {
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function decodeWav(buffer: Buffer): { sampleRate: number; numChannels: number; bitsPerSample: number; data: Buffer } {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Invalid WAV header");
  }

  const numChannels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (chunkId === "data") {
      return {
        sampleRate,
        numChannels,
        bitsPerSample,
        data: buffer.subarray(dataOffset, dataOffset + chunkSize)
      };
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }

  throw new Error("WAV data chunk not found");
}

function encodeWav(sampleRate: number, numChannels: number, bitsPerSample: number, pcmData: Buffer): Buffer {
  const header = Buffer.alloc(44);
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcmData.length, 40);
  return Buffer.concat([header, pcmData]);
}
