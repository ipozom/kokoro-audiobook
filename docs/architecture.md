# Architecture Overview

## System Overview

This project is a three-tier local application designed to convert PDF books into synchronized spoken audio with GPU-backed inference.

Layers:

1. React frontend: handles PDF upload, rendering, playback controls, sentence highlighting, and session restoration.
2. Node.js API: validates PDFs, extracts page-aware text, segments sentences, persists progress, and proxies protected TTS requests.
3. Python TTS service: loads Kokoro-82M, verifies CUDA, warms the model, performs bounded batch inference, and returns WAV audio chunks.

## Service Responsibilities

### Frontend

- Accepts PDF upload through drag-and-drop or file input.
- Renders PDF pages with pdf.js.
- Displays extracted sentence chunks aligned to the current page.
- Requests small synthesis batches for low-latency playback.
- Highlights the active sentence and scrolls the reading pane.
- Saves current playback position and speed through the Node API.

### Node.js API

- Enforces PDF MIME, byte-size, page-count, and header validation.
- Extracts text with pdf.js in a server-side, script-disabled configuration.
- Normalizes text to remove control characters and collapse hostile or malformed spacing.
- Segments text into sentence-sized chunks for TTS batching.
- Persists progress to local JSON files keyed by content hash.
- Shields the Python service behind a local authenticated API boundary.

### Python TTS Service

- Loads Kokoro through a documented adapter instead of binding the rest of the stack to a moving third-party runtime interface.
- Requires CUDA by default and fails fast if GPU inference is unavailable.
- Performs warm-up synthesis to preallocate kernels and reduce first-request latency.
- Serializes inference requests to avoid unpredictable GTX 1080 Ti VRAM pressure.
- Returns mono WAV audio chunks encoded as base64 for direct browser playback.

## Data Flow

PDF -> Node upload route -> PDF validation -> pdf.js extraction -> sentence segmentation -> frontend transcript model -> TTS queue requests -> Python Kokoro inference -> WAV chunk response -> browser audio playback -> progress save

## Textual Service Interaction Diagram

1. User uploads a PDF in the browser.
2. Frontend sends multipart form data to `/api/documents/upload`.
3. Node validates the file and extracts structured text per page.
4. Node returns `documentId`, `pageCount`, full sentence list, and any saved progress.
5. Frontend renders the PDF canvas and transcript list.
6. When playback begins, frontend sends the next sentence window to `/api/tts/queue`.
7. Node authenticates to the Python service with `X-API-Key` and forwards the chunk batch.
8. Python synthesizes WAV audio on CUDA and returns encoded audio items.
9. Frontend buffers the results, plays them sequentially, highlights the current sentence, and saves playback progress through `/api/progress/:documentId`.

## GPU Inference Pipeline

1. Service startup loads Kokoro-82M on `cuda:0`.
2. A warm-up request runs immediately to prebuild GPU kernels and runtime caches.
3. Requests arrive in bounded micro-batches of up to 8 sentence chunks.
4. The adapter normalizes runtime outputs into mono `float32` PCM.
5. The engine encodes each result to mono 16-bit WAV for browser compatibility.
6. After each batch, the engine synchronizes CUDA and empties unused cache pages to reduce fragmentation.

## Performance Considerations

- Sentence chunks are capped to reduce long-tail latency and stabilize VRAM consumption.
- Small batch windows trade peak throughput for better interactive responsiveness.
- Progress persistence is content-hash keyed, so reopening the same document restores state even if the filename changes.
- The frontend prefetches the next few sentence chunks while the current sentence is playing.

## Kokoro Runtime Assumption

Kokoro community packages do not yet expose one single stable Python API. This implementation therefore defines an explicit wrapper contract:

- The configured module defaults to `kokoro`.
- The configured factory defaults to `KPipeline`.
- The created runtime must either expose `generate(texts=..., voice=..., speed=...)` or be directly callable with the same keyword arguments.

If your local Kokoro package differs, update `KOKORO_MODULE` and `KOKORO_FACTORY`, or adapt `python-service/app/kokoro_adapter.py`.
