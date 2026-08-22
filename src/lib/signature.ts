import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";

/**
 * Verify a GitHub webhook signature (`X-Hub-Signature-256`) against the raw
 * request body using HMAC-SHA256 and a timing-safe comparison.
 *
 * The signature is computed over the *exact* bytes GitHub sent, so the caller
 * must pass the unparsed raw body. Re-serializing parsed JSON would change
 * whitespace/key order and break verification.
 */
export function verifyGithubSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const received = signatureHeader.slice(SIGNATURE_PREFIX.length);
  const expected = sign(rawBody, secret);

  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(received, "utf8");

  if (expectedBuf.length !== receivedBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, receivedBuf);
}

/**
 * Compute the HMAC-SHA256 hex digest of the raw body. Exported for use in
 * tests and local manual verification.
 */
export function sign(rawBody: Buffer | string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}
