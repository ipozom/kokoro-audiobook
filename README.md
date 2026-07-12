# Kokoro Audiobook PDF Audio Player

Local PDF-to-audiobook player built with React, Node.js, and a CUDA-backed Python Kokoro-82M service. The stack uploads and parses PDFs, extracts sentence chunks, synthesizes speech locally on an NVIDIA GTX 1080 Ti, highlights the currently spoken sentence, and restores playback progress across reloads.

## 1. Architecture Overview

See [docs/architecture.md](docs/architecture.md) for the full design. In short:

- `frontend/`: React + TypeScript + Tailwind UI, PDF rendering, playback orchestration, transcript highlighting.
- `server/`: Express API, secure PDF ingestion, extraction, segmentation, progress persistence, Python service proxy.
- `python-service/`: FastAPI Kokoro wrapper, CUDA checks, warm-up, bounded batch inference, WAV output.

## 2. Project Structure

```text
kokoro-audiobook/
├── docs/
│   ├── architecture.md
│   └── security-performance.md
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── types.ts
│   ├── package.json
│   └── vite.config.ts
├── python-service/
│   ├── app/
│   │   ├── config.py
│   │   ├── kokoro_adapter.py
│   │   ├── main.py
│   │   ├── schemas.py
│   │   └── tts_engine.py
│   └── requirements.txt
├── server/
│   ├── src/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── utils/
│   │   └── types.ts
│   ├── tests/
│   └── package.json
└── README.md
```

## 3. Step-by-Step Implementation

1. The frontend uploads a PDF to the Node API.
2. The Node API validates the file and parses text with pdf.js.
3. Extracted text is normalized and segmented into sentence chunks with page metadata.
4. A deterministic `documentId` is generated from the PDF content hash.
5. The frontend renders the PDF page and transcript list.
6. On playback, the frontend requests a short sentence window from `/api/tts/queue`.
7. The Node API forwards the request to the Python service with the internal API key.
8. The Python service synthesizes WAV audio using Kokoro-82M on CUDA.
9. The browser plays the returned WAV chunks sequentially and highlights the active sentence.
10. Current page, sentence index, state, and speed are persisted and restored by `documentId`.

## 4. Python Kokoro-82M GPU Service

The full service lives in [python-service/app/main.py](python-service/app/main.py), [python-service/app/tts_engine.py](python-service/app/tts_engine.py), and [python-service/app/kokoro_adapter.py](python-service/app/kokoro_adapter.py).

### Python environment setup

```bash
cd python-service
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env
```

### CUDA + PyTorch setup

Install a CUDA-enabled PyTorch build appropriate for your local driver and CUDA runtime. Example for CUDA 12.1 wheels:

```bash
pip install --upgrade torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
```

Verify CUDA:

```bash
python - <<'PY'
import torch
print(torch.cuda.is_available())
print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else "no-cuda")
PY
```

### Kokoro setup

Install your local Kokoro runtime package and place model files at the configured path:

```bash
pip install kokoro
mkdir -p models/kokoro-82m
```

If your Kokoro package uses a different import path or constructor, update these variables in `.env`:

- `KOKORO_MODULE`
- `KOKORO_FACTORY`
- `KOKORO_MODEL_PATH`

### Run the Python service

```bash
cd python-service
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8001
```

### How GPU is utilized

- The service requires CUDA by default via `REQUIRE_CUDA=true`.
- `TTSEngine` selects `cuda:0`, warms the model, synchronizes batches, and reports VRAM usage from PyTorch.
- Each synthesis batch is bounded to reduce VRAM spikes on the GTX 1080 Ti.

## 5. Node.js API Layer

The API entrypoint is [server/src/server.ts](server/src/server.ts), and the app composition is in [server/src/app.ts](server/src/app.ts).

### Install and configure

```bash
npm install
cp server/.env.example server/.env
```

Important server environment values:

