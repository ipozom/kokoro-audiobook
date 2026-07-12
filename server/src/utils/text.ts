import type { SentenceChunk } from "../types.js";

/** Collapse control characters and normalize whitespace for safe UI rendering and TTS. */
export function normalizeExtractedText(input: string): string {
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

  return parts.map((part, offset) => ({
    id: `${pageNumber}-${startIndex + offset}`,
    pageNumber,
    sentenceIndex: startIndex + offset,
    text: part
  }));
}
