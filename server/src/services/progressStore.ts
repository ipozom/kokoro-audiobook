import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { serverConfig } from "../config.js";
import type { PlaybackProgress } from "../types.js";

/** Persist playback state to local disk so sessions can be restored across reloads. */
export class ProgressStore {
  private readonly baseDir = path.join(serverConfig.dataDir, "progress");

  async load(documentId: string): Promise<PlaybackProgress | null> {
    try {
      const filePath = this.resolvePath(documentId);
      const payload = await readFile(filePath, "utf-8");
      return JSON.parse(payload) as PlaybackProgress;
    } catch {
      return null;
    }
  }

  async save(progress: PlaybackProgress): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    const filePath = this.resolvePath(progress.documentId);
    await writeFile(filePath, JSON.stringify(progress, null, 2), "utf-8");
  }

  private resolvePath(documentId: string): string {
    return path.join(this.baseDir, `${documentId}.json`);
  }
}