- `PYTHON_TTS_URL`: URL of the local Python service.
- `PYTHON_TTS_API_KEY`: must match `API_KEY` in `python-service/.env`.
- `MAX_PDF_BYTES`: upload size cap.
- `MAX_PDF_PAGES`: extraction cap for large documents.

### Run the API

```bash
npm run dev:server
```

### API surface

- `POST /api/documents/upload`: validate and parse a PDF.
- `GET /api/progress/:documentId`: restore saved progress.
- `PUT /api/progress/:documentId`: persist playback state.
- `POST /api/tts/queue`: request audio for sentence chunks.
- `GET /api/tts/health`: surface Python CUDA health.

## 6. React Frontend

The app root is [frontend/src/App.tsx](frontend/src/App.tsx). Playback orchestration lives in [frontend/src/hooks/useAudioQueue.ts](frontend/src/hooks/useAudioQueue.ts).

### Run the frontend

```bash
npm run dev:frontend
```

Or run both frontend and API together:

```bash
npm run dev
```

### Frontend behavior

- Uploads PDFs through drag-and-drop or file chooser.
- Renders the active PDF page to canvas using pdf.js.
- Mirrors page-level sentence chunks in a transcript pane.
- Requests and buffers upcoming sentence audio.
- Highlights the active sentence and lets the user click any sentence to seek.
- Restores playback page, sentence index, and speed from saved progress.

## 7. README Requirements Coverage

This README covers:

- Node.js setup
- Python environment setup
- CUDA + PyTorch installation guidance
- Local Kokoro wrapper assumptions
- GPU utilization behavior
- Operational troubleshooting

## 8. Security and Performance Documentation

See [docs/security-performance.md](docs/security-performance.md).

Implemented mitigations include:

- strict PDF validation
- disabled eval-style PDF parsing behavior
- sanitized extracted text
- authenticated Python service endpoints
- no shell-based IPC between Node and Python
- bounded chunk sizes and bounded batch counts for GPU stability

## 9. Testing Instructions

### Functional tests

1. Start the Python service.
2. Start the Node API.
3. Start the frontend.
4. Upload a valid PDF.
5. Confirm the PDF page renders and the transcript appears.
6. Press Play and confirm audio starts.
7. Press Pause and resume.
8. Reload the browser and confirm progress restores.

### GPU tests

1. Call `GET /api/tts/health` and confirm `cuda_available` is `true`.
2. Confirm `device_name` reports your GTX 1080 Ti.
3. Watch `vram_allocated_mb` while starting playback.
4. Test a larger PDF and verify uploads still respect configured caps.

### Local automated checks

Server tests:

```bash
npm test --workspace server
```

Python syntax check:

```bash
cd python-service
python3 -m py_compile app/*.py
```

Frontend type check and build:

```bash
npm run build --workspace frontend
```

## Troubleshooting GPU Issues

### `torch.cuda.is_available()` is false

- Confirm NVIDIA drivers are installed.
- Confirm your PyTorch build is CUDA-enabled.
- Confirm the Python environment is the one you used to install CUDA wheels.

### Python service fails at startup with CUDA required

- Set `REQUIRE_CUDA=false` only for diagnostics, not for normal operation.
- Verify `nvidia-smi` works on the host.

### Kokoro import or factory mismatch

- Update `KOKORO_MODULE` and `KOKORO_FACTORY`.
- Adjust [python-service/app/kokoro_adapter.py](python-service/app/kokoro_adapter.py) if your local runtime uses another method signature.

### VRAM pressure or out-of-memory errors

- Lower `MAX_BATCH_ITEMS`.
- Lower `MAX_TEXT_CHARS`.
- Reduce concurrent local workloads using the same GPU.

## Assumptions

- Kokoro-82M is available locally and legally installed.
- The local Kokoro runtime can be wrapped through a `generate(...)` or callable interface.
- Node.js 20+ is available so the server can use native `fetch`.
- Browser support is modern enough for Vite, React 19, and ES2022 output.
