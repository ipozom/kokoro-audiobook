# Kokoro Audiobook PDF Audio Player

Local PDF-to-audiobook player built with React, Node.js, and a CUDA-backed Python Kokoro-82M service. The system uploads PDFs, extracts page-aware sentences, synthesizes audio locally on an NVIDIA GTX 1080 Ti, keeps playback synchronized with the rendered PDF, restores progress, and now supports starting playback from any valid page.

## Overview

The stack is split into three runtime layers:

- `frontend/`: React + TypeScript UI for PDF rendering, transcript navigation, transport controls, and page-based playback starts.
- `server/`: Express API for PDF validation, extraction, sentence segmentation, progress persistence, and Python service proxying.
- `python-service/`: FastAPI service that loads Kokoro-82M, verifies CUDA, runs synthesis on `cuda:0`, and returns WAV chunks.

See [docs/architecture.md](docs/architecture.md) for the detailed architecture and [docs/security-performance.md](docs/security-performance.md) for security and performance notes.

## Features

- PDF upload and validation through the Node API.
- Server-side text extraction with page-aware sentence segmentation.
- Synchronized PDF canvas rendering and transcript highlighting.
- Local Kokoro-82M speech synthesis on CUDA.
- Browser playback from WAV `Blob` object URLs.
- Progress persistence by content-derived `documentId`.
- Start playback from any valid page.

## Project Structure

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
│   └── package.json
├── python-service/
│   ├── app/
│   └── requirements.txt
├── server/
│   ├── src/
│   ├── tests/
│   └── package.json
└── README.md
```

## Architecture and Data Flow

Runtime path:

1. The browser uploads a PDF to `POST /api/documents/upload`.
2. Node validates the file and extracts text with pdf.js.
3. Node normalizes the text and emits sentence chunks with `pageNumber` and `sentenceIndex`.
4. The frontend renders the current PDF page and transcript for that page.
5. Playback requests small sentence windows from `POST /api/tts/queue`.
6. Node authenticates to the Python service and forwards the synthesis batch.
7. Python synthesizes WAV audio with Kokoro-82M on the GPU.
8. The frontend converts base64 WAV into `Blob` URLs and plays them through an off-DOM `Audio()` element.
9. Progress is saved to `PUT /api/progress/:documentId` and restored on reload.

## Setup

### Node.js

```bash
npm install
cp server/.env.example server/.env
```

Set at least:

- `PYTHON_TTS_URL=http://127.0.0.1:8001`
- `PYTHON_TTS_API_KEY=local-dev-key`

### Python

```bash
cd python-service
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env
```

### CUDA / PyTorch

Install a CUDA-enabled PyTorch build that matches your local driver. Example:

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

### Kokoro Runtime

The current implementation is validated against Kokoro-82M with local or Hugging Face cached assets. If needed, configure the runtime through `python-service/.env`:

- `KOKORO_REPO_ID`
- `KOKORO_CONFIG_PATH`
- `KOKORO_MODEL_PATH`
- `KOKORO_VOICE_PATH`
- `API_KEY`

## Run Instructions

Start the Python service:

```bash
cd python-service
source .venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8001
```

Start the Node API:

```bash
npm run dev:server
```

Start the frontend:

```bash
npm run dev:frontend
```

Or run the workspace dev workflow if your root scripts provide it:

```bash
npm run dev
```

## Usage

### Upload PDF

1. Open the frontend.
2. Drop a PDF or click `Select PDF`.
3. Wait for the PDF page and transcript to appear.

### Start Playback

1. Click `Play`.
2. The current sentence is synthesized if needed.
3. The transcript highlight advances as audio plays.

### Start from Page

1. Enter a page number in the `Start page` input inside the PDF reader header.
2. Click `Start from page`.
3. The viewer jumps immediately to that page.
4. If the page contains sentences, playback restarts from the first sentence on that page.
5. If the page has no extracted sentences, playback stops and the app shows a non-fatal message.

## Testing Instructions

### Functional checks

1. Upload a multi-page PDF.
2. Start playback and confirm transcript highlighting advances.
3. Use `Start from page` on page 1, a middle page, and the last page.
4. Confirm the viewer page, transcript pane, and audio all restart from the selected page.
5. Reload the page and confirm progress restores to a valid position.

### Automated checks

Frontend build:

```bash
npm run build --workspace frontend
```

Server tests:

```bash
npm test --workspace server
```

Python syntax check:

```bash
cd python-service
python3 -m py_compile app/*.py
```

## Troubleshooting

### No audio

- Confirm the Python service and Node API are both running.
- Check `GET /api/tts/health` and confirm CUDA is available.
- Open the browser console and confirm audio playback logs do not show `[audio] playback failed`.

### PDF not rendering

- Confirm the frontend can load the configured pdf.js worker URL.
- Check the browser console for `[pdf] render failed` messages.
- Retry with a known-good PDF to rule out malformed input.

### GPU issues

- Confirm `torch.cuda.is_available()` is `true`.
- Confirm `nvidia-smi` works on the host.
- Confirm the installed PyTorch build is CUDA-enabled.

### Page without sentences

- Some PDF pages can render visually but extract no clean text.
- The viewer still jumps to the page, but playback will not start until a page with extracted sentences is selected.

### VRAM pressure or out-of-memory errors

- Lower `MAX_BATCH_ITEMS`.
- Lower `MAX_TEXT_CHARS`.
- Reduce concurrent local workloads using the same GPU.

## Assumptions

- Kokoro-82M is available locally and legally installed.
- The local Kokoro runtime can be wrapped through a `generate(...)` or callable interface.
- Node.js 20+ is available so the server can use native `fetch`.
- Browser support is modern enough for Vite, React 19, and ES2022 output.
