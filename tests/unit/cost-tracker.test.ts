/**
 * Cost tracker unit tests.
 *
 * Covers: addUsage, getters, reset, getCostEntries, computeCost, edge cases.
 */

import { describe, test, expect, beforeEach } from "vitest";
import {
  addUsage,
  addAPIDuration,
  getTotalCost,
  getTotalTokens,
  getSessionDuration,
  getTotalAPIDuration,
  getCostEntries,
  computeCost,
  reset,
} from "../../src/cost-tracker.js";
import type { CostEntry } from "../../src/cost-tracker.js";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Build a minimal CostEntry with sensible defaults. */
function makeEntry(overrides: Partial<CostEntry> = {}): CostEntry {
  return {
    tokens: { inputTokens: 0, outputTokens: 0 },
    costCents: 0,
    durationMs: 0,
    model: "test-model",
    timestamp: Date.now(),
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

beforeEach(() => reset());

// ── addUsage & getters ─────────────────────────

describe("addUsage & getters", () => {
  test("accumulates single entry correctly", () => {
    addUsage(
      makeEntry({
        tokens: { inputTokens: 100, outputTokens: 50 },
        costCents: 10,
        durationMs: 2000,
      }),
    );

    expect(getTotalCost()).toBe(10);
    expect(getTotalTokens()).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationInputTokens: undefined,
      cacheReadInputTokens: undefined,
    });
    expect(getSessionDuration()).toBe(2000);
  });

  test("accumulates multiple entries correctly", () => {
    addUsage(
      makeEntry({
        tokens: { inputTokens: 100, outputTokens: 50 },
        costCents: 10,
        durationMs: 2000,
      }),
    );
    addUsage(
      makeEntry({
        tokens: { inputTokens: 200, outputTokens: 100 },
        costCents: 25,
        durationMs: 3000,
      }),
    );

    expect(getTotalCost()).toBe(35);
    expect(getTotalTokens()).toEqual({
      inputTokens: 300,
      outputTokens: 150,
      cacheCreationInputTokens: undefined,
      cacheReadInputTokens: undefined,
    });
    expect(getSessionDuration()).toBe(5000);
  });

  test("tracks API duration separately", () => {
    addUsage(makeEntry({ durationMs: 5000 }));
    // API duration tracked via addAPIDuration, not addUsage
    addAPIDuration(3000);

    expect(getSessionDuration()).toBe(5000);
    expect(getTotalAPIDuration()).toBe(3000);
  });

  test("handles cache tokens", () => {
    addUsage(
      makeEntry({
        tokens: {
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationInputTokens: 200,
          cacheReadInputTokens: 300,
        },
      }),
    );

    const tokens = getTotalTokens();
    expect(tokens.inputTokens).toBe(100);
    expect(tokens.outputTokens).toBe(50);
    expect(tokens.cacheCreationInputTokens).toBe(200);
    expect(tokens.cacheReadInputTokens).toBe(300);
  });
});

// ── reset ──────────────────────────────────────

describe("reset", () => {
  test("resets all state to zero/empty", () => {
    addUsage(
      makeEntry({
        tokens: { inputTokens: 100, outputTokens: 50 },
        costCents: 10,
        durationMs: 2000,
      }),
    );

    reset();

    expect(getTotalCost()).toBe(0);
    expect(getTotalTokens()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: undefined,
      cacheReadInputTokens: undefined,
    });
    expect(getSessionDuration()).toBe(0);
    expect(getTotalAPIDuration()).toBe(0);
    expect(getCostEntries()).toEqual([]);
  });
});

// ── getCostEntries ─────────────────────────────

describe("getCostEntries", () => {
  test("returns entries in insertion order", () => {
    const entry1 = makeEntry({
      tokens: { inputTokens: 10 },
      costCents: 1,
      model: "model-a",
    });
    const entry2 = makeEntry({
      tokens: { inputTokens: 20 },
      costCents: 2,
      model: "model-b",
    });

    addUsage(entry1);
    addUsage(entry2);

    const entries = getCostEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual(entry1);
    expect(entries[1]).toEqual(entry2);
  });

  test("returns empty array initially", () => {
    expect(getCostEntries()).toEqual([]);
  });
});

// ── computeCost ────────────────────────────────

describe("computeCost", () => {
  test("computes cost for input + output tokens", () => {
    // 10000 input: (10000/1000) * 0.3 = 3.0 cents
    // 5000 output: (5000/1000) * 1.5 = 7.5 cents
    // total: 10.5 cents
    const cost = computeCost({ inputTokens: 10_000, outputTokens: 5_000 });
    expect(cost).toBe(10.5);
  });

  test("computes cost with cache tokens", () => {
    // 10000 input:  (10000/1000) * 0.3    = 3.0
    // 5000 output:  (5000/1000)  * 1.5    = 7.5
    // 2000 cache w: (2000/1000)  * 0.375  = 0.75
    // 1000 cache r: (1000/1000)  * 0.03   = 0.03
    // total: 11.28
    const cost = computeCost({
      inputTokens: 10_000,
      outputTokens: 5_000,
      cacheCreationInputTokens: 2_000,
      cacheReadInputTokens: 1_000,
    });
    expect(cost).toBe(11.28);
  });

  test("returns 0 for zero tokens", () => {
    const cost = computeCost({ inputTokens: 0, outputTokens: 0 });
    expect(cost).toBe(0);
  });

  test("rounds to 2 decimal places", () => {
    // 123 input:  (123/1000) * 0.3 = 0.0369
    // 456 output: (456/1000) * 1.5 = 0.684
    // raw total: 0.7209 → rounded to 0.72
    const cost = computeCost({ inputTokens: 123, outputTokens: 456 });
    expect(cost).toBe(0.72);
  });
});

// ── edge cases ─────────────────────────────────

describe("edge cases", () => {
  test("handles large token counts without overflow", () => {
    // 10M input:  (10_000_000/1000) * 0.3 = 3000
    // 5M output:  (5_000_000/1000)  * 1.5 = 7500
    // total: 10500
    const cost = computeCost({
      inputTokens: 10_000_000,
      outputTokens: 5_000_000,
    });
    expect(cost).toBe(10_500);
  });
});
