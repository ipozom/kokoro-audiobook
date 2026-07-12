/** Shared server-side domain types. */

export interface SentenceChunk {
  id: string;
  pageNumber: number;
  sentenceIndex: number;
  text: string;
}

export interface ParsedDocument {
  documentId: string;
  fileName: string;
  pageCount: number;
  plainText: string;
  sentences: SentenceChunk[];
}

export interface PlaybackProgress {
  documentId: string;
  currentPage: number;
  sentenceIndex: number;
  playbackState: "idle" | "playing" | "paused";
  speed: number;
  updatedAt: string;
}

export interface SynthesisQueueRequest {
  voice: string;
  speed: number;
  sentences: SentenceChunk[];
}

export interface SynthesisQueueItem {
  chunkId: string;
  sentenceIndex: number;
  durationMs: number;
  sampleRate: number;
  audioBase64: string;
}
