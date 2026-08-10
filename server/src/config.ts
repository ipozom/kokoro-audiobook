import path from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4001),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  MAX_PDF_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  MAX_PDF_PAGES: z.coerce.number().int().positive().default(1000),
  DATA_DIR: z.string().default("./data"),
  PYTHON_TTS_URL: z.string().url().default("http://127.0.0.1:8001"),
  PYTHON_TTS_API_KEY: z.string().min(1).default("change-me"),
  PDF_UPLOAD_FIELD: z.string().default("pdf")
});

const parsed = envSchema.parse(process.env);

/** Process-wide server configuration. */
export const serverConfig = {
  port: parsed.PORT,
  corsOrigin: parsed.CORS_ORIGIN,
  maxPdfBytes: parsed.MAX_PDF_BYTES,
  maxPdfPages: parsed.MAX_PDF_PAGES,
  dataDir: path.resolve(process.cwd(), parsed.DATA_DIR),
  pythonTtsUrl: parsed.PYTHON_TTS_URL,
  pythonTtsApiKey: parsed.PYTHON_TTS_API_KEY,
  pdfUploadField: parsed.PDF_UPLOAD_FIELD
} as const;
