import { auth } from "@clerk/nextjs/server";

export interface RepoSummary {
  id: number;
  full_name: string;
  total_tests: number;
  critical_tests: number;
  flaky_tests: number;
  watch_tests: number;
  broken_tests: number;
  insufficient_tests: number;
  last_run_at: string | null;
}

export type Category =
  | "insufficient"
  | "stable"
  | "watch"
  | "flaky"
  | "critical"
  | "broken";

export type MuteKind = "muted" | "quarantined";

export interface MuteInfo {
  kind: MuteKind;
  reason: string | null;
  createdBy?: string | null;
  createdAt?: string;
  expiresAt?: string | null;
}

export interface LeaderboardTest {
  id: number;
  file_path: string;
  suite_path: string;
  name: string;
  score: number | null;
  category: Category | null;
  previous_score: number | null;
  window_size: number | null;
  failure_count: number | null;
  failure_rate: number | null;
  transition_rate: number | null;
  wilson_lower: number | null;
  computed_at: string | null;
  recent_outcomes: string[];
  top_error_class: string | null;
  top_sample_message: string | null;
  last_failed_at: string | null;
  mute?: { kind: MuteKind; reason: string | null } | null;
  /** CODEOWNERS-derived; null when the repo has no CODEOWNERS. */
  owners?: string[] | null;
}

export interface RepoDetail {
  repo: { id: number; full_name: string };
  data: LeaderboardTest[];
}

export interface FailureCluster {
  error_class: string;
  failures: number;
  share_pct: number;
}

export interface RepoClusters {
  clusters: FailureCluster[];
  totalFailures: number;
}

export interface HistoryOutcome {
  status: "passed" | "failed" | "skipped";
  duration_ms: number | null;
  executed_at: string;
  source_job_name: string;
  github_run_id: string | number;
  head_sha: string;
  head_branch: string | null;
  error_class: string | null;
  sample_message: string | null;
}

export interface TimelineEvent {
  type: "first_seen" | "first_failure" | "became_flaky" | "signature";
  at: string;
  message: string;
  /** Present on first_failure when a PR was correlated for that commit. */
  pr?: { number: number; title: string | null } | null;
}

/** Cached PR correlation for a run's head SHA (Phase G). */
export interface CorrelatedPr {
  prNumber: number;
  title: string | null;
  authorLogin: string | null;
  state: string | null;
  changedFiles: string[] | null;
}

export interface TestHistory {
  test: {
    id: number;
    name: string;
    file_path: string;
    suite_path: string;
    repository_id: number;
    repository_full_name: string;
    first_seen_at: string | null;
    last_seen_at: string | null;
  };
  score: {
    score: number;
    category: Category;
    window_size: number;
    failure_count: number;
    failure_rate: number;
    transition_rate: number;
    wilson_lower: number | null;
    previous_score: number | null;
    computed_at: string;
  } | null;
  transitions: { passToFail: number; failToPass: number };
  mute?: MuteInfo | null;
  timeline: TimelineEvent[];
  /** head_sha → PR, when GitHub data allowed a correlation. */
  prsBySha?: Record<string, CorrelatedPr>;
  outcomes: HistoryOutcome[];
  signatures: {
    id: number;
    error_class: string;
    sample_message: string;
    occurrence_count: number;
    times_seen_on_test: number;
    first_seen_on_test: string | null;
  }[];
}

export interface DashboardStats {
  total_tests: number;
  flaky_tests: number;
  critical_tests: number;
  broken_tests: number;
  tests_analyzed: number;
}

export interface FlakyTestRow {
  id: number;
  name: string;
  file_path: string;
  repository_id: number;
  repository: string;
  score: number;
  category: Category;
  failure_rate: number;
  transition_rate: number;
  failure_count: number;
  window_size: number;
  last_seen: string | null;
  recent_status: string[];
  top_error_class: string | null;
  top_sample_message: string | null;
  signature_count: number | null;
  /** CODEOWNERS-derived; null when the repo has no CODEOWNERS. */
  owners?: string[] | null;
  first_unreliable_at?: string | null;
  first_failure_at?: string | null;
  first_failure_sha?: string | null;
  first_failure_pr_number?: number | null;
  first_failure_pr_title?: string | null;
  first_failure_changed_files?: string[] | null;
  ai_result?: AiInvestigation | null;
  ai_provider?: string | null;
  ai_model?: string | null;
  ai_classification?: string | null;
  ai_confidence?: number | null;
}

export interface MutedTestRow {
  id: number;
  name: string;
  file_path: string;
  repository: string;
  score: number | null;
  category: Category | null;
  mute_kind: MuteKind;
  mute_reason: string | null;
  mute_created_by: string | null;
  mute_expires_at: string | null;
}

