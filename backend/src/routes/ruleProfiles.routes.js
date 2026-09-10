import { Router } from "express";
import { z } from "zod";
import {
  listRuleProfiles,
  updateRuleProfile,
  RuleProfileError,
} from "../profiling/ruleProfile.service.js";
import { logger } from "../utils/logger.js";

const router = Router();

const ENABLED_CHECK_KEYS = ["functional", "accessibility", "responsive", "crossBrowser", "performance", "uiConsistency"];
const ALLOWED_BROWSERS = ["chromium", "firefox", "webkit"];
const ALLOWED_WCAG_LEVELS = ["A", "AA", "AAA"];

// Deliberately narrow — see updateRuleProfile()'s docstring for why
// id/targetType/viewports/performance.loadTest are never accepted here.
const UpdateRuleProfileSchema = z
  .object({
    enabledChecks: z.object(Object.fromEntries(ENABLED_CHECK_KEYS.map((k) => [k, z.boolean().optional()]))).optional(),
    browsers: z.array(z.enum(ALLOWED_BROWSERS)).min(1, "At least one browser must stay enabled.").optional(),
    accessibility: z.object({ level: z.enum(ALLOWED_WCAG_LEVELS) }).optional(),
  })
  .refine((data) => data.enabledChecks || data.browsers || data.accessibility, { message: "Nothing to update." });

/**
 * GET /api/rule-profiles
 * Real profiles from rule-profiles/*.json — the same config that drives
 * validationPlannerNode. Read-only listing; PATCH below is the write path.
 */
router.get("/rule-profiles", (_req, res) => {
  try {
    const profiles = listRuleProfiles();
    res.json({ success: true, data: profiles });
  } catch (err) {
    logger.error("[ruleProfiles.routes] Failed to list rule profiles", err);
    res.status(500).json({ success: false, error: "Failed to load rule profiles." });
  }
});

/**
 * PATCH /api/rule-profiles/:filename
 * Edits a profile FILE on disk (rule-profiles/<filename>.json) — the next
 * analysis run reads it fresh (updateRuleProfile() clears the in-process
 * cache), so a saved change here genuinely changes what future runs do.
 */
router.patch("/rule-profiles/:filename", (req, res) => {
  const { filename } = req.params;
  const known = listRuleProfiles().map((p) => p.filename);
  if (!known.includes(filename)) {
    return res.status(404).json({ success: false, error: `Unknown rule profile file "${filename}".` });
  }

  const parsed = UpdateRuleProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." });
  }

  try {
    const updated = updateRuleProfile(filename, parsed.data);
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err instanceof RuleProfileError) {
      return res.status(400).json({ success: false, error: err.message });
    }
    logger.error("[ruleProfiles.routes] Failed to update rule profile", err);
    res.status(500).json({ success: false, error: "Failed to update rule profile." });
  }
});

export default router;
