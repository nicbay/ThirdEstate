// Shared Claude client for every sync job, with a hard monthly spending cap.
//
// - Model: Claude Haiku 5.5 only (owner's choice).
// - Cap: CAP_USD per calendar month across ALL jobs (owner set €15; $15 is used because it is
//   stricter than €15 at any recent exchange rate). Spend is recorded in data/usage/claude-<YYYY-MM>.json,
//   which the GitHub jobs commit, so the cap holds across runs.
// - A call is refused BEFORE it is sent if its worst-case cost would cross the cap.
// - The API key comes from the ANTHROPIC_API_KEY environment variable (a GitHub secret);
//   it is never written to the repository.
//
// This is a backstop. The real hard limit should also be set in the Claude Console
// (a dedicated workspace with a monthly spend limit).
//
// Usage:
//   import { ask, remainingBudget } from "./lib/claude.mjs";
//   const res = await ask({ system, messages, max_tokens: 1024, output_config: { effort: "low" } }, "feed");

import Anthropic from "@anthropic-ai/sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export const MODEL = "claude-haiku-5-5";
export const CAP_USD = 15;
// Haiku 5.5 list prices per million tokens (prompts up to 100K tokens; we never send more).
const PRICE = { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 };
// Server-side web search: $10 per 1,000 searches, on top of tokens (search results are billed as input tokens).
const WEB_SEARCH_USD = 0.01;
// worst-case input tokens one search can add to the context (results are fed back to the model)
const SEARCH_RESULT_TOKENS = 25000;

const USAGE_DIR = new URL("../../data/usage/", import.meta.url);
const month = () => new Date().toISOString().slice(0, 7);
const ledgerUrl = () => new URL(`claude-${month()}.json`, USAGE_DIR);

async function readLedger() {
  try {
    return JSON.parse(await readFile(ledgerUrl(), "utf8"));
  } catch {
    return { month: month(), capUsd: CAP_USD, spentUsd: 0, calls: 0, byJob: {} };
  }
}
async function writeLedger(l) {
  await mkdir(USAGE_DIR, { recursive: true });
  await writeFile(ledgerUrl(), JSON.stringify(l, null, 2) + "\n");
}

export class BudgetExceededError extends Error {}

export async function remainingBudget() {
  const l = await readLedger();
  return Math.max(0, CAP_USD - l.spentUsd);
}

const costOf = (u) =>
  ((u.input_tokens ?? 0) * PRICE.input +
    (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
    (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
    (u.output_tokens ?? 0) * PRICE.output) /
    1e6 +
  (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD;

let client;
/**
 * One Messages API call on Haiku 5.5, refused if it could push the month over the cap.
 * `params` is a normal messages.create body without `model`. `job` labels the spend in the ledger.
 */
export async function ask(params, job) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  // Haiku 5.5 thinks by default (adaptive, effort "medium") and its thinking counts against max_tokens: with a
  // few hundred tokens it could think them all away and return no text at all ("Unexpected end of JSON input").
  // Our jobs are short rewrites, so default to low effort, and leave room for the thinking on top of the answer.
  params = { ...params, max_tokens: Math.max(params.max_tokens ?? 1024, 4000), output_config: { effort: "low", ...params.output_config } };
  client ??= new Anthropic();
  const ledger = await readLedger();
  // worst case: count input generously (~3 chars per token) and assume max_tokens are all used
  const approxInput = JSON.stringify([params.system ?? "", params.messages, params.tools ?? []]).length / 3;
  const searches = (params.tools ?? []).filter((t) => t.type?.startsWith("web_search")).reduce((n, t) => n + (t.max_uses ?? 5), 0);
  const worst =
    ((approxInput + searches * SEARCH_RESULT_TOKENS) * PRICE.input + (params.max_tokens ?? 1024) * PRICE.output) / 1e6 + searches * WEB_SEARCH_USD;
  if (ledger.spentUsd + worst > CAP_USD) {
    throw new BudgetExceededError(`Monthly Claude budget reached: $${ledger.spentUsd.toFixed(2)} of $${CAP_USD} spent in ${ledger.month}`);
  }
  const res = await client.messages.create({ ...params, model: MODEL });
  const cost = costOf(res.usage);
  ledger.spentUsd = Math.round((ledger.spentUsd + cost) * 1e6) / 1e6;
  ledger.calls += 1;
  ledger.byJob[job] = Math.round(((ledger.byJob[job] ?? 0) + cost) * 1e6) / 1e6;
  ledger.updatedAt = new Date().toISOString();
  await writeLedger(ledger);
  return res;
}
