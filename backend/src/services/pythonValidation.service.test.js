/**
 * pythonValidation.service.test.js
 * Integration tests for the Node -> Python validation engine bridge.
 * Run: npm test   (uses node --test)
 *
 * These tests spawn the REAL python-validation/runner.py to prove the
 * stdin/stdout JSON contract, timeout handling, invalid-JSON handling, and
 * exit-code handling all work end to end. They deliberately request only
 * "performance"/"design" (still mocked placeholders) so this suite stays
 * fast and network-independent — functional/accessibility/responsive/
 * cross_browser now launch real browsers and are covered by manual
 * verification instead (see their READMEs).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPythonValidation, PythonValidationError } from "./pythonValidation.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_RUNNER = path.resolve(__dirname, "../../../python-validation/runner.py");

// ─────────────────────────────────────────────────────────────────────────────
// Happy path — real mocked runner.py
// ─────────────────────────────────────────────────────────────────────────────

test("runPythonValidation resolves a structured result from the real (mocked) runner", async () => {
  const result = await runPythonValidation({
    url: "https://example.com",
    targetType: "standard-web",
    ruleProfile: "web-ui-v1",
    checks: ["performance"],
  });

  assert.equal(result.status, "success");
  assert.ok(Array.isArray(result.findings));
  assert.ok(result.findings.length > 0, "expected mocked findings to be returned");
  assert.ok(result.findings.every((f) => f.mocked === true));
  assert.ok(Array.isArray(result.warnings));
  assert.ok(Array.isArray(result.errors));
  assert.equal(typeof result.metrics, "object");
});

test("runPythonValidation resolves status=error (not a rejection) for a missing url", async () => {
  // runner.py exits 1 but prints valid {"status":"error",...} JSON — this is a
  // *handled* failure and must resolve, not reject.
  const result = await runPythonValidation({ url: "" });
  assert.equal(result.status, "error");
  assert.ok(result.errors.some((e) => /url/i.test(e)));
});

test("unknown check names are tolerated by the runner and surfaced as warnings", async () => {
  const result = await runPythonValidation({
    url: "https://example.com",
    checks: ["design", "not-a-real-check"],
  });
  assert.equal(result.status, "success");
  assert.ok(result.warnings.some((w) => /not-a-real-check/.test(w)));
});

// ─────────────────────────────────────────────────────────────────────────────
// Process error handling — bad interpreter
// ─────────────────────────────────────────────────────────────────────────────

test("rejects with PythonValidationError when the python executable does not exist", async () => {
  await assert.rejects(
    () =>
      runPythonValidation(
        { url: "https://example.com" },
        { pythonExecutable: "definitely-not-a-real-python-binary", scriptPath: REAL_RUNNER }
      ),
    (err) => {
      assert.ok(err instanceof PythonValidationError);
      assert.match(err.message, /process error/i);
      return true;
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Invalid JSON handling + exit-code handling — fixture scripts
// ─────────────────────────────────────────────────────────────────────────────

test("rejects with PythonValidationError on non-JSON stdout", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "pyval-test-"));
  const script = path.join(dir, "not_json.py");
  writeFileSync(script, "print('this is not json')\n");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  await assert.rejects(
    () => runPythonValidation({ url: "https://example.com" }, { pythonExecutable: "python3", scriptPath: script }),
    (err) => {
      assert.ok(err instanceof PythonValidationError);
      assert.match(err.message, /invalid json/i);
      return true;
    }
  );
});

test("rejects with PythonValidationError on a bad exit code with no valid status:error JSON", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "pyval-test-"));
  const script = path.join(dir, "crash.py");
  writeFileSync(
    script,
    "import sys\nprint('{\"status\": \"success\"}')\nsys.stderr.write('boom\\n')\nsys.exit(2)\n"
  );
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  await assert.rejects(
    () => runPythonValidation({ url: "https://example.com" }, { pythonExecutable: "python3", scriptPath: script }),
    (err) => {
      assert.ok(err instanceof PythonValidationError);
      assert.match(err.message, /exited with code 2/i);
      assert.match(err.stderr, /boom/);
      return true;
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Execution timeout
// ─────────────────────────────────────────────────────────────────────────────

test("rejects with PythonValidationError when the process exceeds the timeout", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "pyval-test-"));
  const script = path.join(dir, "slow.py");
  writeFileSync(script, "import time\ntime.sleep(5)\nprint('{}')\n");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  await assert.rejects(
    () =>
      runPythonValidation(
        { url: "https://example.com" },
        { pythonExecutable: "python3", scriptPath: script, timeoutMs: 200 }
      ),
    (err) => {
      assert.ok(err instanceof PythonValidationError);
      assert.match(err.message, /timed out/i);
      assert.equal(err.code, "TIMEOUT");
      return true;
    }
  );
});
