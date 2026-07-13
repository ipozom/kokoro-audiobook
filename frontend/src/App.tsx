import { useEffect, useState } from "react";

import { DocumentReader } from "./components/DocumentReader";
import { PlaybackControls } from "./components/PlaybackControls";
import { StatusPanel } from "./components/StatusPanel";
import { UploadPanel } from "./components/UploadPanel";
import { useAudioQueue } from "./hooks/useAudioQueue";
import { fetchTtsHealth, uploadPdf } from "./lib/api";
import type { ParsedDocument, PlaybackProgress, TtsHealth } from "./types";

/** Root application for the Kokoro audiobook player. */
export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [document, setDocument] = useState<ParsedDocument | null>(null);
  const [progress, setProgress] = useState<PlaybackProgress | null>(null);
  const [health, setHealth] = useState<TtsHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playback = useAudioQueue(document, progress);

  useEffect(() => {
    void fetchTtsHealth().then(setHealth).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Failed to load TTS health");
    });
  }, []);

  async function handleFile(fileToUpload: File): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await uploadPdf(fileToUpload);
      setFile(fileToUpload);
      setDocument(response.document);
      setProgress(response.progress);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "PDF upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-8 text-ink md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-[2rem] bg-ink px-8 py-10 text-white shadow-panel">
          <p className="text-sm uppercase tracking-[0.35em] text-amber-200">Local GPU Audiobook PDF Player</p>
          <h1 className="mt-4 max-w-4xl font-display text-5xl leading-tight md:text-6xl">
            Read PDFs with Kokoro-82M speech synthesis on your GTX 1080 Ti.
          </h1>
          <p className="mt-4 max-w-3xl text-lg text-stone-300">
            This stack validates PDFs, extracts sentence chunks, synthesizes audio locally through a CUDA-backed Python microservice, and restores listening progress across sessions.
          </p>
        </header>

        <StatusPanel document={document} health={health} error={error ?? playback.error} />

        {!document ? (
          <UploadPanel onFileSelected={(selectedFile) => void handleFile(selectedFile)} busy={busy} />
        ) : (
          <>
            <PlaybackControls
              isPlaying={playback.isPlaying}
              isLoading={playback.isLoading}
              playbackRate={playback.playbackRate}
              onPlay={() => void playback.play()}
              onPause={playback.pause}
              onStop={playback.stop}
              onSkip={playback.skip}
              onSpeedChange={playback.setPlaybackRate}
            />
            <DocumentReader
              file={file}
              document={document}
              currentPage={playback.currentPage}
              currentSentenceIndex={playback.currentSentenceIndex}
              onSentenceClick={playback.seekSentence}
              onStartFromPage={(pageNumber) => void playback.startFromPage(pageNumber)}
            />
          </>
        )}
      </div>
    </main>
  );
}