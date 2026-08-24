import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCodeowners,
  ownersForPath,
  aggregateOwnership,
} from "../src/lib/codeowners.js";

const SAMPLE = [
  "# comment line — ignored",
  "",
  "* @global-owner1 @org/global",
  "/src/auth/ @org/backend",
  "*.md @org/docs",
  "/docs/** @org/docs",
  "**/integration/ @org/qa",
  "/src/legacy.ts @alice",
].join("\n");

test("parseCodeowners skips blanks/comments and collects @ owners", () => {
  const rules = parseCodeowners(SAMPLE);
  assert.equal(rules.length, 6);
  assert.deepEqual(rules[0]!.owners, ["@global-owner1", "@org/global"]);
});

test("rules without owners are dropped", () => {
  const rules = parseCodeowners("src/ not-an-owner\n/src/ @alice");
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0]!.owners, ["@alice"]);
});

test("last matching rule wins (GitHub precedence)", () => {
  const rules = parseCodeowners(SAMPLE);
  // /src/auth/login.test.js matches '*' then '/src/auth/' — last wins.
  assert.deepEqual(ownersForPath(rules, "src/auth/login.test.js"), ["@org/backend"]);
  // /src/legacy.ts matches '*', then the exact rule later.
  assert.deepEqual(ownersForPath(rules, "src/legacy.ts"), ["@alice"]);
  assert.deepEqual(ownersForPath(rules, "README.md"), ["@org/docs"]);
  assert.deepEqual(ownersForPath(rules, "packages/integration/x.spec.ts"), ["@org/qa"]);
});

test("directory pattern covers files within it", () => {
  const rules = parseCodeowners("/src/ @team\n");
  assert.deepEqual(ownersForPath(rules, "src/a/b.js"), ["@team"]);
  assert.equal(ownersForPath(rules, "other/a.js"), null);
});

test("leading **/ matches any depth including root", () => {
  const rules = parseCodeowners("**/tests/** @qa\n");
  assert.deepEqual(ownersForPath(rules, "tests/a.spec.ts"), ["@qa"]);
  assert.deepEqual(ownersForPath(rules, "apps/api/tests/b.spec.ts"), ["@qa"]);
});

test("bare * matches every path (default-owner semantics)", () => {
  const rules = parseCodeowners("* @root-only\n");
  assert.ok(ownersForPath(rules, "README.md"));
  assert.ok(ownersForPath(rules, "nested/README.md"));
});

test("unknown path yields null (ownership unknown, never invented)", () => {
  const rules = parseCodeowners("/src/auth/ @team");
  assert.equal(ownersForPath(rules, "docs/readme.md"), null);
});

test("aggregateOwnership counts per owner token across tests", () => {
  const rows = [
    { filePath: "src/auth/login.test.js" },
    { filePath: "src/auth/logout.test.js" },
    { filePath: "src/legacy.ts" },
    { filePath: "unknown/place.test.js" },
    { filePath: null },
  ];
  const out = aggregateOwnership(rows, parseCodeowners(SAMPLE));
  assert.deepEqual(out, [
    { owner: "@org/backend", count: 2 },
    { owner: "@alice", count: 1 },
    { owner: "@global-owner1", count: 1 },
    { owner: "@org/global", count: 1 },
  ]);
});
