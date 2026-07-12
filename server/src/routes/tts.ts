import { Router } from "express";
import { z } from "zod";

import { getTtsHealth, synthesizeSentences } from "../services/ttsClient.js";

const queueSchema = z.object({
  voice: z.string().min(1).default("af_sarah"),
  speed: z.number().min(0.5).max(2).default(1),
  sentences: z.array(
    z.object({
      id: z.string().min(1),
      pageNumber: z.number().int().positive(),
      sentenceIndex: z.number().int().nonnegative(),
      text: z.string().min(1)
    })
  ).min(1).max(8)
});

const router = Router();

/** Queue a small synthesis batch for low-latency playback. */
router.post("/queue", async (request, response) => {
  const payload = queueSchema.parse(request.body);
  const items = await synthesizeSentences(payload);
  response.json({ items });
});

/** Expose GPU health through the Node boundary. */
router.get("/health", async (_request, response) => {
  const health = await getTtsHealth();
  response.json(health);
});

export { router as ttsRouter };
