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
 * Deterministic failure fingerprint — a stable key grouping failures that
 * share a root cause. The MVP hashes the error class + message exactly, so
 * two identical failures always land in the same bucket.
 *
 * Phase 3 extends this with the normalization ladder (ANSI strips, number
 * redaction, path normalization) so *near-identical* failures also group.
 */
export function computeFailureFingerprint(input: {
  errorClass?: string;
  message?: string;
}): FailureFingerprint {
  const errorClass = (input.errorClass ?? "").trim() || "Unknown";
  const raw = (input.message ?? "").trim();
  const sampleMessage = truncate(raw || errorClass, MAX_MESSAGE_LENGTH);

  const fingerprint = createHash("sha256")
    .update(`${errorClass}\n${sampleMessage}`)
    .digest("hex");

  return { fingerprint, errorClass, sampleMessage };
}
