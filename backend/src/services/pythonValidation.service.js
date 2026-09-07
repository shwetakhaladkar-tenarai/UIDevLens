/**
 * pythonValidation.service.js
 * Invokes the custom Python validation engine (python-validation/runner.py)
 * as a subprocess and returns its structured JSON result.
 *
 * Security: the request is sent as a JSON document over the child's stdin.
 * The process is spawned with an argv array and shell:false, so nothing
 * from the request (including the target URL) is ever interpolated into a
 * shell command string.
 *
 * Python performs deterministic validation only — it never calls OpenAI and
 * never makes AI decisions. This service is a thin, defensive transport.
 */
import { spawn } from "node:child_process";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

const MAX_BUFFERED_OUTPUT = 10 * 1024 * 1024; // 10MB guard against runaway output

export class PythonValidationError extends Error {
  constructor(message, { code = null, stderr = "", stdout = "" } = {}) {
    super(message);
    this.name = "PythonValidationError";
    this.code = code;
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

/**
 * Run the Python validation engine on one target.
 *
 * @param {object} request
 * @param {string} request.url
 * @param {string} [request.targetType]
 * @param {string} [request.ruleProfile]
 * @param {string[]} [request.checks]
 * @param {object} [request.options]
 * @param {object} [opts]
 * @param {string} [opts.pythonExecutable]
 * @param {string} [opts.scriptPath]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{status:"success"|"partial"|"error", findings:Array, metrics:object, warnings:string[], errors:string[]}>}
 *   Resolves even when runner.py reports status "error" (a *handled*
 *   failure) — the caller decides whether that's fatal. Rejects with a
 *   PythonValidationError only when the process itself could not be run or
 *   did not produce a usable result (spawn failure, timeout, bad exit,
 *   invalid JSON).
 */
export function runPythonValidation(request, opts = {}) {
  const {
    pythonExecutable = config.pythonValidation.executable,
    scriptPath = config.pythonValidation.scriptPath,
    timeoutMs = config.pythonValidation.timeoutMs,
  } = opts;

  const payload = JSON.stringify({
    url: request.url,
    targetType: request.targetType || "standard-web",
    ruleProfile: request.ruleProfile,
    checks: request.checks || [],
    options: request.options || {},
  });

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(pythonExecutable, [scriptPath], {
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });
    } catch (err) {
      reject(
        new PythonValidationError(`Failed to spawn Python validation process: ${err.message}`, {})
      );
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    // Ignore stdin write errors (e.g. EPIPE if the child already exited) —
    // the 'error'/'close' handlers below surface the real failure.
    child.stdin.on("error", () => {});

    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_BUFFERED_OUTPUT) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_BUFFERED_OUTPUT) stderr += chunk;
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 2000);
      killTimer.unref?.();
    }, timeoutMs);
    timer.unref?.();

    child.on("error", (err) => {
      // e.g. ENOENT — the python executable was not found.
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new PythonValidationError(`Python validation process error: ${err.message}`, {
          code: err.code ?? null,
          stderr,
          stdout,
        })
      );
    });

    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (stderr.trim()) {
        logger.debug("[pythonValidation.service] runner.py stderr", { stderr: stderr.trim() });
      }

      if (timedOut) {
        reject(
          new PythonValidationError(`Python validation timed out after ${timeoutMs}ms`, {
            code: "TIMEOUT",
            stderr,
            stdout,
          })
        );
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch (err) {
        reject(
          new PythonValidationError(
            `Python validation returned invalid JSON (exit ${exitCode}${
              signal ? `, signal ${signal}` : ""
            }): ${err.message}`,
            { code: exitCode, stderr, stdout: stdout.slice(0, 2000) }
          )
        );
        return;
      }

      // runner.py exits 1 for a *handled* validation failure but still
      // prints a valid {"status":"error",...} document — treat that as a
      // resolved (non-crashing) result, not a transport failure.
      if (exitCode !== 0 && parsed?.status !== "error") {
        reject(
          new PythonValidationError(
            `Python validation process exited with code ${exitCode}${
              signal ? ` (signal ${signal})` : ""
            }`,
            { code: exitCode, stderr, stdout }
          )
        );
        return;
      }

      resolve({
        status: parsed.status ?? "error",
        findings: Array.isArray(parsed.findings) ? parsed.findings : [],
        metrics: parsed.metrics && typeof parsed.metrics === "object" ? parsed.metrics : {},
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
        errors: Array.isArray(parsed.errors) ? parsed.errors : [],
      });
    });

    child.stdin.write(payload);
    child.stdin.end();
  });
}
