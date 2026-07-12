import { mkdir } from "node:fs/promises";

import { createApp } from "./app.js";
import { serverConfig } from "./config.js";

async function startServer(): Promise<void> {
  await mkdir(serverConfig.dataDir, { recursive: true });
  const app = createApp();
  app.listen(serverConfig.port, () => {
    console.log(`API listening on http://localhost:${serverConfig.port}`);
  });
}

void startServer();