export interface RecentRun {
  id: number;
  repository: string;
  workflow_name: string | null;
  github_run_id: string | number;
  conclusion: string | null;
  results_state: string;
  started_at: string | null;
  completed_at: string | null;
  test_count: number;
  flaky_count: number;
  failed_count: number;
}

export interface ActivityItem {
  key: string;
  type: string;
  repository: string;
  message: string;
  at: string;
}

export interface Reliability {
  score: number | null;
  previous: number | null;
  analyzed: number;
}

export interface TrendItem {
  id: number;
  name: string;
  file_path: string;
  repository: string;
  score: number;
  previous_score: number | null;
  category: Category;
  delta: number;
  failure_rate?: number;
  computed_at?: string;
}

export interface CiWaste {
  windowDays: number;
  failedDurationMs: number;
  failedResults: number;
  flakyDurationMs: number;
  totalDurationMs: number;
  totalResults: number;
  /** Failed results followed immediately by a pass — flake signature. */
  recoveredFailures: number;
  /** Distinct runs containing a failing result on a problematic test. */
  affectedRuns: number;
  /** Wall-clock duration of those runs. */
  affectedWallMs: number;
}

export interface Dashboard {
  stats: DashboardStats;
  reliability: Reliability;
  mostFlakyTests: FlakyTestRow[];
  mutedTests: MutedTestRow[];
  ownershipSummary?: { owner: string; count: number }[];
  newlyFlaky: TrendItem[];
  trendingWorse: TrendItem[];
  trendingBetter: TrendItem[];
  ciWaste: CiWaste;
  recentRuns: RecentRun[];
  recentActivity: ActivityItem[];
}

export interface AiInvestigation {
  summary: string;
  classification: "CONFIRMED" | "LIKELY" | "POSSIBLE" | "UNKNOWN";
  likely_cause: string;
  confidence: number;
  evidence: string[];
  possible_causes: string[];
  recommended_actions: string[];
}

export interface InvestigateResponse {
  cached: boolean;
  provider: string;
  model: string;
  investigation: AiInvestigation;
}

export interface LatestInvestigation {
  investigation:
    | {
        provider: string;
        model: string;
        classification: string | null;
        confidence: number | null;
        result: AiInvestigation;
        created_at: string;
      }
    | null;
}

export interface Health {
  status: "ok" | "degraded";
  checks: {
    githubApp: { status: string; credentialsConfigured: boolean; installations: number };
    database: { status: string };
    webhook: { status: string; deliveries: number; lastDelivery: string | null };
    ingestion: { status: string; resultsStored: number };
    scoring: { status: string; testsScored: number };
  };
}

export interface DebugStatus {
  installations: number;
  repositories: number;
  workflow_runs: number;
  tests: number;
  test_results: number;
  flake_scores: number;
  flaky_tests: number;
  failure_signatures: number;
  webhook_deliveries: number;
}

const API_URL = process.env.API_URL ?? "http://localhost:3000";

/**
 * Auth headers for server-side calls to the Echo API. The caller's
 * Clerk session token is forwarded as a Bearer token; the API verifies it
 * independently (signature + tenant scope) — the frontend never supplies its
 * own installation ids.
 */
export async function sessionAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  try {
    const { getToken } = await auth();
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // No request scope (build/prerender) or no session — send unauthenticated.
  }
  return headers;
}

interface ForwardedResponse<T> {
  status: number;
  body: T | null;
}

/** POST/GET/DELETE passthrough for Next route handlers (session-aware, error-mapped). */
export async function apiForward<T>(
  path: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  body?: unknown,
): Promise<ForwardedResponse<T>> {
  const headers = {
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(await sessionAuthHeaders()),
  };
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      cache: "no-store",
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const parsed = res.status === 204 ? null : ((await res.json().catch(() => null)) as T | null);
    return { status: res.status, body: parsed };
  } catch {
    return {
      status: 502,
      body: { error: "api_unreachable", detail: `Could not reach ${API_URL}` } as unknown as T,
    };
  }
}

/**
 * Fetch a JSON endpoint from the Echo API. Throws a descriptive error on
 * non-2xx responses so callers can distinguish "API down" from "empty data".
 *
 * The caller's Clerk session token is forwarded to the API as a Bearer token;
 * the API verifies it independently.
 */
export async function api<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      cache: "no-store",
      headers: await sessionAuthHeaders(),
    });
  } catch {
    throw new Error(
      `Could not reach the Echo API at ${API_URL}. Is the backend running? (npm run dev)`,
    );
  }
  if (!res.ok) {
    throw new Error(`API ${path} failed: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}
