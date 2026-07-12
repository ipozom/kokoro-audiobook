import { useEffect, useMemo, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";

import type { ParsedDocument } from "../types";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();

interface DocumentReaderProps {
  file: File | null;
  document: ParsedDocument;
  currentSentenceIndex: number;
  onSentenceClick(index: number): void;
}

/** Render PDF pages to canvas and mirror the extracted text for synchronized highlighting. */
export function DocumentReader({ file, document, currentSentenceIndex, onSentenceClick }: DocumentReaderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pageNumber, setPageNumber] = useState(1);

  const sentencesOnPage = useMemo(
    () => document.sentences.filter((sentence) => sentence.pageNumber === pageNumber),
    [document.sentences, pageNumber]
  );

  useEffect(() => {
    const activeSentence = document.sentences[currentSentenceIndex];
    if (activeSentence) {
      setPageNumber(activeSentence.pageNumber);
    }
  }, [document.sentences, currentSentenceIndex]);

  useEffect(() => {
    if (!file || !canvasRef.current) {
      return;
    }

    void renderPdfPage(file, pageNumber, canvasRef.current);
  }, [file, pageNumber]);

  return (
    <section className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
      <div className="overflow-hidden rounded-[2rem] border border-stone-300/70 bg-white p-4 shadow-panel">
        <div className="mb-3 flex items-center justify-between">
          <p className="font-display text-2xl text-ink">PDF page {pageNumber}</p>
          <div className="flex gap-2">
            <button
              className="rounded-full border border-stone-300 px-4 py-2 text-sm"
              type="button"
              onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
            >
              Prev page
            </button>
            <button
              className="rounded-full border border-stone-300 px-4 py-2 text-sm"
              type="button"
              onClick={() => setPageNumber((current) => Math.min(document.pageCount, current + 1))}
            >
              Next page
            </button>
          </div>
        </div>
        <canvas ref={canvasRef} className="w-full rounded-xl bg-stone-100" />
      </div>

      <div className="rounded-[2rem] border border-stone-300/70 bg-white/90 p-5 shadow-panel">
        <p className="font-display text-2xl text-ink">Synchronized transcript</p>
        <div className="mt-4 flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-2">
          {sentencesOnPage.map((sentence) => {
            const active = sentence.sentenceIndex === currentSentenceIndex;
            return (
              <button
                key={sentence.id}
                type="button"
                onClick={() => onSentenceClick(sentence.sentenceIndex)}
                className={`rounded-2xl px-4 py-3 text-left text-base leading-7 text-stone-700 transition hover:bg-stone-100 ${active ? "sentence-active" : ""}`}
              >
                {sentence.text}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

async function renderPdfPage(file: File, pageNumber: number, canvas: HTMLCanvasElement): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.2 });
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context unavailable");
  }

  await page.render({ canvasContext: context, viewport }).promise;
}
