import type { Queryable } from "./store.js";

/**
 * Mute / quarantine (Phase I).
 *
 * A mute (developer acknowledgement) or quarantine (deliberately excluded from
 * gating) suppresses Action Center prominence only. Scoring and history are
 * unaffected — muted tests keep accumulating results.
 */

export type MuteKind = "muted" | "quarantined";

export interface ActiveMute {
  kind: MuteKind;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
}

interface MuteRow {
  kind: MuteKind;
  reason: string | null;
  created_by: string | null;
  created_at: string | Date;
  expires_at: string | Date | null;
  lifted_at?: string | Date | null;
}

/** Pure predicate so expiry rules are unit-testable. */
export function isActiveMute(
  row: Pick<MuteRow, "expires_at" | "lifted_at">,
  now = new Date(),
): boolean {
  if (row.lifted_at != null) return false;
  if (row.expires_at == null) return true;
  return new Date(row.expires_at).getTime() > now.getTime();
}

function toActive(row: MuteRow): ActiveMute | null {
  if (!isActiveMute(row)) return null;
  return {
    kind: row.kind,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
  };
}

/** Record a new mute/quarantine for a test (becomes the active one). */
export async function muteTest(
  db: Queryable,
  input: {
    testId: number;
    kind: MuteKind;
    reason?: string | null;
    createdBy?: string | null;
    expiresInDays?: number | null;
  },
): Promise<ActiveMute> {
  const expiresAt =
    input.expiresInDays && input.expiresInDays > 0
      ? new Date(Date.now() + input.expiresInDays * 86_400_000)
      : null;
  await db.query(
    `INSERT INTO test_mutes (test_id, kind, reason, created_by, expires_at)
     VALUES ($1, $2::mute_kind, $3, $4, $5)`,
    [input.testId, input.kind, input.reason ?? null, input.createdBy ?? null, expiresAt],
  );
  return getActiveMute(db, input.testId) as Promise<ActiveMute>;
}

/** Lift the active mute (keeps history rows intact). */
export async function liftMute(db: Queryable, testId: number): Promise<void> {
  await db.query(
    `UPDATE test_mutes SET lifted_at = now()
     WHERE test_id = $1 AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [testId],
  );
}

/** The currently-active mute for a test, or null. */
export async function getActiveMute(
  db: Queryable,
  testId: number,
): Promise<ActiveMute | null> {
  const result = await db.query(
    `SELECT kind::text AS kind, reason, created_by, created_at, expires_at, lifted_at
     FROM test_mutes WHERE test_id = $1
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [testId],
  );
  const row = result.rows[0] as MuteRow & { lifted_at: string | Date | null } | undefined;
  return row ? toActive(row) : null;
}
