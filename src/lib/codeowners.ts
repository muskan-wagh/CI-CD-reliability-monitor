import type { Queryable } from "./store.js";
import {
  createInstallationClient,
  loadGithubAppCredentials,
} from "./githubApp.js";

/**
 * Test ownership from CODEOWNERS (Phase J).
 *
 * Ownership comes exclusively from the repository's CODEOWNERS file, fetched
 * with the App's installation token and cached per repo.
 * Matching follows gitignore-style semantics over PATH SEGMENTS (pure +
 * unit-tested):
 *   - blank lines / `#` comments ignored; rules need at least one owner token
 *   - a pattern containing "/" is anchored to the repo root; otherwise it
 *     matches the basename at any depth
 *   - one-star matches within a single segment; double-star spans segments
 *   - LAST matching rule wins
 *   - owners are the `@`-prefixed tokens on the rule (user or org/team)
 *
 * When there is no CODEOWNERS file (or no credentials), ownership is unknown —
 * it is never invented.
 */

export interface CodeownersRule {
  owners: string[];
  segments: string[];
  /** Anchored = pattern contained "/" (multi-segment) → matched against the full path. */
  anchored: boolean;
}

/** Parse raw CODEOWNERS content into ordered rules. Pure. */
export function parseCodeowners(content: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const tokens = trimmed.split(/\s+/);
    const owners = tokens.slice(1).filter((t) => t.startsWith("@"));
    if (owners.length === 0) continue;

    const rawPattern = tokens[0]!.replace(/^\//, "");
    const segments = rawPattern.split("/").filter((s) => s.length > 0);
    rules.push({
      owners,
      segments,
      // gitignore semantics: a "/" anywhere anchors the pattern to the repo
      // root; otherwise it matches the basename at any depth.
      anchored: rawPattern.includes("/"),
    });
  }
  return rules;
}

function segmentMatches(patternSeg: string, pathSeg: string): boolean {
  if (patternSeg === "**") return true;
  if (patternSeg === "*") return true; // exactly this one segment
  // single-star glob inside a segment: e.g. `*.spec.ts`
  if (!patternSeg.includes("*")) return patternSeg === pathSeg;
  const re = new RegExp(
    `^${patternSeg
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^/]*")}$`,
  );
  return re.test(pathSeg);
}

/**
 * Segment-prefix glob match with `**` support (two-pointer, backtracking only
 * for `**`). Pure.
 */
export function patternMatchesPath(
  patternSegments: string[],
  pathSegments: string[],
): boolean {
  let pi = 0;
  let ri = 0;
  let starPi = -1;
  let starRi = -1;

  while (ri < pathSegments.length) {
    // Pattern exhausted → directory-prefix match (path continues deeper).
    if (pi === patternSegments.length) return true;
    if (patternSegments[pi] === "**") {
      starPi = pi++;
      starRi = ri;
    } else if (segmentMatches(patternSegments[pi]!, pathSegments[ri]!)) {
      pi++;
      ri++;
    } else if (starPi !== -1) {
      pi = starPi + 1;
      ri = ++starRi;
    } else {
      return false; // mismatch and no ** to backtrack through
    }
  }
  // Consume any trailing "**".
  while (pi < patternSegments.length && patternSegments[pi] === "**") pi++;
  return pi === patternSegments.length;
}

/**
 * Owners for a path: LAST matching rule wins (GitHub precedence). Pure.
 * Anchored patterns run against the full segment list; unanchored patterns
 * (no "/") match the basename at any depth — gitignore semantics.
 * Returns null when nothing matches (ownership unknown, never invented).
 */
export function ownersForPath(
  rules: CodeownersRule[],
  filePath: string,
): string[] | null {
  const segments = filePath
    .replace(/^\.\//, "")
    .split("/")
    .filter((s) => s.length > 0);
  const basename = segments[segments.length - 1] ?? "";

  let matched: CodeownersRule | null = null;
  for (const rule of rules) {
    const target = rule.anchored ? segments : [basename];
    if (patternMatchesPath(rule.segments, target)) matched = rule;
  }
  return matched ? matched.owners : null;
}

/** Group rows by owner token → count. Pure. */
export function aggregateOwnership(
  rows: { filePath: string | null }[],
  rules: CodeownersRule[],
): { owner: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const owners = row.filePath ? ownersForPath(rules, row.filePath) : null;
    if (!owners) continue;
    for (const owner of owners) counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([owner, count]) => ({ owner, count }))
    .sort((a, b) => b.count - a.count);
}

interface CacheRow {
  content: string;
  fetched_at: string | Date;
}

const STALE_AFTER_MS = 24 * 3600 * 1000;
/** Re-check for a newly-added CODEOWNERS much sooner than the normal TTL. */
const EMPTY_STALE_AFTER_MS = 3600 * 1000;

async function readCache(
  db: Queryable,
  repositoryId: number,
): Promise<{ content: string; stale: boolean } | null> {
  const result = await db.query(
    `SELECT content, fetched_at FROM codeowners_cache WHERE repository_id = $1`,
    [repositoryId],
  );
  const row = result.rows[0] as CacheRow | undefined;
  if (!row) return null;
  const ttl = row.content ? STALE_AFTER_MS : EMPTY_STALE_AFTER_MS;
  return {
    content: row.content,
    stale: Date.now() - new Date(row.fetched_at).getTime() > ttl,
  };
}

async function writeCache(
  db: Queryable,
  repositoryId: number,
  content: string,
): Promise<void> {
  // Empty content is meaningful ("no CODEOWNERS") — cache it so we don't
  // re-query GitHub for a file that doesn't exist.
  await db.query(
    `INSERT INTO codeowners_cache (repository_id, content, fetched_at)
     VALUES ($1, $2, now())
     ON CONFLICT (repository_id) DO UPDATE SET content = $2, fetched_at = now()`,
    [repositoryId, content],
  );
}

async function fetchCodeownersFromApi(
  fullName: string,
  installationId: number | null,
): Promise<string | null> {
  try {
    const credentials = loadGithubAppCredentials();
    if (!credentials || installationId == null) return null;
    const client = await createInstallationClient(credentials, installationId);
    for (const path of CODEOWNERS_PATHS) {
      const res = await client.get<{ content?: string; encoding?: string }>(
        `/repos/${fullName}/contents/${encodeURIComponent(path)}?ref=HEAD`,
      );
      if (res?.content && res.encoding === "base64") {
        return Buffer.from(res.content, "base64").toString("utf8");
      }
    }
    return null;
  } catch {
    return null; // best-effort detail
  }
}

const CODEOWNERS_PATHS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

/**
 * Parsed CODEOWNERS rules for a repository, cache-first (24h TTL), refreshing
 * from GitHub otherwise. Returns [] when unknown — callers treat that as
 * "ownership not available", never as "no owners".
 */
export async function getCodeownersRules(
  db: Queryable,
  repositoryId: number,
  fullName: string,
  installationId: number | null,
): Promise<CodeownersRule[]> {
  const cached = await readCache(db, repositoryId);
  if (cached && !cached.stale) {
    return cached.content ? parseCodeowners(cached.content) : [];
  }

  const fetched = await fetchCodeownersFromApi(fullName, installationId);
  const effective = fetched ?? cached?.content ?? "";
  await writeCache(db, repositoryId, effective ?? "");
  return parseCodeowners(effective);
}
