#!/usr/bin/env node
// Deterministic flaky-test demo for Echo.
//
// `testLogin` fails whenever the workflow run number is a multiple of 3:
//   run 1 PASS, run 2 PASS, run 3 FAIL, run 4 PASS, run 5 PASS, run 6 FAIL ...
// which is the canonical "flaky" pattern (pass/fail alternation on identical
// code). No randomness, no sleeps — the outcome is a pure function of the run
// number, so a demo is fully reproducible.
//
// Writes a JUnit XML report to `junit.xml` that the Echo action uploads.

import { writeFileSync } from "node:fs";

const runNumber = Number(process.env.GITHUB_RUN_NUMBER || process.env.RUN_NUMBER || "1");

// flaky: deterministic pass/fail on a 3-cycle
const loginFails = runNumber % 3 === 0;
// a second, permanently-failing test once we're past run 10 (BROKEN demo)
const refundFails = runNumber >= 10;

function esc(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function testcase(file, name, failed, errorClass, message, time) {
  const attrs = `classname="${esc(file)}" name="${esc(name)}" time="${time}"`;
  if (!failed) return `  <testcase ${attrs}/>`;
  return [
    `  <testcase ${attrs}>`,
    `    <failure message="${esc(message)}" type="${esc(errorClass)}">${esc(message)}</failure>`,
    `  </testcase>`,
  ].join("\n");
}

const cases = [
  testcase(
    "src/auth/login.test.js",
    "testLogin",
    loginFails,
    "TimeoutError",
    "Exceeded 5000ms waiting for promise",
    "1.203",
  ),
  testcase(
    "src/checkout/checkout.test.js",
    "testCheckout",
    false,
    "",
    "",
    "0.442",
  ),
  testcase(
    "src/payments/refund.test.js",
    "testRefund",
    refundFails,
    "AssertionError",
    "expected 200 but got 500",
    "0.618",
  ),
].join("\n");

const xml = [
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<testsuites>`,
  `  <testsuite name="demo" tests="3">`,
  cases,
  `  </testsuite>`,
  `</testsuites>`,
].join("\n");

writeFileSync("junit.xml", xml + "\n");
console.log(
  `[demo] run #${runNumber}: testLogin=${loginFails ? "FAIL" : "PASS"} ` +
    `testRefund=${refundFails ? "FAIL" : "PASS"} testCheckout=PASS`,
);
