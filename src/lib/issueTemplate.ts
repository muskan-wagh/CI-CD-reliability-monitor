import type { FailureEvidence } from "./evidence.js";
import type { AiInvestigation } from "./ai/types.js";
import type { CorrelatedPr } from "./prCorrelation.js";
import { redactDeep } from "./redact.js";

/**
 * GitHub-issue rendering for the Action Center (Phase H).
 *
 * Pure + deterministic: everything in the body is a recorded fact from the
 * evidence pack (plus an optional AI hypothesis and PR correlation), so the
 * issue can never contain secrets by construction — free text is redacted
 * again before return as defense-in-depth.
 */

export interface IssueTemplateInput {
  evidence: FailureEvidence;
  /** Latest cached AI investigation, when one exists. */
  ai: AiInvestigation | null;
  /** PR correlated with the first failing commit, when known. */
  pr: CorrelatedPr | null;
  /** Public dashboard URL of this test, when DASHBOARD_URL is configured. */
  testUrl?: string | null;
}

export function issueTitle(input: IssueTemplateInput): string {
  const { evidence } = input;
  const category = evidence.score?.category ?? "unanalyzed";
  const score = evidence.score?.score ?? "?";
  return `[Echo] ${evidence.test.name} is ${category} (flake score ${score})`;
}

function glyph(status: string): string {
  if (status === "failed") return "❌";
  if (status === "skipped") return "⏭️";
  return "✅";
}

/** Compact PASS/FAIL sequence for the most recent runs, oldest → newest. */
export function outcomeSequence(outcomes: FailureEvidence["outcomes"], max = 15): string {
  return outcomes
    .slice(-max)
    .map((o) => glyph(o.status))
    .join(" ");
}

const shortSha = (sha: string | null | undefined): string =>
  sha ? sha.slice(0, 7) : "—";

const fmtDate = (iso: string): string => iso.slice(0, 10);

export function renderIssueBody(input: IssueTemplateInput): string {
  const { evidence, ai, pr, testUrl } = input;
  const s = evidence.stats;
  const score = evidence.score;

  const lines: string[] = [];
  lines.push(
    `Echo flagged this test as unreliable. Data below is generated from recorded CI results — timing correlations only, no causal claims.`,
  );

  lines.push(`## Summary`);
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Test | \`${evidence.test.name}\` |`);
  lines.push(`| Repository | ${evidence.test.repository} |`);
  lines.push(`| File | \`${evidence.test.filePath}\` |`);
  if (score) {
    lines.push(`| Flake score | **${score.score}/100** (${score.category}) |`);
    lines.push(
      `| Failure rate | ${(score.failureRate * 100).toFixed(0)}% (${score.failureCount}/${score.windowSize} analyzed runs) |`,
    );
    lines.push(`| PASS→FAIL flips | ${s.passToFailTransitions} |`);
  }
  lines.push(`| First seen | ${evidence.test.firstSeenAt ? fmtDate(evidence.test.firstSeenAt) : "—"} |`);
  lines.push(`| Last seen | ${evidence.test.lastSeenAt ? fmtDate(evidence.test.lastSeenAt) : "—"} |`);

  lines.push(``);
  lines.push(`### Recent runs`);
  lines.push(outcomeSequence(evidence.outcomes));
  if (s.avgFailedDurationMs !== null) {
    lines.push(
      `<sub>avg failed duration ${s.avgFailedDurationMs}ms` +
        (s.avgPassedDurationMs !== null ? ` vs ${s.avgPassedDurationMs}ms passed</sub>` : `</sub>`),
    );
  }

  lines.push(``);
  lines.push(`## Failure signature${evidence.signatures.length > 1 ? "s" : ""}`);
  if (s.dominantSignatureSummary) {
    lines.push(`**${s.dominantSignatureSummary}**`);
  }
  for (const sig of evidence.signatures.slice(0, 3)) {
    lines.push(
      `- \`${sig.errorClass}\` ×${sig.occurrencesOnTest}${sig.shareOfFailures !== null ? ` (${Math.round(sig.shareOfFailures * 100)}%)` : ""}`,
    );
    lines.push(`  > ${sig.sampleMessage}`);
  }

  if (ai && ai.classification !== "UNKNOWN") {
    lines.push(``);
    lines.push(`## AI investigation — likely cause (${ai.classification}, ${Math.round(ai.confidence * 100)}% confidence)`);
    lines.push(ai.likely_cause || ai.summary);
    if (ai.evidence.length > 0) {
      lines.push(``);
      lines.push(`**Evidence**`);
      for (const e of ai.evidence.slice(0, 5)) lines.push(`- ✓ ${e}`);
    }
    if (ai.recommended_actions.length > 0) {
      lines.push(``);
      lines.push(`**Recommended investigation**`);
      for (const a of ai.recommended_actions.slice(0, 5)) lines.push(`- → ${a}`);
    }
  } else {
    lines.push(``);
    lines.push(`## AI investigation`);
    lines.push(`Not run yet — use “Investigate” on the Echo test page for a root-cause hypothesis.`);
  }

  lines.push(``);
  lines.push(`## Where to look first`);
  if (pr) {
    lines.push(
      `Reliability degradation was first observed after **PR #${pr.prNumber}**` +
        (pr.title ? ` — ${pr.title}` : "") +
        `. _(timing correlation, not causation)_`,
    );
    if (pr.changedFiles && pr.changedFiles.length > 0) {
      lines.push(``);
      lines.push(`<details><summary>Changed files (${pr.changedFiles.length})</summary>`);
      lines.push(``);
      for (const f of pr.changedFiles.slice(0, 15)) lines.push(`- \`${f}\``);
      if (pr.changedFiles.length > 15) {
        lines.push(`- …and ${pr.changedFiles.length - 15} more`);
      }
      lines.push(``);
      lines.push(`</details>`);
    }
  } else {
    const firstFailed = [...evidence.outcomes].find((o) => o.status === "failed");
    if (firstFailed) {
      lines.push(
        `First recorded failure on run #${firstFailed.githubRunId}` +
          ` (commit \`${shortSha(firstFailed.headSha)}\`, ${fmtDate(firstFailed.executedAt)}).`,
      );
    }
    lines.push(`No pull-request correlation is available for this commit yet.`);
  }

  if (testUrl) {
    lines.push(``);
    lines.push(`---`);
    lines.push(`[Open in Echo](${testUrl})`);
  }

  return redactDeep(lines.join("\n"));
}
