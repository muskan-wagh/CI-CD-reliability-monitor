import type { FailureEvidence } from "../evidence.js";
import type { AiInvestigation, AiProvider } from "./types.js";

/**
 * Deterministic offline provider used ONLY for local development / tests when
 * no real provider is configured (NODE_ENV !== "production"). It restates
 * recorded facts from the evidence pack, clearly labeled "[stub]" — it never
 * invents causes, so nothing can be mistaken for a real AI answer.
 */
export class StubProvider implements AiProvider {
  readonly name = "stub";
  readonly model = "offline-facts";

  async investigate(evidence: FailureEvidence): Promise<AiInvestigation> {
    const sigs = evidence.signatures;
    const dominant = sigs[0];
    const facts = [
      `${evidence.stats.passToFailTransitions} PASS→FAIL transitions in the last ${evidence.outcomes.length} runs`,
      dominant
        ? `Dominant signature: ${dominant.errorClass} ×${dominant.occurrencesOnTest}`
        : null,
      evidence.stats.avgFailedDurationMs !== null
        ? `Average failed-run duration: ${evidence.stats.avgFailedDurationMs}ms`
        : null,
      evidence.score ? `Deterministic verdict: ${evidence.score.category} (score ${evidence.score.score})` : null,
    ].filter((x): x is string => x !== null);

    return {
      summary:
        `[stub] No AI provider configured. Recorded facts: ${facts.join("; ")}. ` +
        `Set AI_PROVIDER/AI_MODEL/AI_API_KEY to enable real analysis.`,
      classification: "POSSIBLE",
      likely_cause: dominant ? dominant.errorClass : "",
      confidence: 0.3,
      evidence: facts,
      possible_causes: [],
      recommended_actions: [
        "Configure an AI provider (e.g. OpenRouter) to get a real investigation.",
      ],
    };
  }
}
