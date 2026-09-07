/**
 * model.js
 * Initialises and exports the LangChain ChatOpenAI client.
 *
 * Rules:
 *  - API key is read from process.env at call-time (not at module load).
 *    This means the server can be started before the key is set, and it will
 *    still work once the key is added and the server restarted.
 *  - The key is NEVER logged — only its presence is confirmed.
 *  - getModel() throws a named ConfigurationError with a clear message when
 *    the key is absent so callers get a plain explanation instead of a 401.
 *  - A single ChatOpenAI instance is cached after the first successful call.
 */
import { ChatOpenAI } from "@langchain/openai";
import { config } from "../config/env.js";

let _instance = null;

/**
 * Returns the cached ChatOpenAI singleton.
 * Throws ConfigurationError when OPENAI_API_KEY is not set.
 * @returns {ChatOpenAI}
 */
export function getModel() {
  // Read live from process.env so the value is always current.
  // config.openai.model falls back to the .env default (gpt-4o).
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const err = new Error(
      "OPENAI_API_KEY is not configured. " +
        "Add it to backend/.env and restart the server. " +
        "See .env.example for the required variables."
    );
    err.name = "ConfigurationError";
    throw err;
  }

  // Re-create the singleton if the key changed (e.g. env swap in dev)
  if (!_instance || _instance._apiKey !== apiKey) {
    _instance = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: config.openai.model,
      temperature: 0.2,        // low temp for consistent, grounded reasoning
      maxTokens: 2500,         // room for a full prioritized report
      // Ask OpenAI for a JSON object response. Supported by gpt-4o / gpt-4-turbo
      // and newer. If the configured model does not support it, getModel still
      // works — the node also strips fences / coerces, and validates output.
      modelKwargs: { response_format: { type: "json_object" } },
    });
    // Store a reference so we can detect key changes
    _instance._apiKey = apiKey;
  }

  return _instance;
}

/**
 * Returns true when OPENAI_API_KEY is present in the environment.
 * Does NOT validate the key against the OpenAI API.
 * @returns {boolean}
 */
export function isModelConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Resets the cached singleton.
 * Used by testConnection.js and any future unit tests.
 */
export function _resetModelInstance() {
  _instance = null;
}
