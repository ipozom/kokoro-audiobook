import { Router } from "express";
import multer from "multer";

import { serverConfig } from "../config.js";
import { parsePdfDocument, validatePdfBuffer } from "../services/pdfService.js";
import { ProgressStore } from "../services/progressStore.js";
import { HttpError } from "../utils/errors.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: serverConfig.maxPdfBytes }
});

const router = Router();
const progressStore = new ProgressStore();

/** Upload a PDF, validate it, extract structured text, and return resumable metadata. */
router.post("/upload", upload.single(serverConfig.pdfUploadField), async (request, response) => {
  if (!request.file) {
    throw new HttpError("Missing PDF upload", 400);
  }

  validatePdfBuffer(request.file.originalname, request.file.buffer, request.file.mimetype);
  const document = await parsePdfDocument(request.file.originalname, request.file.buffer);
  const progress = await progressStore.load(document.documentId);

  response.json({
    document,
    progress
  });
});

export { router as documentsRouter };
