/**
 * ruleProfile.service.js
 * Rule Profile Selector — loads, validates, and selects the configurable
 * validation profile (rule-profiles/*.json) matching a target's classified
 * type. No validation behavior is hardcoded elsewhere in the application:
 * every validator reads its enabled checks, browsers, viewports, and
 * thresholds from the profile this service returns.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../config/env.js";
import { SUPPORTED_TARGET_TYPES } from "./applicationProfiler.js";

export class RuleProfileError extends Error {
  constructor(message) {
    super(message);
    this.name = "RuleProfileError";
  }
}

// targetType -> rule-profiles/<file>.json. Anything not listed here (or not
// classified at all) falls back to "unknown" -> default.json.
const PROFILE_FILE_BY_TARGET_TYPE = {
  "standard-web": "standard-web.json",
  powerbi: "powerbi.json",
  tableau: "tableau.json",
  databricks: "databricks.json",
  unknown: "default.json",
};

// enabledChecks key -> Python validation engine check-group name.
const PYTHON_CHECK_BY_ENABLED_KEY = {
  functional: "functional",
  accessibility: "accessibility",
  responsive: "responsive",
  crossBrowser: "cross_browser",
  performance: "performance",
  uiConsistency: "design",
};

const REQUIRED_ENABLED_CHECK_KEYS = Object.keys(PYTHON_CHECK_BY_ENABLED_KEY);
const REQUIRED_VIEWPORTS = ["desktop", "tablet", "mobile"];

// Profiles are static config files — load and validate each one once per
// process, not on every request.
let profileCache = null;

function loadProfileFile(filename) {
  const filePath = path.join(config.ruleProfiles.dir, filename);
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new RuleProfileError(`Could not read rule profile file "${filePath}": ${err.message}`);
  }

  let profile;
  try {
    profile = JSON.parse(raw);
  } catch (err) {
    throw new RuleProfileError(`Rule profile file "${filename}" is not valid JSON: ${err.message}`);
  }

  validateProfile(profile, filename);
  return profile;
}

/**
 * Validate a rule profile's shape. Throws RuleProfileError listing every
 * problem found (not just the first) so a broken profile file is easy to fix.
 */
function validateProfile(profile, sourceLabel) {
  const errors = [];

  if (!profile || typeof profile !== "object") {
    throw new RuleProfileError(`Rule profile "${sourceLabel}" must be a JSON object`);
  }

  if (typeof profile.id !== "string" || !profile.id.trim()) {
    errors.push('missing/invalid "id" (must be a non-empty string)');
  }

  if (!SUPPORTED_TARGET_TYPES.includes(profile.targetType)) {
    errors.push(
      `"targetType" must be one of [${SUPPORTED_TARGET_TYPES.join(", ")}] (got ${JSON.stringify(profile.targetType)})`
    );
  }

  if (!profile.enabledChecks || typeof profile.enabledChecks !== "object") {
    errors.push('missing "enabledChecks" object');
  } else {
    for (const key of REQUIRED_ENABLED_CHECK_KEYS) {
      if (typeof profile.enabledChecks[key] !== "boolean") {
        errors.push(`"enabledChecks.${key}" must be a boolean`);
      }
    }
  }

  if (!Array.isArray(profile.browsers) || profile.browsers.length === 0) {
    errors.push('"browsers" must be a non-empty array');
  }

  if (!profile.viewports || typeof profile.viewports !== "object") {
    errors.push('missing "viewports" object');
  } else {
    for (const vp of REQUIRED_VIEWPORTS) {
      const dims = profile.viewports[vp];
      if (!dims || typeof dims.width !== "number" || typeof dims.height !== "number") {
        errors.push(`"viewports.${vp}" must have numeric width/height`);
      }
    }
  }

  if (
    !profile.accessibility ||
    typeof profile.accessibility.standard !== "string" ||
    typeof profile.accessibility.level !== "string"
  ) {
    errors.push('missing/invalid "accessibility" (requires string "standard" and "level")');
  }

  if (!profile.performance || typeof profile.performance.enabled !== "boolean") {
    errors.push('missing/invalid "performance.enabled" (must be a boolean)');
  }

  if (errors.length) {
    throw new RuleProfileError(`Invalid rule profile "${sourceLabel}": ${errors.join("; ")}`);
  }
}

/**
 * Load + validate every known profile file independently, so one broken
 * file (bad JSON, missing field) can never prevent the OTHERS — most
 * importantly default.json — from loading. Each entry is either
 * { profile } or { error }. Only memoized permanently once every file has
 * loaded cleanly; otherwise the next call retries (a file may get fixed on
 * disk between requests).
 */
function loadAllProfiles() {
  if (profileCache) return profileCache;

  const cache = new Map();
  let allOk = true;
  for (const filename of new Set(Object.values(PROFILE_FILE_BY_TARGET_TYPE))) {
    try {
      cache.set(filename, { profile: loadProfileFile(filename) });
    } catch (err) {
      cache.set(filename, { error: err });
      allOk = false;
    }
  }

  if (allOk) profileCache = cache;
  return cache;
}

/**
 * Select and validate the rule profile matching a target type. Falls back
 * to default.json for "unknown" or any type without a dedicated profile.
 *
 * @param {string} targetType
 * @returns {object} the validated profile
 */
export function selectRuleProfile(targetType) {
  const profiles = loadAllProfiles();
  const filename = PROFILE_FILE_BY_TARGET_TYPE[targetType] || PROFILE_FILE_BY_TARGET_TYPE.unknown;
  const entry = profiles.get(filename);
  if (!entry) {
    throw new RuleProfileError(`No rule profile file mapped for target type "${targetType}" (expected ${filename})`);
  }
  if (entry.error) throw entry.error;
  return entry.profile;
}

/**
 * Map a profile's enabledChecks into the check-name vocabulary the Python
 * validation engine expects (runner.py's CHECK_VALIDATORS keys).
 *
 * @param {object} profile
 * @returns {string[]} enabled check names, e.g. ["functional","accessibility"]
 */
export function checksForPythonEngine(profile) {
  const enabledChecks = profile?.enabledChecks || {};
  return Object.entries(PYTHON_CHECK_BY_ENABLED_KEY)
    .filter(([key]) => enabledChecks[key] === true)
    .map(([, pythonCheck]) => pythonCheck);
}
