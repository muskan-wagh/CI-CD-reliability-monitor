import { XMLParser } from "fast-xml-parser";

export type TestStatus = "passed" | "failed" | "skipped";

export interface ParsedTest {
  /** Raw classname — typically the file path. Normalization happens later. */
  filePath: string;
  /** Test title (may include describe-chain nesting, depending on framework). */
  name: string;
  status: TestStatus;
  durationMs: number | null;
  failureMessage?: string;
  errorClass?: string;
}

type Attr = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Force repeated elements to always be arrays so parsing doesn't special-case 0/1/many.
  isArray: (name) =>
    ["testsuites", "testsuite", "testcase", "failure", "error", "skipped"].includes(
      name,
    ),
});

function attr(node: unknown, key: string): string | number | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const value = (node as Attr)[key];
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function text(node: unknown): string | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const t = (node as Attr)["#text"];
  return typeof t === "string" ? t : undefined;
}

/**
 * Convert a JUnit `time` attribute to milliseconds.
 * Reporters overwhelmingly emit seconds (Jest, Vitest, pytest), so we treat
 * the value as seconds. Values that look like whole seconds (integers > 0)
 * are still treated as seconds — documented limitation, refined later.
 */
function toDurationMs(time: string | number | undefined): number | null {
  if (time === undefined || time === "") return null;
  const seconds = Number(time);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds * 1000);
}

function statusOf(testcase: unknown): TestStatus {
  if (typeof testcase !== "object" || testcase === null) return "passed";
  const node = testcase as Attr;
  const failures = node.failure;
  const errors = node.error;
  if ((Array.isArray(failures) && failures.length > 0) || (Array.isArray(errors) && errors.length > 0)) {
    return "failed";
  }
  const skipped = node.skipped;
  if (Array.isArray(skipped) && skipped.length > 0) {
    return "skipped";
  }
  return "passed";
}

function firstFailure(testcase: unknown): {
  failureMessage?: string;
  errorClass?: string;
} {
  if (typeof testcase !== "object" || testcase === null) return {};
  const node = testcase as Attr;
  const candidates = Array.isArray(node.failure)
    ? node.failure
    : Array.isArray(node.error)
      ? node.error
      : [];
  if (candidates.length === 0) return {};

  const first = candidates[0] as Attr;
  const message = attr(first, "@_message");
  const type = attr(first, "@_type");
  const bodyText = text(first);

  const errorClass = typeof type === "string" && type.length > 0 ? type : "Unknown";
  const failureMessage =
    typeof message === "string" && message.length > 0
      ? message
      : bodyText ?? errorClass;

  return { failureMessage, errorClass };
}

/**
 * Parse a JUnit XML string into normalized `ParsedTest` records.
 * Handles three shapes seen in the wild:
 *  - `<testsuites><testsuite><testcase/></testsuite></testsuites>` (Vitest/Jest/pytest)
 *  - bare `<testsuite>` roots (some tools)
 *  - flat `<testsuites><testcase/></testsuites>` (node:test reporter)
 */
export function parseJunit(xml: string): ParsedTest[] {
  const doc = parser.parse(xml) as Attr;

  const suites: unknown[] = [];
  const looseTests: unknown[] = [];

  const roots = Array.isArray(doc.testsuites)
    ? doc.testsuites
    : doc.testsuites
      ? [doc.testsuites]
      : [];

  for (const root of roots) {
    collectSuites(root, suites);
    if (typeof root === "object" && root !== null) {
      const n = root as Attr;
      // node:test style: <testcase> directly inside <testsuites>
      if (Array.isArray(n.testcase)) looseTests.push(...n.testcase);
      else if (n.testcase) looseTests.push(n.testcase);
    }
  }

  if (Array.isArray(doc.testsuite)) suites.push(...doc.testsuite);
  else if (doc.testsuite) suites.push(doc.testsuite);

  const tests: ParsedTest[] = [];
  const pushTestcase = (tc: unknown, fallbackFilePath: string) => {
    if (typeof tc !== "object" || tc === null) return;
    const className = attr(tc, "@_classname");
    const name = attr(tc, "@_name");
    const time = attr(tc, "@_time");

    const filePath =
      typeof className === "string" && className.length > 0 ? className : fallbackFilePath;
    const { failureMessage, errorClass } = firstFailure(tc);

    tests.push({
      filePath,
      name: typeof name === "string" ? name : "",
      status: statusOf(tc),
      durationMs: toDurationMs(time),
      ...(failureMessage !== undefined ? { failureMessage } : {}),
      ...(errorClass !== undefined ? { errorClass } : {}),
    });
  };

  for (const suite of suites) {
    if (typeof suite !== "object" || suite === null) continue;
    const suiteNode = suite as Attr;
    const suiteName =
      typeof attr(suiteNode, "@_name") === "string"
        ? String(attr(suiteNode, "@_name"))
        : "";

    const testcases = Array.isArray(suiteNode.testcase) ? suiteNode.testcase : [];
    for (const tc of testcases) pushTestcase(tc, suiteName);
  }

  for (const tc of looseTests) pushTestcase(tc, "");

  return tests;
}

function collectSuites(node: unknown, into: unknown[]): void {
  if (typeof node !== "object" || node === null) return;
  const n = node as Attr;
  if (Array.isArray(n.testsuite)) {
    into.push(...n.testsuite);
  } else if (n.testsuite) {
    into.push(n.testsuite);
  }
}
