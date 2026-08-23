/**
 * Secret redaction — applied to every free-text field before it leaves the
 * process for an AI provider, and again on provider output before persisting.
 * Defense-in-depth: fingerprint normalization already strips some values, but
 * failure messages can still embed credentials verbatim.
 */

const REPLACEMENT = "<REDACTED>";

const PATTERNS: RegExp[] = [
  // GitHub tokens (ghp_, gho_, ghs_, ghu_, ghr_, fine-grained github_pat_)
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // AWS access key ids
  /\bAKIA[0-9A-Z]{16}\b/g,
  // OpenAI-style keys (sk-..., sk-proj-...)
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  // JWTs (three base64url segments)
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // Bearer / Basic authorization values
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi,
  // PEM private key blocks (incl. contents)
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // URL credentials: scheme://user:password@host
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/gi,
  // key=value style secrets (password=, secret:, api_key:, AUTH_TOKEN= ...)
  /\b(pass(word|wd)?|secret|token|api[_-]?key|access[_-]?key|auth[_-]?token|client[_-]?secret|private[_-]?key)\b\s*([:=]|=>)\s*[^\s,;"']+/gi,
];

/** Redact anything secret-looking from a single string. */
export function redactSecrets(input: string): string {
  let out = input;
  for (const p of PATTERNS) {
    out = out.replace(p, (match) => {
      // Preserve the label for key=value matches ("password=<REDACTED>").
      const kv = /^(\w[\w-]*\s*(?:[:=]|=>))\s*/i.exec(match);
      return kv ? `${kv[1]}${REPLACEMENT}` : REPLACEMENT;
    });
  }
  return out;
}

/** Deeply redact every string value inside a JSON-like structure. */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactSecrets(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}
