import assert from "node:assert/strict";
import test from "node:test";

import { normalizeExtractedText, segmentPageText } from "../src/utils/text.js";

test("normalizeExtractedText removes control characters and collapses whitespace", () => {
  assert.equal(normalizeExtractedText("Hello\u0000   world\n\nagain"), "Hello world again");
});

test("segmentPageText creates stable sentence ids and indexes", () => {
  const chunks = segmentPageText(2, "Alpha. Beta? Gamma!", 4);
  assert.deepEqual(
    chunks.map((chunk) => ({ id: chunk.id, sentenceIndex: chunk.sentenceIndex })),
    [
      { id: "2-4", sentenceIndex: 4 },
      { id: "2-5", sentenceIndex: 5 },
      { id: "2-6", sentenceIndex: 6 }
    ]
  );
});
