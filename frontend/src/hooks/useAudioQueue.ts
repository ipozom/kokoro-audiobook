import { useEffect, useRef, useState } from "react";

import { queueSynthesis, saveProgress } from "../lib/api";
import { logAudioError, logAudioInfo, logAudioWarn, logDebug } from "../lib/logger";
import type { ParsedDocument, PlaybackProgress, SentenceChunk, SynthesisQueueItem } from "../types";

type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "error";

interface AudioQueueState {
  currentSentenceIndex: number;
  currentPage: number;
  isPlaying: boolean;
  isLoading: boolean;
  playbackRate: number;
  playbackStatus: PlaybackStatus;
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
const AUDIO_CACHE_LIMIT = 48;

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
    isPlaying: false,
    isLoading: false,
    playbackRate: initialProgress?.speed ?? 1,
    playbackStatus: initialProgress?.playbackState === "playing" ? "paused" : "idle",
    error: null
  });

  function resetRuntime(clearCache: boolean): void {
    resetPlaybackRuntime(clearCache, audioRef.current, cacheRef.current, durationsRef.current);
  }

  function transitionState(status: PlaybackStatus, updates: Partial<AudioQueueState> = {}): void {
    setState((current) => ({
      ...current,
      ...updates,
      playbackStatus: status,
      isPlaying: status === "playing",
      isLoading: status === "loading"
    }));
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
        playbackStatus: "idle",
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
      playbackStatus: "paused",
      error: null
    });
  }, [document, initialProgress]);

  useEffect(() => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.volume = 1;
    audio.muted = false;

    const handleEnded = (): void => {
      const activeDocument = documentRef.current;
      if (!activeDocument) {
        return;
      }

      logDebug("ENDED", {
        currentSentenceIndex: sentenceIndexRef.current
      });
      void advanceToNextSentence(activeDocument, sentenceIndexRef.current);
    };

    const handlePlay = (): void => {
      const activeDocument = documentRef.current;
      const sentence = activeDocument ? findSentenceByIndex(activeDocument.sentences, sentenceIndexRef.current) : null;
      logDebug("START PLAYING", {
        sentenceIndex: sentenceIndexRef.current,
        pageNumber: sentence?.pageNumber ?? null
      });
      logAudioInfo("playback started", {
        sentenceIndex: sentenceIndexRef.current,
        playbackRate: playbackRateRef.current
      });
    };

    const handleError = (): void => {
      const message = describeAudioError(audio);
      if (audio.src.length === 0) {
        logDebug("ignored empty-src media error", {
          sentenceIndex: sentenceIndexRef.current,
          message
        });
        return;
      }

      logAudioError("playback failed", {
        sentenceIndex: sentenceIndexRef.current,
        message
      });
      transitionState("error", { error: message });
    };

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
    transitionState("loading");
    await playSentenceAt(sentenceIndexRef.current);
  }

  function pause(): void {
    audioRef.current?.pause();
    transitionState("paused");
  }

  function stop(): void {
    const activeDocument = documentRef.current;
    const firstSentence = activeDocument?.sentences[0];
    resetRuntime(false);
    sentenceIndexRef.current = firstSentence?.sentenceIndex ?? 0;
    setState((current) => ({
      ...current,
      playbackStatus: "idle",
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

    const sentence = resolveRequestedSentence(document.sentences, index);
    if (!sentence) {
      return;
    }

    resetRuntime(false);
    sentenceIndexRef.current = sentence.sentenceIndex;
    setState((current) => ({
      ...current,
      currentSentenceIndex: sentence.sentenceIndex,
      currentPage: sentence.pageNumber,
      isPlaying: false,
      isLoading: false,
      playbackStatus: "paused",
      error: null
    }));
  }

  function skip(delta: number): void {
    if (!document) {
      return;
    }

    const nextSentenceIndex = findSentenceIndexByOffset(document.sentences, state.currentSentenceIndex, delta);
    if (nextSentenceIndex === null) {
      logDebug("END OF DOCUMENT", {
        currentSentenceIndex: state.currentSentenceIndex,
        delta
      });
      return;
    }

    seekSentence(nextSentenceIndex);
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
        playbackStatus: "error",
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
      playbackStatus: "loading",
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
    logDebug("BUFFERED SYNTHESIS RESPONSE", {
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

    trimAudioCache(cacheRef.current, durationsRef.current, sentenceIndexRef.current);
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
      logAudioError("playback stopped", {
        reason: "Selected sentence is unavailable.",
        currentSentenceIndex: index
      });
      transitionState("error", { error: "Selected sentence is unavailable." });
      return;
    }

    transitionState("loading", {
      currentSentenceIndex: index,
      currentPage: sentence.pageNumber,
      error: null
    });

    try {
      await ensureBuffered(activeDocument, index, playbackRateRef.current);
      const src = cacheRef.current.get(index);
      if (!src) {
        const nextPlayableIndex = await findNextPlayableSentenceIndex(activeDocument, index, playbackRateRef.current, cacheRef.current);
        if (nextPlayableIndex !== null) {
          logAudioWarn("skipping sentence", {
            sentenceIndex: index,
            reason: "No playable audio returned for sentence",
            nextPlayableIndex
          });
          logDebug("SELECT NEXT SENTENCE", {
            fromIndex: index,
            nextCandidate: nextPlayableIndex
          });
          sentenceIndexRef.current = nextPlayableIndex;
          await playSentenceAt(nextPlayableIndex);
          return;
        }

        logAudioError("playback stopped", {
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
      if (audio.src !== src) {
        audio.src = src;
      }
      if (!audio.src || audio.src.length === 0) {
        throw new Error("Audio source unavailable");
      }
      audio.playbackRate = playbackRateRef.current;
      await audio.play();

      sentenceIndexRef.current = index;
      transitionState("playing", {
        currentSentenceIndex: index,
        currentPage: sentence.pageNumber,
        error: null
      });
      void ensureBuffered(activeDocument, index + 1, playbackRateRef.current);
    } catch (error) {
      logAudioError("playback stopped", {
        reason: error instanceof Error ? error.message : "Playback failed",
        currentSentenceIndex: index
      });
      transitionState("error", { error: error instanceof Error ? error.message : "Playback failed" });
    }
  }

  async function advanceToNextSentence(activeDocument: ParsedDocument, currentSentenceIndex: number): Promise<void> {
    const nextSentenceIndex = await findNextPlayableSentenceIndex(
      activeDocument,
      currentSentenceIndex,
      playbackRateRef.current,
      cacheRef.current
    );

    logDebug("SELECT NEXT SENTENCE", {
      fromIndex: currentSentenceIndex,
      nextCandidate: nextSentenceIndex
    });

    if (nextSentenceIndex === null) {
      logDebug("END OF DOCUMENT", {
        currentSentenceIndex
      });
      transitionState("paused");
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
  logDebug("CREATED WAV OBJECT URL", { bytes: bytes.byteLength, objectUrl });
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
  const matchingSentence = findSentenceByIndex(document.sentences, initialProgress.sentenceIndex);
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

      logDebug("FORWARD-FILL SYNTHESIS RESPONSE", {
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

      logAudioWarn("skipping sentence", {
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
  }

  if (clearCache && cache && durations) {
    revokeCachedAudioUrls(cache);
    durations.clear();
  }
}

function describeAudioError(audio: HTMLAudioElement): string {
  return audio.error?.message ?? `media error code ${audio.error?.code ?? "unknown"}`;
}

function resolveRequestedSentence(sentences: SentenceChunk[], requestedIndex: number): SentenceChunk | null {
  const directMatch = findSentenceByIndex(sentences, requestedIndex);
  if (directMatch) {
    return directMatch;
  }

  const clampedPosition = Math.max(0, Math.min(requestedIndex, sentences.length - 1));
  return sentences[clampedPosition] ?? null;
}

function findSentenceIndexByOffset(sentences: SentenceChunk[], currentSentenceIndex: number, delta: number): number | null {
  const currentPosition = findSentencePositionByIndex(sentences, currentSentenceIndex);
  if (currentPosition === null) {
    return null;
  }

  const targetPosition = Math.max(0, Math.min(currentPosition + delta, sentences.length - 1));
  const targetSentence = sentences[targetPosition];
  if (!targetSentence || targetPosition === currentPosition) {
    return delta === 0 ? currentSentenceIndex : null;
  }

  return targetSentence.sentenceIndex;
}

function trimAudioCache(cache: Map<number, string>, durations: Map<number, number>, currentSentenceIndex: number): void {
  if (cache.size <= AUDIO_CACHE_LIMIT) {
    return;
  }

  const cachedSentenceIndexes = [...cache.keys()].sort((left, right) => left - right);
  for (const sentenceIndex of cachedSentenceIndexes) {
    if (cache.size <= AUDIO_CACHE_LIMIT) {
      return;
    }
    if (sentenceIndex >= currentSentenceIndex) {
      continue;
    }

    const objectUrl = cache.get(sentenceIndex);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    cache.delete(sentenceIndex);
    durations.delete(sentenceIndex);
  }
}

declare global {
  interface Window {
    __kokoroAudio?: HTMLAudioElement | null;
  }
}
