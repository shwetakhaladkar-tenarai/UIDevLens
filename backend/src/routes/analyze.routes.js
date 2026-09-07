import { Router } from "express";
import { analyzeController } from "../controllers/analyze.controller.js";

const router = Router();

/**
 * POST /api/analyze
 * Body: { url: string, userConfig?: { checks?: object, browsers?: string[], viewports?: string[] } }
 * userConfig can only narrow what the selected rule profile already permits
 * (see validationPlannerNode.js) — it is never trusted to enable anything.
 */
router.post("/analyze", analyzeController);

export default router;
