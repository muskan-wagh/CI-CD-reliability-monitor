import { createHash } from "node:crypto";
import type { FailureEvidence } from "../evidence.js";
import { redactDeep } from "../redact.js";

/**
 * Provider-agnostic AI investigation contract (Phase D/E).
 *
 * The deterministic engine stays responsible for PASS/FAIL, rates and the
 * FLAKY/CRITICAL/BROKEN verdict. The AI only interprets the evidence pack
 * produced by src/lib/evidence.ts — nothing else is ever sent.
 */

export const CLASSIFICATIONS = ["CONFIRMED", "LIKELY", "POSSIBLE", "UNKNOWN"] as const;
export type AiClassification = (typeof CLASSIFICATIONS)[number];

export interface AiInvestigation {
  summary: string;
  classification: AiClassification;
  likely_cause: string;
  /** 0..1 */
  confidence: number;
  evidence: string[];
  possible_causes: string[];
  recommended_actions: string[];
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  investigate(evidence: FailureEvidence): Promise<AiInvestigation>;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI provider is not configured");
    this.name = "AiNotConfiguredError";
  }
}

export class AiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderError";
  }
}

export const INSUFFICIENT_SUMMARY =
  "Insufficient evidence to determine the root cause.";

export function insufficientEvidenceResult(
  availableEvidence: string[],
): AiInvestigation {
  return {
    summary: INSUFFICIENT_SUMMARY,
    classification: "UNKNOWN",
    likely_cause: "",
    confidence: 0,
    evidence: availableEvidence,
    possible_causes: [],
    recommended_actions: [
      "Add the failing test's stack trace / full logs so there is enough signal to analyze.",
    ],
  };
}

function unknownFallback(detail: string): AiInvestigation {
  return {
    summary: `The AI response could not be used (${detail}).`,
    classification: "UNKNOWN",
    likely_cause: "",
    confidence: 0,
    evidence: [],
    possible_causes: [],
    recommended_actions: ["Try Investigate again."],
  };
}

const asString = (v: unknown, max = 800): string =>
  typeof v === "string" ? v.slice(0, max) : "";
const asStringArray = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string").slice(0, 10).map((s) => s.slice(0, 500))
    : [];

/**
 * Parse and validate a model completion into an AiInvestigation.
 * Returns null when nothing usable came back — callers must not invent facts.
 */
export function parseAiResponse(content: string): AiInvestigation | null {
  let text = content.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) text = fence[1]!.trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const summary = asString(raw.summary);
  const likelyCause = asString(raw.likely_cause);
  const evidence = asStringArray(raw.evidence);
  const possibleCauses = asStringArray(raw.possible_causes);
  const actions = asStringArray(raw.recommended_actions);

  // Nothing usable at all -> treat as failure, not as an answer.
  if (!summary && !likelyCause && evidence.length === 0) return null;

  const clsRaw = typeof raw.classification === "string" ? raw.classification.toUpperCase() : "";
  const classification = (CLASSIFICATIONS as readonly string[]).includes(clsRaw)
    ? (clsRaw as AiClassification)
    : "UNKNOWN";

  const confRaw = Number(raw.confidence);
  const confidence = Number.isFinite(confRaw) ? Math.min(1, Math.max(0, confRaw)) : 0;

  return redactDeep({
    summary: summary || likelyCause || "No summary returned.",
    classification,
    likely_cause: likelyCause,
    confidence,
    evidence,
    possible_causes: possibleCauses,
    recommended_actions: actions,
  });
}

/**
 * Deterministic context hash for caching: identical failure contexts are never
 * re-sent to the provider. Volatile fields (timestamps, durations, run ids) are
 * deliberately excluded; identity + failure sequence + signatures define it.
 */
export function computeInputHash(evidence: FailureEvidence): string {
  const canonical = {
    v: 1,
    repository: evidence.test.repository,
    filePath: evidence.test.filePath,
    name: evidence.test.name,
    category: evidence.score?.category ?? null,
    score: evidence.score?.score ?? null,
    sequence: evidence.outcomes.map((o) => `${o.status.charAt(0)}:${o.errorClass ?? ""}`).join("|"),
    signatures: evidence.signatures
      .map((s) => `${s.fingerprint}:${s.occurrencesOnTest}`)
      .sort(),
    passToFail: evidence.stats.passToFailTransitions,
    trailingFails: evidence.stats.trailingConsecutiveFailures,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Redacted copy of the evidence pack — the exact bytes sent to a provider. */
export function redactEvidence(evidence: FailureEvidence): FailureEvidence {
  return redactDeep(evidence);
}
