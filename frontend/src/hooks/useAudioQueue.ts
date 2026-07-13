import { useEffect, useRef, useState } from "react";

import { queueSynthesis, saveProgress } from "../lib/api";
import type { ParsedDocument, PlaybackProgress, SentenceChunk, SynthesisQueueItem } from "../types";

interface AudioQueueState {
  currentSentenceIndex: number;
  currentPage: number;
  isPlaying: boolean;
  isLoading: boolean;
  playbackRate: number;
  error: string | null;
}

interface UseAudioQueueResult extends AudioQueueState {
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  seekSentence(index: number): void;
  skip(delta: number): void;
  startFromPage(pageNumber: number): Promise<void>;
  setPlaybackRate(rate: number): void;
}

const PREFETCH_WINDOW = 4;

/** Coordinate synthesis queueing, browser audio playback, and progress persistence. */
export function useAudioQueue(document: ParsedDocument | null, initialProgress: PlaybackProgress | null): UseAudioQueueResult {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<Map<number, string>>(new Map());
  const durationsRef = useRef<Map<number, number>>(new Map());
  const documentRef = useRef<ParsedDocument | null>(document);
  const sentenceIndexRef = useRef(initialProgress?.sentenceIndex ?? 0);
  const playbackRateRef = useRef(initialProgress?.speed ?? 1);
  const [state, setState] = useState<AudioQueueState>({
    currentSentenceIndex: initialProgress?.sentenceIndex ?? 0,
    currentPage: initialProgress?.currentPage ?? 1,
    isPlaying: initialProgress?.playbackState === "playing",
    isLoading: false,
    playbackRate: initialProgress?.speed ?? 1,
    error: null
  });

  function resetRuntime(clearCache: boolean): void {
    resetPlaybackRuntime(clearCache, audioRef.current, cacheRef.current, durationsRef.current);
  }

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  useEffect(() => {
    sentenceIndexRef.current = state.currentSentenceIndex;
    playbackRateRef.current = state.playbackRate;
  }, [state.currentSentenceIndex, state.playbackRate]);

  useEffect(() => {
    if (!document) {
      resetRuntime(true);
      sentenceIndexRef.current = 0;
      setState({
        currentSentenceIndex: 0,
        currentPage: 1,
        isPlaying: false,
        isLoading: false,
        playbackRate: 1,
        error: null
      });
      return;
    }

    const restoredPosition = resolvePlaybackPosition(document, initialProgress);
    sentenceIndexRef.current = restoredPosition.sentenceIndex;
    playbackRateRef.current = initialProgress?.speed ?? 1;
    setState({
      currentSentenceIndex: restoredPosition.sentenceIndex,
      currentPage: restoredPosition.pageNumber,
      isPlaying: false,
      isLoading: false,
      playbackRate: initialProgress?.speed ?? 1,
      error: null
    });
  }, [document, initialProgress]);

  function handleEnded(): void {
    const activeDocument = documentRef.current;
    if (!activeDocument) {
      return;
    }

    console.log("[DEBUG] ENDED:", {
      currentSentenceIndex: sentenceIndexRef.current
    });
    void advanceToNextSentence(activeDocument, sentenceIndexRef.current);
  }

  function handlePlay(): void {
    const activeDocument = documentRef.current;
    const sentence = activeDocument ? findSentenceByIndex(activeDocument.sentences, sentenceIndexRef.current) : null;
    console.log("[DEBUG] START PLAYING:", {
      sentenceIndex: sentenceIndexRef.current,
      pageNumber: sentence?.pageNumber ?? null
    });
    console.info("[audio] playback started", {
      sentenceIndex: sentenceIndexRef.current,
      playbackRate: playbackRateRef.current
    });
  }

  function handleError(): void {
    const audio = audioRef.current;
    const message = audio?.error?.message ?? `media error code ${audio?.error?.code ?? "unknown"}`;
    console.error("[audio] playback failed", {
      sentenceIndex: sentenceIndexRef.current,
      message
    });
    setState((current) => ({ ...current, isPlaying: false, isLoading: false, error: message }));
  }

  useEffect(() => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.volume = 1;
    audio.muted = false;
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("error", handleError);

    if (typeof window !== "undefined") {
      window.__kokoroAudio = audio;
    }

    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("error", handleError);
      audio.pause();
      if (typeof window !== "undefined") {
        delete window.__kokoroAudio;
      }
      revokeCachedAudioUrls(cacheRef.current);
    };
  }, []);

  useEffect(() => {
    if (!document) {
      return;
    }

    void persistProgress(document, state);
  }, [document, state.currentPage, state.currentSentenceIndex, state.isPlaying, state.playbackRate]);

  async function play(): Promise<void> {
    await playSentenceAt(sentenceIndexRef.current);
  }

  function pause(): void {
    audioRef.current?.pause();
    setState((current) => ({ ...current, isPlaying: false }));
  }

  function stop(): void {
    const activeDocument = documentRef.current;
    const firstSentence = activeDocument?.sentences[0];
    resetRuntime(false);
    sentenceIndexRef.current = firstSentence?.sentenceIndex ?? 0;
    setState((current) => ({
      ...current,
      isPlaying: false,
      isLoading: false,
      currentSentenceIndex: firstSentence?.sentenceIndex ?? 0,
      currentPage: firstSentence?.pageNumber ?? 1,
      error: null
    }));
  }

  function seekSentence(index: number): void {
    if (!document) {
      return;
    }

    const clamped = Math.max(0, Math.min(index, document.sentences.length - 1));
    const sentence = document.sentences[clamped];
    resetRuntime(false);
    sentenceIndexRef.current = clamped;
    setState((current) => ({
      ...current,
      currentSentenceIndex: clamped,
      currentPage: sentence.pageNumber,
      isPlaying: false,
      isLoading: false,
      error: null
    }));
  }

  function skip(delta: number): void {
    seekSentence(state.currentSentenceIndex + delta);
  }

  async function startFromPage(pageNumber: number): Promise<void> {
    const activeDocument = documentRef.current;
    if (!activeDocument) {
      return;
    }

    const clampedPage = clampPageNumber(pageNumber, activeDocument.pageCount);
    const firstSentenceIndex = findFirstSentenceIndexForPage(activeDocument.sentences, clampedPage);

    resetRuntime(true);

    if (firstSentenceIndex === null) {
      sentenceIndexRef.current = -1;
      setState((current) => ({
        ...current,
        currentSentenceIndex: -1,
        currentPage: clampedPage,
        isPlaying: false,
        isLoading: false,
        error: `Page ${clampedPage} has no readable sentences.`
      }));
      return;
    }

    sentenceIndexRef.current = firstSentenceIndex;
    setState((current) => ({
      ...current,
      currentSentenceIndex: firstSentenceIndex,
      currentPage: clampedPage,
      isPlaying: false,
      isLoading: true,
      error: null
    }));

    await playSentenceAt(firstSentenceIndex);
  }

  function setPlaybackRate(rate: number): void {
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
    playbackRateRef.current = rate;
    setState((current) => ({ ...current, playbackRate: rate }));
  }

  async function ensureBuffered(parsedDocument: ParsedDocument, startIndex: number, speed: number): Promise<void> {
    const startPosition = findSentencePositionByIndex(parsedDocument.sentences, startIndex);
    if (startPosition === null) {
      return;
    }

    const requestedSentences = parsedDocument.sentences
      .slice(startPosition, startPosition + PREFETCH_WINDOW);
    const missing = requestedSentences
      .filter((sentence) => !cacheRef.current.has(sentence.sentenceIndex));

    if (missing.length === 0) {
      return;
    }

    const items = await queueSynthesis({
      voice: "af_sarah",
      speed,
      sentences: missing
    });
    console.info("[audio] buffered synthesis response", {
      requestedSentenceIndexes: missing.map((sentence) => sentence.sentenceIndex),
      receivedSentenceIndexes: items.map((item) => item.sentenceIndex),
      itemCount: items.length
    });
    hydrateCache(items);
  }

  function hydrateCache(items: SynthesisQueueItem[]): void {
    for (const item of items) {
      if (!cacheRef.current.has(item.sentenceIndex)) {
        cacheRef.current.set(item.sentenceIndex, createAudioObjectUrl(item.audioBase64));
      }
      durationsRef.current.set(item.sentenceIndex, item.durationMs);
    }
  }

  return {
    ...state,
    play,
    pause,
    stop,
    seekSentence,
    skip,
    startFromPage,
    setPlaybackRate
  };

  async function playSentenceAt(index: number): Promise<void> {
    const activeDocument = documentRef.current;
    if (!activeDocument) {
      return;
    }

    const sentence = findSentenceByIndex(activeDocument.sentences, index);
    if (!sentence) {
      console.error("[DEBUG] PLAYBACK STOPPED:", {
        reason: "Selected sentence is unavailable.",
        currentSentenceIndex: index
      });
      setState((current) => ({
        ...current,
        isPlaying: false,
        isLoading: false,
        error: "Selected sentence is unavailable."
      }));
      return;
    }

    setState((current) => ({
      ...current,
      currentSentenceIndex: index,
      currentPage: sentence.pageNumber,
      isLoading: true,
      error: null
    }));

    try {
      await ensureBuffered(activeDocument, index, playbackRateRef.current);
      const src = cacheRef.current.get(index);
      if (!src) {
        const nextPlayableIndex = await findNextPlayableSentenceIndex(activeDocument, index, playbackRateRef.current, cacheRef.current);
        if (nextPlayableIndex !== null) {
          console.warn("[DEBUG] SKIPPING SENTENCE:", {
            sentenceIndex: index,
            reason: "No playable audio returned for sentence",
            nextPlayableIndex
          });
          console.log("[DEBUG] SELECT NEXT SENTENCE:", {
            fromIndex: index,
            nextCandidate: nextPlayableIndex
          });
          sentenceIndexRef.current = nextPlayableIndex;
          await playSentenceAt(nextPlayableIndex);
          return;
        }

        console.error("[DEBUG] PLAYBACK STOPPED:", {
          reason: "No playable audio returned and no forward candidate was found.",
          currentSentenceIndex: index
        });
        throw new Error("Failed to synthesize text");
      }

      const audio = audioRef.current;
      if (!audio) {
        throw new Error("Audio element unavailable");
      }

      audio.volume = 1;
      audio.muted = false;
      audio.src = src;
      audio.playbackRate = playbackRateRef.current;
      await audio.play();

      sentenceIndexRef.current = index;
      setState((current) => ({
        ...current,
        currentSentenceIndex: index,
        currentPage: sentence.pageNumber,
        isPlaying: true,
        isLoading: false,
        error: null
      }));
      void ensureBuffered(activeDocument, index + 1, playbackRateRef.current);
    } catch (error) {
      console.error("[DEBUG] PLAYBACK STOPPED:", {
        reason: error instanceof Error ? error.message : "Playback failed",
        currentSentenceIndex: index
      });
      setState((current) => ({
        ...current,
        isPlaying: false,
        isLoading: false,
        error: error instanceof Error ? error.message : "Playback failed"
      }));
    }
  }

  async function advanceToNextSentence(activeDocument: ParsedDocument, currentSentenceIndex: number): Promise<void> {
    const nextSentenceIndex = await findNextPlayableSentenceIndex(
      activeDocument,
      currentSentenceIndex,
      playbackRateRef.current,
      cacheRef.current
    );

    console.log("[DEBUG] SELECT NEXT SENTENCE:", {
      fromIndex: currentSentenceIndex,
      nextCandidate: nextSentenceIndex
    });

    if (nextSentenceIndex === null) {
      console.error("[DEBUG] PLAYBACK STOPPED:", {
        reason: "No more playable sentences were found after the current sentence.",
        currentSentenceIndex
      });
      setState((current) => ({ ...current, isPlaying: false, isLoading: false }));
      return;
    }

    sentenceIndexRef.current = nextSentenceIndex;
    await playSentenceAt(nextSentenceIndex);
  }
}

