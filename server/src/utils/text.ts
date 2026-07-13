import type { SentenceChunk } from "../types.js";

export const SAFE_TTS_MAX_CHARS = 260;
export const RETRY_TTS_MAX_CHARS = 140;

/** Collapse control characters and normalize whitespace for safe UI rendering and TTS. */
export function normalizeExtractedText(input: string): string {
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Apply a stricter normalization pass before sending text into the TTS runtime. */
export function normalizeTtsText(input: string): string {
  return normalizeExtractedText(input)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .trim();
}

/** Split long text into punctuation-aware fragments that stay within a safe TTS character budget. */
export function splitTextForTts(text: string, maxChars: number = SAFE_TTS_MAX_CHARS): string[] {
  const normalized = normalizeTtsText(text);
  if (!normalized) {
    return [];
  }

  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const punctuationParts = normalized
    .split(/(?<=[,;:.!?])\s+/g)
    .map((part) => part.trim())
    .filter(Boolean);

  const segments: string[] = [];
  let current = "";

  for (const part of punctuationParts) {
    if (part.length > maxChars) {
      if (current) {
        segments.push(current);
        current = "";
      }
      segments.push(...splitWordsByLength(part, maxChars));
      continue;
    }

    const candidate = current ? `${current} ${part}` : part;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      segments.push(current);
    }
    current = part;
  }

  if (current) {
    segments.push(current);
  }

  return segments.flatMap((segment) => (segment.length > maxChars ? splitWordsByLength(segment, maxChars) : [segment]));
}

/** Split a page into sentence-sized chunks suitable for low-latency TTS. */
export function segmentPageText(pageNumber: number, text: string, startIndex: number): SentenceChunk[] {
  const normalized = normalizeExtractedText(text);
  if (!normalized) {
    return [];
  }

  const parts = normalized
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/g)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const chunks: SentenceChunk[] = [];
  let nextIndex = startIndex;

  for (const part of parts) {
    for (const fragment of splitTextForTts(part, SAFE_TTS_MAX_CHARS)) {
      chunks.push({
        id: `${pageNumber}-${nextIndex}`,
        pageNumber,
        sentenceIndex: nextIndex,
        text: fragment
      });
      nextIndex += 1;
    }
  }

  return chunks;
}

function splitWordsByLength(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/g).filter(Boolean);
  const segments: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        segments.push(current);
        current = "";
      }

      for (let index = 0; index < word.length; index += maxChars) {
        segments.push(word.slice(index, index + maxChars));
      }
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      segments.push(current);
    }
    current = word;
  }

  if (current) {
    segments.push(current);
  }

  return segments;
}
