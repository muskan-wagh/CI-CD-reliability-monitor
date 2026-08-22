import { createHash } from "node:crypto";

export interface TestIdentity {
  filePath: string;
  suitePath: string;
  name: string;
  identityHash: string;
  parentHash: string | null;
}

const SEPARATOR = "\u00BB";

/**
 * Normalize a test file path for stable identity:
 * - backslashes → forward slashes
 * - drop leading `./`
 * - strip the GitHub runner prefix `/home/runner/work/<repo>/<repo>/`
 */
export function normalizeFilePath(raw: string): string {
  let p = (raw ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
  const m = p.match(/\/home\/runner\/work\/[^/]+\/[^/]+\/(.*)$/);
  if (m && m[1]) {
    p = m[1];
  }
  return p;
}

/**
 * Parameterized tests (e.g. `login validates [case=empty]`) each get their own
 * identity, but we also derive a parent identity by stripping the bracket
 * suffix, enabling family rollups later.
 */
export function parameterizedParent(name: string): string | null {
  const m = name.match(/^(.*?)\s*\[[^\]]*\]\s*$/);
  if (m && m[1]) {
    const parent = m[1].trim();
    if (parent.length > 0 && parent !== name) {
      return parent;
    }
  }
  return null;
}

function identityString(filePath: string, suitePath: string, name: string): string {
  return [filePath, suitePath, name].filter((s) => s.length > 0).join(SEPARATOR);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Build the canonical, stable identity for a test. Identity is derived from
 * things that are stable across runs (path, suite, name) and explicitly
 * excludes line numbers, timestamps, and absolute runner paths.
 */
export function computeIdentity(input: {
  filePath: string;
  suitePath?: string;
  name: string;
}): TestIdentity {
  const filePath = normalizeFilePath(input.filePath);
  const suitePath = input.suitePath ?? "";
  const name = (input.name ?? "").trim();

  const identityHash = sha256(identityString(filePath, suitePath, name));

  const parent = parameterizedParent(name);
  const parentHash = parent
    ? sha256(identityString(filePath, suitePath, parent))
    : null;

  return { filePath, suitePath, name, identityHash, parentHash };
}
