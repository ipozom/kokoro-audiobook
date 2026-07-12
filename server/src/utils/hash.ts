import { createHash } from "node:crypto";

/** Create a stable document identifier from the PDF bytes. */
export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
