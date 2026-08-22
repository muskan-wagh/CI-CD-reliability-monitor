import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJunit } from "../src/lib/junit.js";

const VITEST_XML = `
<testsuites name="vitest" tests="3" failures="1" time="4.21">
  <testsuite name="tests/auth.test.ts" tests="3" failures="1" errors="0" skipped="0" time="1.02">
    <testcase classname="tests/auth.test.ts" name="login accepts valid credentials" time="0.31"/>
    <testcase classname="tests/auth.test.ts" name="login rejects bad password" time="0.22">
      <failure message="Expected: 401 Received: 500" type="AssertionError">
        at Object.&lt;anonymous&gt; (/home/runner/work/repo/tests/auth.test.ts:42:11)
      </failure>
    </testcase>
    <testcase classname="tests/auth.test.ts" name="rate limit blocks 6th attempt" time="0.19">
      <skipped/>
    </testcase>
  </testsuite>
</testsuites>`;

test("parses a Vitest report with mixed statuses", () => {
  const tests = parseJunit(VITEST_XML);
  assert.equal(tests.length, 3);

  const [pass, fail, skip] = tests as [
    typeof tests[number],
    typeof tests[number],
    typeof tests[number],
  ];

  assert.equal(pass.name, "login accepts valid credentials");
  assert.equal(pass.status, "passed");
  assert.equal(pass.durationMs, 310);

  assert.equal(fail.status, "failed");
  assert.equal(fail.failureMessage, "Expected: 401 Received: 500");
  assert.equal(fail.errorClass, "AssertionError");

  assert.equal(skip.status, "skipped");
  assert.equal(skip.durationMs, 190);
});

test("handles a bare <testsuite> root without a wrapper", () => {
  const xml = `
  <testsuite name="math.test.ts" tests="1" failures="0" time="0.5">
    <testcase classname="math.test.ts" name="adds two numbers" time="0.05"/>
  </testsuite>`;
  const tests = parseJunit(xml);
  assert.equal(tests.length, 1);
  assert.equal(tests[0]?.name, "adds two numbers");
  assert.equal(tests[0]?.status, "passed");
});

test("treats <error> as a failure", () => {
  const xml = `
  <testsuites>
    <testsuite name="x" tests="1" failures="0" errors="1" time="0">
      <testcase classname="x.test.ts" name="explodes" time="0">
        <error message="cannot read property of undefined" type="TypeError">boom</error>
      </testcase>
    </testsuite>
  </testsuites>`;
  const tests = parseJunit(xml);
  assert.equal(tests[0]?.status, "failed");
  assert.equal(tests[0]?.errorClass, "TypeError");
});

test("self-closing testcase with no children is passed", () => {
  const xml = `
  <testsuites>
    <testsuite name="y" tests="1" time="0">
      <testcase classname="y.test.ts" name="trivial" time="0.001"/>
    </testsuite>
  </testsuites>`;
  const tests = parseJunit(xml);
  assert.equal(tests[0]?.status, "passed");
  assert.equal(tests[0]?.durationMs, 1);
});

test("returns an empty array for non-JUnit input without throwing", () => {
  assert.deepEqual(parseJunit("<html></html>"), []);
  assert.deepEqual(parseJunit("not xml at all"), []);
});

test("classname falls back to suite name when missing", () => {
  const xml = `
  <testsuites>
    <testsuite name="fallback.test.ts" tests="1" time="0">
      <testcase name="no classname here" time="0.1"/>
    </testsuite>
  </testsuites>`;
  const tests = parseJunit(xml);
  assert.equal(tests[0]?.filePath, "fallback.test.ts");
});

test("parses the flat node:test reporter shape (no <testsuite> wrapper)", () => {
  const xml = `
  <?xml version="1.0" encoding="utf-8"?>
  <testsuites>
    <testcase classname="test" name="passes cleanly" time="0.004"/>
    <testcase classname="test" name="fails loudly" time="0.01">
      <failure type="test:failure" message="expected 1 to equal 2">at test.ts:3</failure>
    </testcase>
  </testsuites>`;
  const tests = parseJunit(xml);
  assert.equal(tests.length, 2);
  assert.equal(tests[0]?.name, "passes cleanly");
  assert.equal(tests[0]?.status, "passed");
  assert.equal(tests[1]?.status, "failed");
  assert.equal(tests[1]?.failureMessage, "expected 1 to equal 2");
});
