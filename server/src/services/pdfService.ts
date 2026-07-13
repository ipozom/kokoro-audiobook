import path from "node:path";
import { createRequire } from "node:module";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { serverConfig } from "../config.js";
import type { ParsedDocument, SentenceChunk } from "../types.js";
import { HttpError } from "../utils/errors.js";
import { hashBuffer } from "../utils/hash.js";
import { normalizeExtractedText, segmentPageText } from "../utils/text.js";

const require = createRequire(import.meta.url);
const pdfjsPackageRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
const standardFontDataUrl = `${path.join(pdfjsPackageRoot, "standard_fonts")}${path.sep}`;

/** Validate the uploaded PDF before it reaches the parser. */
export function validatePdfBuffer(fileName: string, buffer: Buffer, mimeType: string): void {
  if (mimeType !== "application/pdf") {
    throw new HttpError("Only PDF uploads are allowed", 400);
  }

  if (buffer.byteLength > serverConfig.maxPdfBytes) {
    throw new HttpError("PDF exceeds max size", 413, { maxBytes: serverConfig.maxPdfBytes });
  }

  if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new HttpError(`File ${fileName} does not contain a valid PDF header`, 400);
  }
}

/** Extract page-aware sentence chunks using the same PDF.js family used in the browser. */
export async function parsePdfDocument(fileName: string, buffer: Buffer): Promise<ParsedDocument> {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useWorkerFetch: false,
    disableFontFace: true,
    stopAtErrors: true,
    standardFontDataUrl
  });

  const pdfDocument = await loadingTask.promise;
  if (pdfDocument.numPages > serverConfig.maxPdfPages) {
    throw new HttpError("PDF exceeds max page count", 413, { maxPages: serverConfig.maxPdfPages });
  }

  const sentences: SentenceChunk[] = [];
  const pageTexts: string[] = [];
  let sentenceIndex = 0;

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");

    const normalized = normalizeExtractedText(pageText);
    pageTexts.push(normalized);
    const pageSentences = segmentPageText(pageNumber, normalized, sentenceIndex);
    sentences.push(...pageSentences);
    sentenceIndex += pageSentences.length;
  }

  return {
    documentId: hashBuffer(buffer),
    fileName,
    pageCount: pdfDocument.numPages,
    plainText: pageTexts.join("\n\n"),
    sentences
  };
}
