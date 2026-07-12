import type { ParsedDocument, TtsHealth } from "../types";

interface StatusPanelProps {
  document: ParsedDocument | null;
  health: TtsHealth | null;
  error: string | null;
}

/** Display current document and GPU runtime state for observability. */
export function StatusPanel({ document, health, error }: StatusPanelProps) {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      <article className="rounded-[1.5rem] bg-white/80 p-5 shadow-panel">
        <p className="text-sm uppercase tracking-[0.2em] text-stone-500">Document</p>
        <p className="mt-2 font-display text-2xl text-ink">{document?.fileName ?? "No PDF loaded"}</p>
        <p className="mt-2 text-sm text-stone-600">{document ? `${document.pageCount} pages, ${document.sentences.length} sentence chunks` : "Upload a PDF to begin."}</p>
      </article>
      <article className="rounded-[1.5rem] bg-white/80 p-5 shadow-panel">
        <p className="text-sm uppercase tracking-[0.2em] text-stone-500">GPU</p>
        <p className="mt-2 font-display text-2xl text-ink">{health?.device_name ?? "Unknown"}</p>
        <p className="mt-2 text-sm text-stone-600">
          {health ? `${health.cuda_available ? "CUDA active" : "CPU mode"} · VRAM ${health.vram_allocated_mb ?? 0}/${health.vram_total_mb ?? 0} MB` : "Health unavailable"}
        </p>
      </article>
      <article className="rounded-[1.5rem] bg-white/80 p-5 shadow-panel">
        <p className="text-sm uppercase tracking-[0.2em] text-stone-500">Runtime</p>
        <p className="mt-2 font-display text-2xl text-ink">{health?.warm ? "Warm" : "Cold"}</p>
        <p className="mt-2 text-sm text-stone-600">{error ?? "No active errors."}</p>
      </article>
    </section>
  );
}
