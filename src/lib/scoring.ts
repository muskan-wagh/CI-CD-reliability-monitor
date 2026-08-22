import type { TestStatus } from "./junit.js";

export type FlakeCategory =
  | "insufficient"
  | "stable"
  | "watch"
  | "flaky"
  | "critical"
  | "broken";

export interface FlakeScoreResult {
  score: number;
  category: FlakeCategory;
  windowSize: number;
  failureCount: number;
  failureRate: number;
  transitionRate: number;
  wilsonLower: number | null;
  consecutiveFails: number;
}

/** Minimum samples before a score is meaningful. */
export const MIN_SAMPLES = 8;
/** Rolling window size. */
export const WINDOW_SIZE = 30;
/** Recency decay factor for transition weighting. */
export const LAMBDA = 0.9;
/** Weight of the transition signal in the raw score. */
export const TRANSITION_WEIGHT = 0.7;
/** Weight of the failure-rate signal in the raw score. */
export const FAILURE_WEIGHT = 0.3;
/** Failure rate above which the rate term stops contributing (capped). */
export const FAILURE_CAP = 0.5;
/** Consecutive trailing failures that flip a test to BROKEN. */
export const BROKEN_STREAK = 5;

/**
 * 95% Wilson score interval lower bound on a proportion.
 * Unlike a raw percentage, it stays sane at small sample sizes: "1 of 2" does
 * NOT produce a confident 50%. Returns null when there are no samples.
 */
export function wilsonLowerBound(successes: number, trials: number): number | null {
  if (trials <= 0) return null;
  const z = 1.96;
  const p = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = p + (z * z) / (2 * trials);
  const margin =
    z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
  return Math.max(0, (center - margin) / denominator);
}

function isFailure(status: TestStatus): boolean {
  return status === "failed";
}

/**
 * The MVP flake score.
 *
 * Two signals distinguish a *flaky* test from a *broken* one:
 *  - failure rate `r` (how often red) — necessary but insufficient
 *  - transition rate `tr` (how often it flips PASS<->FAIL) — the key
 *    discriminator: flaky = many transitions, broken = one long streak.
 *
 * Transitions are recency-weighted (λ=0.9) so recent flips dominate. The
 * failure-rate term is capped at r=0.5 so a permanently-dead test can't ride
 * it to a maximal *flake* score — chronic failure is a different disease.
 */
export function computeFlakeScore(outcomes: TestStatus[]): FlakeScoreResult {
  const window = outcomes.slice(-WINDOW_SIZE);
  const n = window.length;

  const failures = window.filter(isFailure).length;
  const failureRate = n === 0 ? 0 : failures / n;

  // Trailing consecutive failures (newest backwards).
  let consecutiveFails = 0;
  for (let i = window.length - 1; i >= 0 && isFailure(window[i] as TestStatus); i--) {
    consecutiveFails++;
  }

  // Recency-weighted transition rate over adjacent boundaries.
  const boundaries = n - 1;
  let transitionRate = 0;
  if (boundaries > 0) {
    let weightedSum = 0;
    let weightTotal = 0;
    for (let i = 0; i < boundaries; i++) {
      const flipped =
        isFailure(window[i] as TestStatus) !== isFailure(window[i + 1] as TestStatus);
      // boundary i sits between outcomes[i] and outcomes[i+1]; age 0 = newest.
      const age = boundaries - 1 - i;
      const weight = Math.pow(LAMBDA, age);
      weightTotal += weight;
      if (flipped) weightedSum += weight;
    }
    transitionRate = weightTotal === 0 ? 0 : weightedSum / weightTotal;
  }

  const insufficient = n < MIN_SAMPLES;

  let score = 0;
  if (!insufficient) {
    const raw =
      TRANSITION_WEIGHT * transitionRate +
      FAILURE_WEIGHT * Math.min(failureRate / FAILURE_CAP, 1);
    score = Math.round(100 * raw);
  }

  const category = categorize(score, consecutiveFails, insufficient);

  return {
    score,
    category,
    windowSize: n,
    failureCount: failures,
    failureRate,
    transitionRate,
    wilsonLower: wilsonLowerBound(failures, n),
    consecutiveFails,
  };
}

function categorize(
  score: number,
  consecutiveFails: number,
  insufficient: boolean,
): FlakeCategory {
  if (consecutiveFails >= BROKEN_STREAK) return "broken";
  if (insufficient) return "insufficient";
  if (score <= 9) return "stable";
  if (score <= 29) return "watch";
  if (score <= 59) return "flaky";
  return "critical";
}
