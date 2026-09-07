# Rule Profiles

Configurable validation profiles selected by the **Rule Profile Selector**
(`backend/src/profiling/ruleProfile.service.js` + `ruleProfileNode`) based on
the `targetType` produced by the Target/Application Profiler
(`backend/src/profiling/applicationProfiler.js`).

No validation behavior is hardcoded in the application — every analyzer
(Python validation engine today; Node analyzers in a later step) reads its
enabled checks, browsers, viewports, and thresholds from the selected
profile.

## Selection

| targetType     | Profile file          |
|----------------|------------------------|
| `standard-web` | `standard-web.json`    |
| `powerbi`      | `powerbi.json`         |
| `tableau`      | `tableau.json`         |
| `databricks`   | `databricks.json`      |
| `unknown` (or anything unrecognized) | `default.json` |

## Schema

```json
{
  "id": "web-ui-v1",
  "targetType": "standard-web",
  "description": "optional, human-readable",

  "enabledChecks": {
    "functional": true,
    "accessibility": true,
    "responsive": true,
    "crossBrowser": true,
    "performance": true,
    "uiConsistency": true
  },

  "browsers": ["chromium", "firefox", "webkit"],

  "viewports": {
    "desktop": { "width": 1440, "height": 900 },
    "tablet":  { "width": 768,  "height": 1024 },
    "mobile":  { "width": 390,  "height": 844 }
  },

  "accessibility": { "standard": "WCAG", "level": "AA" },

  "performance": {
    "enabled": true,
    "loadTest": {
      "enabled": false,
      "approved": false,
      "users": [10, 100, 500, 1000],
      "durationSeconds": 60,
      "thresholds": { "p95ResponseTimeMs": 2000, "errorRatePercent": 1 }
    }
  }
}
```

`ruleProfile.service.js` validates every field on load (missing/invalid
fields raise `RuleProfileError`) and rejects any `targetType` that isn't one
of the values `applicationProfiler.js` can produce
(`SUPPORTED_TARGET_TYPES`), so the two stay in sync by construction.
`performance.loadTest` is optional and not schema-validated (it defaults to
disabled) — see `python-validation/README.md`'s Load benchmarking section
for the full safety policy. **Every shipped profile keeps both `enabled`
and `approved` `false`** — concurrent load testing against a target is only
ever run if someone deliberately edits a profile to opt in.

`enabledChecks` keys map to the Python validation engine's check groups as:

| Profile key      | Python check group |
|-------------------|---------------------|
| `functional`      | `functional`        |
| `accessibility`   | `accessibility`     |
| `responsive`      | `responsive`        |
| `crossBrowser`    | `cross_browser`      |
| `performance`     | `performance`        |
| `uiConsistency`   | `design`             |

## Adding a new target type

1. Add the type to `SUPPORTED_TARGET_TYPES` in `applicationProfiler.js` and teach it to recognize the platform.
2. Add `<target-type>.json` here, and a row to `PROFILE_FILE_BY_TARGET_TYPE` in `ruleProfile.service.js`.
