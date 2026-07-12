import express from "express";
import cors from "cors";
import helmet from "helmet";

import { serverConfig } from "./config.js";
import { documentsRouter } from "./routes/documents.js";
import { progressRouter } from "./routes/progress.js";
import { ttsRouter } from "./routes/tts.js";
import { errorHandler } from "./utils/errors.js";

/** Build the Express app with security middleware and modular routes. */
export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: serverConfig.corsOrigin,
      credentials: false
    })
  );
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" });
  });
  app.use("/api/documents", documentsRouter);
  app.use("/api/progress", progressRouter);
  app.use("/api/tts", ttsRouter);
  app.use(errorHandler);

  return app;
}
