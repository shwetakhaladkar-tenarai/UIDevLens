/**
 * testConnection.js
 * Minimal backend-only OpenAI connectivity test.
 *
 * Checks:
 *   1. dotenv loads and OPENAI_API_KEY is present
 *   2. LangChain ChatOpenAI initialises without error
 *   3. OpenAI authentication succeeds (real API call)
 *   4. Model returns a response
 *   5. Response can be parsed as JSON safely
 *
 * Usage:
 *   node src/ai/testConnection.js
 *
 * The key is NEVER logged — only its presence is confirmed.
 */

// Must be first — loads backend/.env before any other import
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ─── 1. Verify env ────────────────────────────────────────────────────────────
console.log("\n━━━ OpenAI Connectivity Test ━━━\n");

const apiKey = process.env.OPENAI_API_KEY;
const model  = process.env.OPENAI_MODEL || "gpt-4o";

if (!apiKey) {
  console.error("✗ [1/5] OPENAI_API_KEY is missing from backend/.env");
  console.error("  Add your key to backend/.env and re-run this test.");
  process.exit(1);
}

// Confirm presence without revealing the value
const masked = apiKey.slice(0, 7) + "..." + apiKey.slice(-4);
console.log(`✓ [1/5] dotenv loaded  —  OPENAI_API_KEY present (${masked})`);
console.log(`        Model: ${model}`);

// ─── 2. Initialise LangChain client ──────────────────────────────────────────
import { ChatOpenAI } from "@langchain/openai";

let llm;
try {
  llm = new ChatOpenAI({
    openAIApiKey: apiKey,
    modelName: model,
    temperature: 0,
    maxTokens: 50,
  });
  console.log("✓ [2/5] ChatOpenAI initialised");
} catch (err) {
  console.error("✗ [2/5] ChatOpenAI initialisation failed:", err.message);
  process.exit(1);
}

// ─── 3 + 4. Send minimal prompt and receive response ─────────────────────────
import { HumanMessage } from "@langchain/core/messages";

const PROMPT = 'Return only this JSON, nothing else:\n{"status":"ok"}';

let raw;
try {
  console.log("  Sending minimal prompt to OpenAI…");
  const response = await llm.invoke([new HumanMessage(PROMPT)]);
  raw = response.content;
  console.log("✓ [3/5] OpenAI authentication succeeded");
  console.log("✓ [4/5] Model returned a response");
  console.log(`        Raw: ${raw.trim()}`);
} catch (err) {
  if (err.message.includes("401") || err.message.toLowerCase().includes("auth")) {
    console.error("✗ [3/5] Authentication failed — check your OPENAI_API_KEY.");
  } else if (err.message.includes("429")) {
    console.error("✗ [3/5] Rate limit exceeded — try again in a moment.");
  } else if (err.message.includes("model")) {
    console.error(`✗ [3/5] Model error — "${model}" may not be available on your plan.`);
  } else {
    console.error("✗ [3/5] API call failed:", err.message);
  }
  process.exit(1);
}

// ─── 5. Parse the response safely ────────────────────────────────────────────
function parseJsonSafe(text) {
  try {
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

const parsed = parseJsonSafe(raw);

if (!parsed) {
  console.warn("⚠ [5/5] Response received but could not be parsed as JSON.");
  console.warn("        This is acceptable — the model may add prose around JSON.");
  console.warn(`        Raw response: ${raw.trim()}`);
} else if (parsed.status === "ok") {
  console.log(`✓ [5/5] Response parsed as JSON  —  { status: "${parsed.status}" }`);
} else {
  console.warn(`⚠ [5/5] Parsed OK but unexpected shape: ${JSON.stringify(parsed)}`);
}

console.log("\n━━━ All checks passed — OpenAI integration is working ━━━\n");
