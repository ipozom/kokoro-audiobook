# Security Notes

## Input Validation Strategy

### PDF upload

- PDFs are accepted only through the Node upload route.
- The API validates MIME type, byte size, PDF signature, and page count before extraction.
- Server-side extraction uses pdf.js with hardened parsing options.

### Page input for `Start from page`

- The page selector is a controlled numeric input.
- The button is disabled until the value is an integer in the inclusive range `1..pageCount`.
- The queue hook clamps the page again before using it, so malformed UI state cannot produce an out-of-range playback start.

This means the feature validates input both at the UI boundary and again at the playback state boundary.

## API Boundaries

### Browser -> Node

- The browser never talks directly to the Python service.
- All PDFs, progress updates, and TTS queue requests pass through Node.

### Node -> Python

- Node forwards only fixed-schema TTS requests.
- The Python service requires `X-API-Key` on every request.
- No shell commands or subprocess boundaries are involved in synthesis orchestration.

## PDF Parsing Safety

- pdf.js parsing is isolated to the Node layer.
- Hostile or malformed PDFs are rejected early when possible.
- Extracted text is normalized before it reaches the browser or the TTS layer.

## XSS Mitigation

- Transcript text is rendered through normal React text nodes.
- The app never uses `dangerouslySetInnerHTML` for PDF-derived content.
- The new page-selection UI accepts only numeric input and does not inject user-provided markup anywhere.

## File Persistence Safety

- Progress files are keyed by content hash, not user-provided filenames.
- Writes occur under a fixed data directory.
- The new page-start feature does not add any new persisted fields or file-system access patterns.

# Performance Notes

## GPU Usage on GTX 1080 Ti

- Kokoro-82M runs on `cuda:0`.
- Health checks expose device name and VRAM usage.
- The Python service warms the model at startup to avoid the worst first-request latency.

## Chunking Strategy

- The frontend requests only a small synthesis window ahead of the current sentence.
- Node forwards bounded sentence batches.
- Python synthesizes those chunks and returns WAV payloads sized for interactive playback rather than bulk export.

## Audio Latency

- The first warm request is the slowest because kernels and runtime caches are established.
- Normal playback requests are smaller and benefit from the prefetch window.
- Page jumps remain efficient because the frontend does not rebuild document data. It only clears stale audio URLs and resumes buffering from the new sentence index.

## Queue Efficiency After Page Jump

The `Start from page` feature is intentionally implemented without backend changes.

Efficiency details:

- The frontend computes the first sentence index for the selected page locally.
- Existing sentence metadata is reused instead of requesting a new filtered document.
- Cached audio object URLs are revoked on page jump so no stale audio remains.
- After the reset, buffering resumes from the new index using the same small prefetch window.

## Bottlenecks and Mitigation

### PDF extraction

- CPU-bound during upload.
- Mitigation: do it once per upload and reuse the returned sentence model.

### TTS inference

- GPU-bound.
- Mitigation: warmup, bounded batch sizes, serialized inference.

### Browser audio transport

- Base64 WAV is larger than binary streaming.
- Mitigation: small queue windows and `Blob` URL reuse only for the sentences needed next.

## Memory Cleanup

### Frontend

- Audio chunks are stored as `Blob` object URLs.
- When the document changes or the user starts from a new page, those URLs are revoked to avoid memory leaks.

### Python

- The TTS engine calls `torch.cuda.empty_cache()` after batches to reduce cache fragmentation pressure.