async function persistProgress(document: ParsedDocument, state: AudioQueueState): Promise<void> {
  await saveProgress({
    documentId: document.documentId,
    currentPage: state.currentPage,
    sentenceIndex: state.currentSentenceIndex,
    playbackState: state.isPlaying ? "playing" : "paused",
    speed: state.playbackRate,
    updatedAt: new Date().toISOString()
  });
}

function createAudioObjectUrl(audioBase64: string): string {
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const blob = new Blob([bytes], { type: "audio/wav" });
  const objectUrl = URL.createObjectURL(blob);
  console.info("[audio] created wav object URL", { bytes: bytes.byteLength, objectUrl });
  return objectUrl;
}

function findFirstSentenceIndexForPage(sentences: SentenceChunk[], pageNumber: number): number | null {
  const match = sentences.find((sentence) => sentence.pageNumber === pageNumber);
  return match?.sentenceIndex ?? null;
}

function clampPageNumber(pageNumber: number, totalPages: number): number {
  return Math.min(Math.max(pageNumber, 1), Math.max(totalPages, 1));
}

function resolvePlaybackPosition(document: ParsedDocument, initialProgress: PlaybackProgress | null): { sentenceIndex: number; pageNumber: number } {
  const firstSentence = document.sentences[0];
  const fallback = {
    sentenceIndex: firstSentence?.sentenceIndex ?? 0,
    pageNumber: firstSentence?.pageNumber ?? 1
  };

  if (!initialProgress) {
    return fallback;
  }

  const clampedPage = clampPageNumber(initialProgress.currentPage, document.pageCount);
  const matchingSentence = document.sentences[initialProgress.sentenceIndex];
  if (matchingSentence && matchingSentence.pageNumber === clampedPage) {
    return {
      sentenceIndex: matchingSentence.sentenceIndex,
      pageNumber: clampedPage
    };
  }

  const firstSentenceIndex = findFirstSentenceIndexForPage(document.sentences, clampedPage);
  if (firstSentenceIndex !== null) {
    return {
      sentenceIndex: firstSentenceIndex,
      pageNumber: clampedPage
    };
  }

  return fallback;
}

