/**
 * Session-level cost and token tracking.
 *
 * Module-level singleton pattern — all state is accumulated across
 * a session and reset by calling reset() (primarily for tests).
 *
 * Simplified for cc-study: no per-model breakdown, no session persistence,
 * approximate pricing ($3/M input, $15/M output).
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface CostEntry {
  tokens: TokenUsage;
  costCents: number;
  durationMs: number;
  model: string;
  timestamp: number;
}

// ──────────────────────────────────────────────
// Module-level state
// ──────────────────────────────────────────────

let totalCostCents = 0;
let totalDurationMs = 0;
let totalAPIDurationMs = 0;
let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalCacheCreationInputTokens = 0;
let totalCacheReadInputTokens = 0;
const entries: CostEntry[] = [];

// ──────────────────────────────────────────────
// Write
// ──────────────────────────────────────────────

export function addUsage(entry: CostEntry): void {
  totalCostCents += entry.costCents;
  totalDurationMs += entry.durationMs;
  totalInputTokens += entry.tokens.inputTokens;
  totalOutputTokens += entry.tokens.outputTokens;
  totalCacheCreationInputTokens += entry.tokens.cacheCreationInputTokens ?? 0;
  totalCacheReadInputTokens += entry.tokens.cacheReadInputTokens ?? 0;
  entries.push(entry);
}

export function addAPIDuration(durationMs: number): void {
  totalAPIDurationMs += durationMs;
}

// ──────────────────────────────────────────────
// Read
// ──────────────────────────────────────────────

export function getTotalCost(): number {
  return totalCostCents;
}

export function getTotalTokens(): TokenUsage {
  return {
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    cacheCreationInputTokens: totalCacheCreationInputTokens || undefined,
    cacheReadInputTokens: totalCacheReadInputTokens || undefined,
  };
}

export function getSessionDuration(): number {
  return totalDurationMs;
}

export function getTotalAPIDuration(): number {
  return totalAPIDurationMs;
}

export function getCostEntries(): readonly CostEntry[] {
  return entries;
}

// ──────────────────────────────────────────────
// Compute cost from usage
// ──────────────────────────────────────────────

const COST_PER_1K_INPUT_TOKENS = 0.3; // cents ($3/M)
const COST_PER_1K_OUTPUT_TOKENS = 1.5; // cents ($15/M)
const COST_PER_1K_CACHE_WRITE = 0.375; // cents ($3.75/M)
const COST_PER_1K_CACHE_READ = 0.03; // cents ($0.30/M)

export function computeCost(usage: TokenUsage): number {
  let cost = 0;
  cost += (usage.inputTokens / 1000) * COST_PER_1K_INPUT_TOKENS;
  cost += (usage.outputTokens / 1000) * COST_PER_1K_OUTPUT_TOKENS;
  cost += ((usage.cacheCreationInputTokens ?? 0) / 1000) * COST_PER_1K_CACHE_WRITE;
  cost += ((usage.cacheReadInputTokens ?? 0) / 1000) * COST_PER_1K_CACHE_READ;
  return Math.round(cost * 100) / 100; // round to 2 decimals
}

// ──────────────────────────────────────────────
// Reset (for tests)
// ──────────────────────────────────────────────

export function reset(): void {
  totalCostCents = 0;
  totalDurationMs = 0;
  totalAPIDurationMs = 0;
  totalInputTokens = 0;
  totalOutputTokens = 0;
  totalCacheCreationInputTokens = 0;
  totalCacheReadInputTokens = 0;
  entries.length = 0;
}
