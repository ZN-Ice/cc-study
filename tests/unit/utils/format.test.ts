/**
 * Format utility unit tests.
 *
 * Covers: formatDuration, formatNumber, formatCost.
 */

import { describe, test, expect } from "vitest";
import { formatDuration, formatNumber, formatCost } from "../../../src/utils/format.js";

// ──────────────────────────────────────────────
// formatDuration
// ──────────────────────────────────────────────

describe("formatDuration", () => {
  test("formats 0ms as '0s'", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  test("formats 1ms as '0.001s'", () => {
    expect(formatDuration(1)).toBe("0.001s");
  });

  test("formats 500ms as '0.5s'", () => {
    expect(formatDuration(500)).toBe("0.5s");
  });

  test("formats 1000ms as '1s'", () => {
    expect(formatDuration(1000)).toBe("1s");
  });

  test("formats 1500ms as '1.5s'", () => {
    expect(formatDuration(1500)).toBe("1.5s");
  });

  test("formats 59999ms as '59.999s'", () => {
    expect(formatDuration(59999)).toBe("59.999s");
  });

  test("formats 60000ms as '1m 0s'", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
  });

  test("formats 65000ms as '1m 5s'", () => {
    expect(formatDuration(65000)).toBe("1m 5s");
  });

  test("formats 3600000ms as '1h 0m'", () => {
    expect(formatDuration(3600000)).toBe("1h 0m");
  });

  test("formats 7200000ms as '2h 0m'", () => {
    expect(formatDuration(7200000)).toBe("2h 0m");
  });

  test("formats 86400000ms as '24h 0m'", () => {
    expect(formatDuration(86400000)).toBe("24h 0m");
  });

  test("throws on negative input", () => {
    expect(() => formatDuration(-1)).toThrow();
  });
});

// ──────────────────────────────────────────────
// formatNumber
// ──────────────────────────────────────────────

describe("formatNumber", () => {
  test("formats 0 as '0'", () => {
    expect(formatNumber(0)).toBe("0");
  });

  test("formats 123 as '123'", () => {
    expect(formatNumber(123)).toBe("123");
  });

  test("formats 1234 as '1,234'", () => {
    expect(formatNumber(1234)).toBe("1,234");
  });

  test("formats 1000000 as '1,000,000'", () => {
    expect(formatNumber(1000000)).toBe("1,000,000");
  });

  test("formats 10000000 as '10,000,000'", () => {
    expect(formatNumber(10000000)).toBe("10,000,000");
  });
});

// ──────────────────────────────────────────────
// formatCost
// ──────────────────────────────────────────────

describe("formatCost", () => {
  test("formats 0 cents as '$0.00'", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  test("formats 1 cent as '$0.01'", () => {
    expect(formatCost(1)).toBe("$0.01");
  });

  test("formats 50 cents as '$0.50'", () => {
    expect(formatCost(50)).toBe("$0.50");
  });

  test("formats 150 cents as '$1.50'", () => {
    expect(formatCost(150)).toBe("$1.50");
  });

  test("formats 12345 cents as '$123.45'", () => {
    expect(formatCost(12345)).toBe("$123.45");
  });

  test("formats 5 cents as '$0.05'", () => {
    expect(formatCost(5)).toBe("$0.05");
  });

  test("throws on negative input", () => {
    expect(() => formatCost(-1)).toThrow();
  });
});
