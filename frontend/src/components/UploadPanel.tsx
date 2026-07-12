import { useRef } from "react";

interface UploadPanelProps {
  onFileSelected(file: File): void;
  busy: boolean;
}

/** Accessible drag-and-drop and picker entrypoint for PDF ingestion. */
export function UploadPanel({ onFileSelected, busy }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <section className="rounded-[2rem] border border-stone-300/80 bg-white/80 p-6 shadow-panel backdrop-blur">
      <div
        className="flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border-2 border-dashed border-amber-600/40 bg-gradient-to-br from-amber-50 via-white to-sky-50 px-8 text-center transition hover:border-amber-600"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) {
            onFileSelected(file);
          }
        }}
      >
        <p className="font-display text-3xl text-ink">Drop a PDF to build a local audiobook</p>
        <p className="mt-3 max-w-xl text-base text-stone-600">
          The document is parsed locally, segmented into sentence chunks, and synthesized through Kokoro-82M on your GPU.
        </p>
        <button
          type="button"
          disabled={busy}
          className="mt-6 rounded-full bg-ember px-6 py-3 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:cursor-wait disabled:opacity-70"
        >
          {busy ? "Processing PDF..." : "Select PDF"}
        </button>
      </div>
      <input
        ref={inputRef}
        hidden
        type="file"
        accept="application/pdf"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onFileSelected(file);
          }
        }}
      />
    </section>
  );
}