function findNextBufferedSentenceIndex(cache: Map<number, string>, document: ParsedDocument, startIndex: number): number | null {
  const startPosition = findSentencePositionByIndex(document.sentences, startIndex);
  if (startPosition === null) {
    return null;
  }

  for (let position = startPosition; position < Math.min(document.sentences.length, startPosition + PREFETCH_WINDOW); position += 1) {
    const sentence = document.sentences[position];
    if (cache.has(sentence.sentenceIndex)) {
      return sentence.sentenceIndex;
    }
  }

  return null;
}

async function findNextPlayableSentenceIndex(
  document: ParsedDocument,
  currentSentenceIndex: number,
  playbackRate: number,
  cache: Map<number, string>
): Promise<number | null> {
  const currentPosition = findSentencePositionByIndex(document.sentences, currentSentenceIndex);
  if (currentPosition === null) {
    return null;
  }

  for (let startPosition = currentPosition + 1; startPosition < document.sentences.length; startPosition += PREFETCH_WINDOW) {
    const startSentence = document.sentences[startPosition];
    if (!startSentence) {
      return null;
    }

    const requestedWindow = document.sentences.slice(startPosition, startPosition + PREFETCH_WINDOW);
    const missing = requestedWindow.filter((sentence) => !cache.has(sentence.sentenceIndex));
    if (missing.length > 0) {
      const items = await queueSynthesis({
        voice: "af_sarah",
        speed: playbackRate,
        sentences: missing
      });

      console.info("[audio] forward-fill synthesis response", {
        requestedSentenceIndexes: missing.map((sentence) => sentence.sentenceIndex),
        receivedSentenceIndexes: items.map((item) => item.sentenceIndex),
        itemCount: items.length
      });

      for (const item of items) {
        if (!cache.has(item.sentenceIndex)) {
          cache.set(item.sentenceIndex, createAudioObjectUrl(item.audioBase64));
        }
      }
    }

    for (const sentence of requestedWindow) {
      if (cache.has(sentence.sentenceIndex)) {
        return sentence.sentenceIndex;
      }

      console.warn("[DEBUG] SKIPPING SENTENCE:", {
        sentenceIndex: sentence.sentenceIndex,
        reason: "No playable audio returned after buffering"
      });
    }
  }

  return null;
}

function findSentenceByIndex(sentences: SentenceChunk[], sentenceIndex: number): SentenceChunk | null {
  return sentences.find((sentence) => sentence.sentenceIndex === sentenceIndex) ?? null;
}

function findSentencePositionByIndex(sentences: SentenceChunk[], sentenceIndex: number): number | null {
  const position = sentences.findIndex((sentence) => sentence.sentenceIndex === sentenceIndex);
  return position >= 0 ? position : null;
}

function revokeCachedAudioUrls(cache: Map<number, string>): void {
  for (const objectUrl of cache.values()) {
    URL.revokeObjectURL(objectUrl);
  }
  cache.clear();
}

function resetPlaybackRuntime(clearCache: boolean, audio: HTMLAudioElement | null = null, cache?: Map<number, string>, durations?: Map<number, number>): void {
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
    audio.src = "";
  }

  if (clearCache && cache && durations) {
    revokeCachedAudioUrls(cache);
    durations.clear();
  }
}

declare global {
  interface Window {
    __kokoroAudio?: HTMLAudioElement | null;
  }
}
