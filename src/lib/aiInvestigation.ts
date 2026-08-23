import type { Queryable } from "./store.js";
import { buildFailureEvidence } from "./evidence.js";
import {
  computeInputHash,
  getAiProvider,
  insufficientEvidenceResult,
  AiNotConfiguredError,
  type AiInvestigation,
} from "./ai/index.js";
import { redactDeep } from "./redact.js";

export interface InvestigationResult {
  cached: boolean;
  provider: string;
  model: string;
  investigation: AiInvestigation;
}

interface CacheRow {
  id: string | number;
  input_hash: string;
  classification: string | null;
  confidence: number | null;
  result: unknown;
}

function rowToResult(row: CacheRow): InvestigationResult {
  return {
    cached: true,
    provider: "cache",
    model: "cache",
    investigation:
      typeof row.result === "string"
        ? (JSON.parse(row.result) as AiInvestigation)
        : (row.result as AiInvestigation),
  };
}

/**
 * Investigate one test with the AI layer (Phase D), under Phase E cost rules:
 *
 * 1. No recorded failures → deterministic "insufficient evidence" answer, the
 *    provider is never called and nothing is billed.
 * 2. Identical evidence context (sha256 over identity + failure sequence +
 *    signature fingerprints) → served from cicd_ai_investigations.
 * 3. Otherwise → one bounded provider call; the result is redacted again and
 *    persisted. Secrets never reach the provider or this table.
 */
export async function investigateTest(
  db: Queryable,
  testId: number,
): Promise<InvestigationResult> {
  const evidence = await buildFailureEvidence(db, testId);
  if (!evidence) {
    const err = new Error("not_found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  // Cost rule #1: nothing to investigate without recorded failures.
  if (!evidence.signatures.length || !evidence.score) {
    const available = [
      ...new Set(evidence.outcomes.map((o) => o.errorClass).filter((c): c is string => !!c)),
    ];
    const investigation = insufficientEvidenceResult(
      available.length ? available.map((c) => `Observed error class: ${c}`) : ["No failures recorded yet."],
    );
    return { cached: false, provider: "none", model: "none", investigation };
  }

  const provider = getAiProvider();

  // Cost rule #2: identical context → cached answer.
  const inputHash = computeInputHash(evidence);
  const existing = await db.query(
    `SELECT id, input_hash, classification, confidence, result
     FROM cicd_ai_investigations WHERE input_hash = $1`,
    [inputHash],
  );
  if (existing.rows[0]) {
    return rowToResult(existing.rows[0] as CacheRow);
  }

  // Cost rule #3: a single bounded provider call on a cache miss.
  const investigation = await provider.investigate(evidence);

  // Defense-in-depth: redact whatever came back before persisting/returning.
  const safe = redactDeep(investigation);

  const topSignature = evidence.signatures[0];
  const lastRun = [...evidence.outcomes].at(-1);

  await db.query(
    `INSERT INTO cicd_ai_investigations
       (test_id, workflow_run_id, failure_signature_id, provider, model, input_hash, classification, confidence, result)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (input_hash) DO NOTHING`,
    [
      testId,
      lastRun?.workflowRunId ?? null,
      topSignature?.id ?? null,
      provider.name,
      provider.model,
      inputHash,
      safe.classification,
      safe.confidence,
      JSON.stringify(safe),
    ],
  );

  return { cached: false, provider: provider.name, model: provider.model, investigation: safe };
}
