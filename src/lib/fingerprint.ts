import { createHash } from "node:crypto";

export interface FailureFingerprint {
  fingerprint: string;
  errorClass: string;
  sampleMessage: string;
}

const MAX_MESSAGE_LENGTH = 2000;

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Normalization ladder (blueprint Part 8) — applied to failure text so that
 * two failures with the same root cause collapse to the same fingerprint even
 * when incidental values (ids, timestamps, paths, numbers) differ.
 *
 * Order is deliberate:
 *  - timestamps are redacted BEFORE integers, otherwise "2026-08-21T..." and
 *    "2026-09-15T..." would normalize differently (the month/day differ).
 *  - integers of 4+ digits are redacted (not 3+) so HTTP status codes like
 *    404/500 stay intact — they are semantically load-bearing.
 */
export function normalizeFailureText(raw: string): string {
  let s = raw;

  // 1. ANSI escape sequences
  s = s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

  // 2. GitHub runner prefix / common CI roots -> repo-relative
  s = s.replace(/\/home\/runner\/work\/[^/]+\/[^/]+\//g, "");
  s = s.replace(/\/(?:app|workspace|builds|root|src)\//g, "");

  // 3. Temp directories
  s = s.replace(/\/tmp\/[A-Za-z0-9._-]+/g, "<TMP>");
  s = s.replace(/C:\\Users\\[^\\]+\\AppData\\Local\\Temp\\[A-Za-z0-9._-]+/gi, "<TMP>");

  // 4. UUIDs
  s = s.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    "<UUID>",
  );

  // 5. Long hex hashes (>= 16 chars)
  s = s.replace(/\b[0-9a-f]{16,}\b/gi, "<HASH>");

  // 6. ISO timestamps
  s = s.replace(
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
    "<TS>",
  );
  // epoch millis
  s = s.replace(/\b\d{13}\b/g, "<TS>");

  // 7. Integers with 4+ digits (keeps 404/500/201 intact)
  s = s.replace(/\b\d{4,}\b/g, "<N>");

  // 8. Quoted strings
  s = s.replace(/"([^"]*)"/g, "<S>");
  s = s.replace(/'([^']*)'/g, "<S>");

  // 9. Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

/**
 * Deterministic failure fingerprint. Hashes the normalized error class +
 * message so identical (and, after normalization, near-identical) failures
 * group into the same bucket. Determinism matters: a human must be able to
 * reproduce exactly how a key was computed.
 */
export function computeFailureFingerprint(input: {
  errorClass?: string;
  message?: string;
}): FailureFingerprint {
  const errorClass = (input.errorClass ?? "").trim() || "Unknown";
  const sampleMessage = truncate(
    normalizeFailureText(input.message ?? "") || errorClass,
    MAX_MESSAGE_LENGTH,
  );

  const fingerprint = createHash("sha256")
    .update(`${errorClass}\n${sampleMessage}`)
    .digest("hex");

  return { fingerprint, errorClass, sampleMessage };
}
