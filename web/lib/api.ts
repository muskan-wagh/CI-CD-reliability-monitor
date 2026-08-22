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
}

export interface RepoDetail {
  repo: { id: number; full_name: string };
  data: LeaderboardTest[];
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

export interface TestHistory {
  test: {
    id: number;
    name: string;
    file_path: string;
    suite_path: string;
    repository_id: number;
    repository_full_name: string;
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
  outcomes: HistoryOutcome[];
  signatures: {
    id: number;
    error_class: string;
    sample_message: string;
    occurrence_count: number;
    times_seen_on_test: number;
  }[];
}

const API_URL = process.env.API_URL ?? "http://localhost:3000";

export async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}
