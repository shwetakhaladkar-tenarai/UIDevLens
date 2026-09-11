import React, { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import TopBar from "../layout/TopBar.jsx";
import Card from "../components/ui/Card.jsx";
import Badge from "../components/ui/Badge.jsx";
import Button from "../components/ui/Button.jsx";
import Toggle from "../components/ui/Toggle.jsx";
import Select from "../components/ui/Select.jsx";
import LoadingState from "../components/ui/LoadingState.jsx";
import ErrorState from "../components/ui/ErrorState.jsx";
import { fetchRuleProfiles, updateRuleProfile } from "../services/ruleProfilesApi.js";

const CHECK_LABELS = {
  functional:    { label: "Functional UI Verification", description: "Detect broken links, form inputs, missing states, and console errors" },
  accessibility: { label: "Accessibility / WCAG",        description: "Contrast, alt text/labels, ARIA, keyboard focus" },
  crossBrowser:  { label: "Cross-Browser Rendering",     description: "Test overflow, clipping, and overlap on Chromium, Firefox, and WebKit" },
  responsive:    { label: "Responsive Validation",       description: "Desktop / tablet / mobile viewport checks" },
  performance:   { label: "Frontend Performance",        description: "Core Web Vitals (LCP, CLS, TBT) via Lighthouse" },
  uiConsistency: { label: "UI / Design Consistency",     description: "Colors, typography, spacing, and component rules" },
};

const BROWSER_OPTIONS = [
  { key: "chromium", label: "Chromium" },
  { key: "firefox",  label: "Firefox" },
  { key: "webkit",   label: "WebKit" },
];

const WCAG_LEVEL_OPTIONS = [
  { value: "A",   label: "WCAG A" },
  { value: "AA",  label: "WCAG AA" },
  { value: "AAA", label: "WCAG AAA" },
];

export default function RuleProfiles() {
  const { openMobileNav } = useOutletContext() ?? {};
  const [profiles, setProfiles] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [selectedFile, setSelectedFile] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchRuleProfiles()
      .then((data) => {
        if (cancelled) return;
        setProfiles(data);
        const firstReal = data.find((p) => p.profile);
        if (firstReal) setSelectedFile(firstReal.filename);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  const selected = profiles?.find((p) => p.filename === selectedFile);

  function handleSaved(filename, updatedProfile) {
    setProfiles((prev) => prev.map((p) => (p.filename === filename ? { ...p, profile: updatedProfile } : p)));
  }

  return (
    <>
      <TopBar
        onMenuClick={openMobileNav}
        left={null}
      />

      <main className="w-full space-y-6 px-4 py-6 sm:px-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Validation Rules Configuration</h2>
          <p className="mt-1 text-sm text-gray-500">
            Real profiles from <code className="rounded bg-gray-100 px-1 py-0.5 text-xs text-gray-700">rule-profiles/*.json</code>.
            Edits here write straight to that file and take effect on the next analysis run. Profile name, target type,
            viewports, and load-test approval aren't editable here — those require changing the file directly.
          </p>
        </div>

        {loading && <LoadingState message="Loading rule profiles…" />}
        {error && !loading && <ErrorState message={error} onRetry={() => window.location.reload()} />}

        {!loading && !error && profiles && (
          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            {/* Preset list */}
            <Card className="p-4 h-fit">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">Standard Rules</p>
                <Badge color="blue">{profiles.filter((p) => p.profile).length} Presets</Badge>
              </div>
              <div className="space-y-2">
                {profiles.map((p) => (
                  <button
                    key={p.filename}
                    type="button"
                    disabled={!p.profile}
                    onClick={() => setSelectedFile(p.filename)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
                      selectedFile === p.filename
                        ? "border-brand-400 bg-brand-50"
                        : p.profile
                          ? "border-gray-200 bg-white hover:border-gray-300"
                          : "border-red-200 bg-red-50 cursor-not-allowed"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900">{p.profile?.id ?? p.filename}</p>
                      <Badge color={targetTypeColor(p.targetType)}>{p.targetType}</Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-gray-600">
                      {p.profile?.description ?? p.error ?? "Failed to load"}
                    </p>
                  </button>
                ))}
              </div>
            </Card>

            {/* Editor */}
            <Card className="p-5">
              {!selected?.profile ? (
                <p className="text-sm text-gray-500">Select a profile on the left to view its settings.</p>
              ) : (
                <RuleProfileEditor
                  key={selected.filename}
                  entry={selected}
                  onSaved={(updated) => handleSaved(selected.filename, updated)}
                />
              )}
            </Card>
          </div>
        )}
      </main>
    </>
  );
}

function targetTypeColor(targetType) {
  return { "standard-web": "blue", powerbi: "purple", unknown: "gray" }[targetType] ?? "gray";
}

function RuleProfileEditor({ entry, onSaved }) {
  const { profile, filename } = entry;
  const loadTest = profile.performance?.loadTest;

  const [checks, setChecks] = useState(() => ({ ...profile.enabledChecks }));
  const [browsers, setBrowsers] = useState(() => [...(profile.browsers ?? [])]);
  const [wcagLevel, setWcagLevel] = useState(profile.accessibility?.level ?? "AA");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const dirty = useMemo(() => {
    const checksChanged = Object.keys(CHECK_LABELS).some((k) => Boolean(checks[k]) !== Boolean(profile.enabledChecks?.[k]));
    const browsersChanged =
      browsers.length !== (profile.browsers ?? []).length ||
      browsers.some((b) => !(profile.browsers ?? []).includes(b));
    const levelChanged = wcagLevel !== (profile.accessibility?.level ?? "AA");
    return checksChanged || browsersChanged || levelChanged;
  }, [checks, browsers, wcagLevel, profile]);

  function toggleBrowser(key, on) {
    setBrowsers((prev) => (on ? [...new Set([...prev, key])] : prev.filter((b) => b !== key)));
  }

  function handleDiscard() {
    setChecks({ ...profile.enabledChecks });
    setBrowsers([...(profile.browsers ?? [])]);
    setWcagLevel(profile.accessibility?.level ?? "AA");
    setError("");
    setStatus("");
  }

  async function handleSave() {
    setError("");
    setStatus("");
    if (browsers.length === 0) {
      setError("At least one browser must stay enabled.");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateRuleProfile(filename, {
        enabledChecks: checks,
        browsers,
        accessibility: { level: wcagLevel },
      });
      onSaved(updated);
      setStatus("Saved — takes effect on the next analysis run.");
    } catch (err) {
      setError(err.message || "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-base font-semibold text-gray-900">Viewing: {profile.id}</p>
        <div className="flex items-center gap-2">
          {dirty && <Badge color="amber">Unsaved changes</Badge>}
          {dirty && (
            <Button variant="ghost" size="sm" onClick={handleDiscard} disabled={saving}>
              Discard
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>

      {(error || status) && (
        <p
          role={error ? "alert" : "status"}
          className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
            error ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"
          }`}
        >
          {error || status}
        </p>
      )}

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">01. General &amp; Threshold Parameters</p>
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Field label="Profile Name" value={profile.id} />
        <Field label="Target Application Type" value={profile.targetType} />

        <div>
          <Select
            label="WCAG Compliance Level"
            value={wcagLevel}
            onChange={(e) => setWcagLevel(e.target.value)}
            options={WCAG_LEVEL_OPTIONS}
          />
        </div>

        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Browsers</p>
          <div className="flex flex-wrap gap-3 pt-1">
            {BROWSER_OPTIONS.map((b) => (
              <label key={b.key} className="flex items-center gap-1.5 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={browsers.includes(b.key)}
                  onChange={(e) => toggleBrowser(b.key, e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-2 focus:ring-brand-500/40"
                />
                {b.label}
              </label>
            ))}
          </div>
        </div>

        <Field label="Viewports" value={Object.keys(profile.viewports ?? {}).join(", ") || "—"} />
        <Field
          label="Load Benchmark"
          value={
            loadTest?.enabled && loadTest?.approved
              ? `Approved — p95 ≤ ${loadTest.thresholds?.p95ResponseTimeMs ?? "n/a"}ms, error rate ≤ ${loadTest.thresholds?.errorRatePercent ?? "n/a"}%`
              : "Disabled (requires explicit two-factor approval directly on the profile file)"
          }
        />
      </div>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">02. Rule Matrix</p>
      <div className="space-y-3">
        {Object.entries(CHECK_LABELS).map(([key, meta]) => (
          <div key={key} className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 p-3">
            <div>
              <p className="text-sm font-medium text-gray-900">{meta.label}</p>
              <p className="text-xs text-gray-500">{meta.description}</p>
            </div>
            <Toggle
              checked={checks[key] === true}
              onChange={(next) => setChecks((prev) => ({ ...prev, [key]: next }))}
              label={meta.label}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-gray-900">{value}</p>
    </div>
  );
}
