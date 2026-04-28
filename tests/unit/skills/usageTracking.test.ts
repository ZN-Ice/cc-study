/**
 * Tests for skill usage tracking.
 */

import { describe, test, expect, beforeEach } from "vitest";
import {
  recordSkillUsage,
  getSkillUsageScore,
  sortByUsage,
  clearUsageData,
} from "../../../src/skills/usageTracking.js";

describe("Skill Usage Tracking", () => {
  beforeEach(() => {
    clearUsageData();
  });

  test("records usage and returns score > 0", () => {
    recordSkillUsage("review");
    expect(getSkillUsageScore("review")).toBeGreaterThan(0);
  });

  test("returns 0 for unused skills", () => {
    expect(getSkillUsageScore("unknown")).toBe(0);
  });

  test("increments usage count", () => {
    recordSkillUsage("review");
    recordSkillUsage("review");
    recordSkillUsage("review");

    const score = getSkillUsageScore("review");
    recordSkillUsage("simplify");
    const simplifyScore = getSkillUsageScore("simplify");

    // 3 uses should have higher score than 1 use
    expect(score).toBeGreaterThan(simplifyScore);
  });

  test("sortByUsage orders by score descending", () => {
    recordSkillUsage("rare");
    recordSkillUsage("popular");
    recordSkillUsage("popular");
    recordSkillUsage("popular");

    const sorted = sortByUsage(["rare", "popular", "unused"]);
    expect(sorted[0]).toBe("popular");
    expect(sorted[1]).toBe("rare");
    expect(sorted[2]).toBe("unused");
  });

  test("clearUsageData resets all scores", () => {
    recordSkillUsage("test");
    expect(getSkillUsageScore("test")).toBeGreaterThan(0);

    clearUsageData();
    expect(getSkillUsageScore("test")).toBe(0);
  });
});
