/* Shared-secret comparison that takes the same time whether or not the
   values match, so response timing says nothing about the expected value. */
import { createHash, timingSafeEqual } from "node:crypto";

export function safeEqual(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string" || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
