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

export interface UploadResponse {
  document: ParsedDocument;
  progress: PlaybackProgress | null;
}

export interface SynthesisQueueItem {
  chunkId: string;
  sentenceIndex: number;
  durationMs: number;
  sampleRate: number;
  audioBase64: string;
}

export interface TtsHealth {
  status: string;
  cuda_available: boolean;
  device_name: string;
  vram_total_mb: number | null;
  vram_reserved_mb: number | null;
  vram_allocated_mb: number | null;
  warm: boolean;
}
