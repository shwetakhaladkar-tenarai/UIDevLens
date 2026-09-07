import { collectBrowserEvidence } from "../../tools/browserCollector.js";
import { logger } from "../../utils/logger.js";

/**
 * Node 2 — browserCollectorNode
 * Collects DOM/meta/network/viewport evidence via Playwright.
 * A hard failure here is FATAL (analyzers have nothing to work with), so the
 * graph routes straight to the report builder with a warning.
 */
export async function browserCollectorNode(state) {
  if (state.fatal) {
    logger.warn("[browserCollectorNode] Skipping — prior fatal error");
    return {};
  }

  logger.info("[browserCollectorNode] Collecting browser evidence", { url: state.url });

  try {
    const evidence = await collectBrowserEvidence(state.url);

    // Guard: if the page never responded (no status), treat as fatal.
    const status = evidence?.httpResponse?.statusCode;
    if (!evidence || (status == null && evidence?.httpResponse?.navError)) {
      logger.error("[browserCollectorNode] No usable evidence", {
        navError: evidence?.httpResponse?.navError,
      });
      return {
        browserEvidence: evidence ?? {},
        fatal: true,
        errors: [{
          node: "browserCollectorNode",
          message: `Page could not be loaded: ${evidence?.httpResponse?.navError ?? "no response"}`,
          fatal: true,
        }],
      };
    }

    logger.info("[browserCollectorNode] Evidence collected", { status });
    return { browserEvidence: evidence };
  } catch (err) {
    logger.error("[browserCollectorNode] Failed", { error: err.message });
    return {
      browserEvidence: {},
      fatal: true,
      errors: [{ node: "browserCollectorNode", message: err.message, fatal: true }],
    };
  }
}
