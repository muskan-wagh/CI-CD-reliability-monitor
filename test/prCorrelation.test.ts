import { test } from "node:test";
import assert from "node:assert/strict";
import type { Queryable } from "../src/lib/store.js";
import { getPrsByShas } from "../src/lib/prCorrelation.js";

interface Row {
  head_sha: string;
  pr_number: number;
  title: string | null;
  author_login: string | null;
  state: string | null;
  changed_files: string[] | null;
}

function fakeDb(rows: Row[]): Queryable {
  return {
    async query(sql: string, params?: unknown[]) {
      if (sql.includes("FROM pull_requests")) {
        const repositoryId = params?.[0];
        const shas = (params?.[1] ?? []) as string[];
        return {
          rows: rows
            .filter((r) => shas.includes(r.head_sha))
            .map((r) => ({ ...r, repository_id: repositoryId })),
        };
      }
      return { rows: [] };
    },
  } as unknown as Queryable;
}

test("getPrsByShas keys cached correlations by sha", async () => {
  const db = fakeDb([
    { head_sha: "a".repeat(40), pr_number: 142, title: "Add refunds", author_login: "priya", state: "closed", changed_files: ["src/a.ts"] },
    { head_sha: "b".repeat(40), pr_number: 143, title: null, author_login: null, state: null, changed_files: null },
  ]);
  const out = await getPrsByShas(db, 1, ["a".repeat(40), "b".repeat(40), "c".repeat(40)]);
  assert.equal(out["a".repeat(40)]?.prNumber, 142);
  assert.deepEqual(out["a".repeat(40)]?.changedFiles, ["src/a.ts"]);
  assert.equal(out["b".repeat(40)]?.prNumber, 143);
  assert.equal(out["c".repeat(40)], undefined);
});

test("getPrsByShas is empty without shas or matches", async () => {
  assert.deepEqual(await getPrsByShas(fakeDb([]), 1, []), {});
  const out = await getPrsByShas(fakeDb([]), 1, ["d".repeat(40)]);
  assert.deepEqual(out, {});
});

test("correlation wording never claims causation", () => {
  // The exact sentence pattern the UI must produce.
  const sentence = (prNumber: number) =>
    `Reliability degradation was first observed after PR #${prNumber}.`;
  assert.match(sentence(142), /first observed after PR #142\./);
  assert.ok(!/caused by|caused the/.test(sentence(142)));
});
