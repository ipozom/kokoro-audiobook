import { Router } from "express";
import { z } from "zod";

import { ProgressStore } from "../services/progressStore.js";

const progressSchema = z.object({
  documentId: z.string().min(1),
  currentPage: z.number().int().positive(),
  sentenceIndex: z.number().int().nonnegative(),
  playbackState: z.enum(["idle", "playing", "paused"]),
  speed: z.number().min(0.5).max(2),
  updatedAt: z.string().min(1)
});

const router = Router();
const store = new ProgressStore();

/** Return previously persisted playback progress for a document. */
router.get("/:documentId", async (request, response) => {
  const progress = await store.load(request.params.documentId);
  response.json({ progress });
});

/** Persist playback progress for reload and session restore. */
router.put("/:documentId", async (request, response) => {
  const progress = progressSchema.parse({ ...request.body, documentId: request.params.documentId });
  await store.save(progress);
  response.status(204).send();
});

export { router as progressRouter };
