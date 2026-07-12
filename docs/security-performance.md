# Security Notes

## Input Validation Strategy

- PDFs are accepted only through multipart upload with in-memory storage.
- The Node boundary validates MIME type, byte size, PDF header signature, and page count before extraction.
- Server-side extraction uses pdf.js with `isEvalSupported: false` and `stopAtErrors: true` to reduce script execution and malformed-document tolerance.
- Extracted text is normalized to remove control characters and collapse suspicious whitespace before it reaches the UI or TTS service.

## Attack Surface and Mitigations

### PDF parsing

- Risk: malformed or hostile PDFs targeting parser behavior.
- Mitigation: strict file checks, page-count caps, error-on-parse, no arbitrary file execution, no external helper binaries.

### UI rendering

- Risk: XSS from extracted text.
- Mitigation: React escapes transcript text by default, and the app never injects PDF text through `dangerouslySetInnerHTML`.

### Python service exposure

- Risk: direct local abuse of the TTS process.
- Mitigation: `X-API-Key` is required for every Python endpoint, and the browser never talks to Python directly.

### IPC and service-to-service calls

- Risk: arbitrary code or shell execution through inter-process boundaries.
- Mitigation: Node communicates with Python over fixed HTTP endpoints only. No shelling out, no untrusted command construction, no executable uploads.

### File persistence

- Risk: path traversal and arbitrary write locations.
- Mitigation: progress files are keyed only by SHA-256 content hash and stored under a fixed data directory.

## Additional Security Guidance

- Bind the Python service to loopback if the stack is used on a shared machine.
- Replace the default API key before first use.
- Keep PDF size and page-count caps conservative if untrusted inputs are expected.

# Performance Notes

## GPU Utilization Strategy

- CUDA is required by default because the primary objective is local GPU inference on the GTX 1080 Ti.
- The model is warmed at startup to avoid a slow first playback request.
- Request batches are bounded to 8 chunks and each chunk is capped at 700 characters to fit typical 11 GB VRAM limits with headroom.
- The engine serializes inference with a mutex to prevent overlapping GPU workloads from causing latency spikes or out-of-memory failures.

## Bottlenecks and Tradeoffs

- PDF extraction is CPU-bound and front-loaded during upload.
- TTS is GPU-bound and optimized for steady interactive playback, not maximum offline throughput.
- Base64 WAV transport is simple and browser-friendly but larger than a binary streaming protocol. The implementation chooses stability and debuggability over transport efficiency.
- Sentence-level synchronization is deterministic but coarse compared to phoneme-level alignment.

## GTX 1080 Ti Notes

- Approximate VRAM capacity is 11 GB; the service reports total, reserved, and allocated memory on health checks.
- If VRAM pressure appears, reduce `MAX_BATCH_ITEMS` and `MAX_TEXT_CHARS` first.
- If startup latency is acceptable but throughput is low, consider slightly larger batches only after measuring memory headroom.

## Memory Cleanup Strategy

- The engine calls `torch.cuda.empty_cache()` after each batch.
- This does not free allocated tensors still in use, but it does reduce fragmentation pressure from cached blocks between requests.
