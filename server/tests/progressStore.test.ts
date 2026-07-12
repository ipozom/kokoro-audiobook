import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ProgressStore } from "../src/services/progressStore.js";
import { serverConfig } from "../src/config.js";

test("ProgressStore saves and reloads playback state", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "kokoro-progress-"));
  const originalDataDir = serverConfig.dataDir;

  Object.assign(serverConfig, { dataDir: tempDir });
  try {
    const store = new ProgressStore();
    const progress = {
      documentId: "doc-1",
      currentPage: 2,
      sentenceIndex: 10,
      playbackState: "paused" as const,
      speed: 1.2,
      updatedAt: new Date().toISOString()
    };

    await store.save(progress);
    const restored = await store.load(progress.documentId);
    assert.deepEqual(restored, progress);
  } finally {
    Object.assign(serverConfig, { dataDir: originalDataDir });
    await rm(tempDir, { recursive: true, force: true });
  }
});