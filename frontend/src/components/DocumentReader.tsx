import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";

import type { ParsedDocument } from "../types";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface DocumentReaderProps {
  file: File | null;
  document: ParsedDocument;
  currentPage: number;
  currentSentenceIndex: number;
  onSentenceClick(index: number): void;
  onStartFromPage(pageNumber: number): void;
}

/** Render PDF pages to canvas and mirror the extracted text for synchronized highlighting. */
export function DocumentReader({ file, document, currentPage, currentSentenceIndex, onSentenceClick, onStartFromPage }: DocumentReaderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTaskLike | null>(null);
  const renderRequestIdRef = useRef(0);
  const pdfDocumentRef = useRef<Awaited<ReturnType<typeof pdfjsLib.getDocument>>["promise"] extends Promise<infer T> ? T : never | null>(null);
  const fileKeyRef = useRef<string | null>(null);
  const [pageNumber, setPageNumber] = useState(currentPage);
  const [startPageInput, setStartPageInput] = useState(String(currentPage));
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const sentencesOnPage = useMemo(
    () => document.sentences.filter((sentence) => sentence.pageNumber === pageNumber),
    [document.sentences, pageNumber]
  );

  useEffect(() => {
    setPageNumber(currentPage);
    setStartPageInput(String(currentPage));
    setValidationMessage(null);
  }, [currentPage]);

  const requestedStartPage = Number.parseInt(startPageInput, 10);
  const hasValidRequestedPage = Number.isInteger(requestedStartPage) && requestedStartPage >= 1 && requestedStartPage <= document.pageCount;

  function handleStartFromPage(): void {
    if (!hasValidRequestedPage) {
      setValidationMessage(`Enter a page between 1 and ${document.pageCount}.`);
      return;
    }

    setValidationMessage(null);
    onStartFromPage(requestedStartPage);
  }

  useEffect(() => {
    if (!file || !canvasRef.current) {
      return;
    }

    let disposed = false;
    const requestId = renderRequestIdRef.current + 1;
    renderRequestIdRef.current = requestId;

    void renderPdfPage({
      file,
      pageNumber,
      canvas: canvasRef.current,
      pdfDocumentRef,
      fileKeyRef,
      renderTaskRef,
      renderRequestIdRef,
      requestId
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name === "RenderingCancelledException") {
        console.info("[pdf] render cancelled", { pageNumber });
        return;
      }

      if (!disposed) {
        console.error("[pdf] render failed", { pageNumber, error });
      }
    });

    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [file, pageNumber]);

  return (
    <section className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
      <div className="overflow-hidden rounded-[2rem] border border-stone-300/70 bg-white p-4 shadow-panel">
        <div className="mb-3 flex items-center justify-between">
          <p className="font-display text-2xl text-ink">PDF page {pageNumber}</p>
          <div className="flex flex-wrap items-center gap-2">
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
            <label className="flex items-center gap-2 rounded-full border border-stone-300 px-3 py-2 text-sm text-stone-700">
              Start page
              <input
                className="w-20 bg-transparent text-right outline-none"
                type="number"
                min={1}
                max={document.pageCount}
                value={startPageInput}
                onChange={(event) => {
                  setStartPageInput(event.target.value);
                  setValidationMessage(null);
                }}
              />
            </label>
            <button
              className="rounded-full bg-ink px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={handleStartFromPage}
              disabled={!hasValidRequestedPage}
            >
              Start from page
            </button>
          </div>
        </div>
        {validationMessage ? <p className="mb-3 text-sm text-ember">{validationMessage}</p> : null}
        <canvas ref={canvasRef} className="block max-w-full rounded-xl bg-stone-100" />
      </div>

      <div className="rounded-[2rem] border border-stone-300/70 bg-white/90 p-5 shadow-panel">
        <p className="font-display text-2xl text-ink">Synchronized transcript</p>
        <div className="mt-4 flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-2">
            {sentencesOnPage.length === 0 ? <p className="rounded-2xl bg-stone-100 px-4 py-3 text-sm text-stone-600">No readable sentences were extracted for this page.</p> : null}
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

interface RenderPdfPageArgs {
  file: File;
  pageNumber: number;
  canvas: HTMLCanvasElement;
  pdfDocumentRef: React.MutableRefObject<PdfDocumentProxy | null>;
  fileKeyRef: React.MutableRefObject<string | null>;
  renderTaskRef: React.MutableRefObject<RenderTaskLike | null>;
  renderRequestIdRef: React.MutableRefObject<number>;
  requestId: number;
}

type PdfDocumentProxy = Awaited<ReturnType<(typeof pdfjsLib)["getDocument"]>["promise"]>;
type RenderTaskLike = {
  cancel(): void;
  promise: Promise<unknown>;
};

async function renderPdfPage({ file, pageNumber, canvas, pdfDocumentRef, fileKeyRef, renderTaskRef, renderRequestIdRef, requestId }: RenderPdfPageArgs): Promise<void> {
  const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
  if (fileKeyRef.current !== fileKey) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    console.info("[pdf] loading document", { fileName: file.name, pageNumber });
    pdfDocumentRef.current = await pdfjsLib.getDocument({ data: bytes }).promise;
    fileKeyRef.current = fileKey;
  }

  if (requestId !== renderRequestIdRef.current) {
    return;
  }

  const pdf = pdfDocumentRef.current;
  if (!pdf) {
    throw new Error("PDF document unavailable");
  }

  if (renderTaskRef.current) {
    renderTaskRef.current.cancel();
    await renderTaskRef.current.promise.catch(() => undefined);
    if (requestId !== renderRequestIdRef.current) {
      return;
    }
  }

  const page = await pdf.getPage(pageNumber);
  if (requestId !== renderRequestIdRef.current) {
    return;
  }

  const viewport = page.getViewport({ scale: 1.5 });
  const devicePixelRatio = window.devicePixelRatio || 1;
  const outputScale = devicePixelRatio > 1 ? devicePixelRatio : 1;

  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context unavailable");
  }

  context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
  context.clearRect(0, 0, viewport.width, viewport.height);

  console.info("[pdf] render start", {
    pageNumber,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    devicePixelRatio: outputScale
  });

  const renderTask = page.render({
    canvasContext: context,
    viewport
  });
  renderTaskRef.current = renderTask;
  await renderTask.promise;
  if (renderTaskRef.current === renderTask && requestId === renderRequestIdRef.current) {
    renderTaskRef.current = null;
  }

  console.info("[pdf] render success", { pageNumber });
}
