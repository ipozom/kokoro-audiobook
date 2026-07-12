import { useEffect, useEffectEvent, useRef, useState } from "react";

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

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  useEffect(() => {
    sentenceIndexRef.current = state.currentSentenceIndex;
    playbackRateRef.current = state.playbackRate;
  }, [state.currentSentenceIndex, state.playbackRate]);

  useEffect(() => {
    if (!document) {
      cacheRef.current.clear();
      durationsRef.current.clear();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
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

    setState({
      currentSentenceIndex: initialProgress?.sentenceIndex ?? 0,
      currentPage: initialProgress?.currentPage ?? document.sentences[0]?.pageNumber ?? 1,
      isPlaying: false,
      isLoading: false,
      playbackRate: initialProgress?.speed ?? 1,
      error: null
    });
  }, [document, initialProgress]);

  const handleEnded = useEffectEvent(() => {
    const activeDocument = documentRef.current;
    if (!activeDocument) {
      return;
    }

    const nextIndex = sentenceIndexRef.current + 1;
    if (nextIndex >= activeDocument.sentences.length) {
      setState((current) => ({ ...current, isPlaying: false }));
      return;
    }

    const nextSentence = activeDocument.sentences[nextIndex];
    sentenceIndexRef.current = nextIndex;
    setState((current) => ({
      ...current,
      currentSentenceIndex: nextIndex,
      currentPage: nextSentence.pageNumber,
      isPlaying: false
    }));

    void play();
  });

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.addEventListener("ended", handleEnded);
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.removeEventListener("ended", handleEnded);
        audioRef.current.pause();
      }
    };
  }, [handleEnded]);

  useEffect(() => {
    if (!document) {
      return;
    }

    void persistProgress(document, state);
  }, [document, state.currentPage, state.currentSentenceIndex, state.isPlaying, state.playbackRate]);

  async function play(): Promise<void> {
    if (!document) {
      return;
    }

    const sentence = document.sentences[state.currentSentenceIndex];
    if (!sentence) {
      return;
    }

    setState((current) => ({ ...current, isLoading: true, error: null }));

    try {
      await ensureBuffered(document, state.currentSentenceIndex, state.playbackRate);
      const src = cacheRef.current.get(state.currentSentenceIndex);
      if (!src) {
        throw new Error("Audio cache miss");
      }

      audioRef.current.src = src;
      audioRef.current.playbackRate = state.playbackRate;
      await audioRef.current.play();

      setState((current) => ({
        ...current,
        currentPage: sentence.pageNumber,
        isPlaying: true,
        isLoading: false
      }));
      void ensureBuffered(document, state.currentSentenceIndex + 1, state.playbackRate);
    } catch (error) {
      setState((current) => ({
        ...current,
        isPlaying: false,
        isLoading: false,
        error: error instanceof Error ? error.message : "Playback failed"
      }));
    }
  }

  function pause(): void {
    audioRef.current?.pause();
    setState((current) => ({ ...current, isPlaying: false }));
  }

  function stop(): void {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setState((current) => ({ ...current, isPlaying: false, currentSentenceIndex: 0, currentPage: 1 }));
  }

  function seekSentence(index: number): void {
    if (!document) {
      return;
    }

    const clamped = Math.max(0, Math.min(index, document.sentences.length - 1));
    const sentence = document.sentences[clamped];
    audioRef.current?.pause();
    setState((current) => ({
      ...current,
      currentSentenceIndex: clamped,
      currentPage: sentence.pageNumber,
      isPlaying: false
    }));
  }

  function skip(delta: number): void {
    seekSentence(state.currentSentenceIndex + delta);
  }

  function setPlaybackRate(rate: number): void {
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
    playbackRateRef.current = rate;
    setState((current) => ({ ...current, playbackRate: rate }));
  }

  async function ensureBuffered(parsedDocument: ParsedDocument, startIndex: number, speed: number): Promise<void> {
    const missing = parsedDocument.sentences
      .slice(startIndex, startIndex + PREFETCH_WINDOW)
      .filter((sentence) => !cacheRef.current.has(sentence.sentenceIndex));

    if (missing.length === 0) {
      return;
    }

    const items = await queueSynthesis({
      voice: "af_sarah",
      speed,
      sentences: missing
    });
    hydrateCache(items);
  }

  function hydrateCache(items: SynthesisQueueItem[]): void {
    for (const item of items) {
      cacheRef.current.set(item.sentenceIndex, `data:audio/wav;base64,${item.audioBase64}`);
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
    setPlaybackRate
  };
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
