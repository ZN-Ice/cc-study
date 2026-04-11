import { describe, test, expect } from "vitest";
import { twoPressReducer } from "../../src/utils/twoPressExit.js";
import type { TwoPressExitState } from "../../src/utils/twoPressExit.js";

describe("twoPressReducer", () => {
  const idle: TwoPressExitState = { waitingForSecondPress: false };
  const waiting: TwoPressExitState = { waitingForSecondPress: true };

  describe("from IDLE state", () => {
    test("press → show hint, do NOT exit", () => {
      const result = twoPressReducer(idle, "press");
      expect(result.shouldExit).toBe(false);
      expect(result.shouldShowHint).toBe(true);
      expect(result.state.waitingForSecondPress).toBe(true);
    });

    test("timeout → stays idle, no hint", () => {
      const result = twoPressReducer(idle, "timeout");
      expect(result.shouldExit).toBe(false);
      expect(result.shouldShowHint).toBe(false);
      expect(result.state.waitingForSecondPress).toBe(false);
    });
  });

  describe("from WAITING state", () => {
    test("press → exit, no hint", () => {
      const result = twoPressReducer(waiting, "press");
      expect(result.shouldExit).toBe(true);
      expect(result.shouldShowHint).toBe(false);
      expect(result.state.waitingForSecondPress).toBe(false);
    });

    test("timeout → dismiss hint, no exit", () => {
      const result = twoPressReducer(waiting, "timeout");
      expect(result.shouldExit).toBe(false);
      expect(result.shouldShowHint).toBe(false);
      expect(result.state.waitingForSecondPress).toBe(false);
    });
  });

  describe("full two-press flow", () => {
    test("press → press → exit", () => {
      const step1 = twoPressReducer(idle, "press");
      expect(step1.shouldShowHint).toBe(true);

      const step2 = twoPressReducer(step1.state, "press");
      expect(step2.shouldExit).toBe(true);
    });

    test("press → timeout → press → show hint again (not exit)", () => {
      const step1 = twoPressReducer(idle, "press");
      const step2 = twoPressReducer(step1.state, "timeout");
      expect(step2.state.waitingForSecondPress).toBe(false);

      // After timeout, a new press should start over
      const step3 = twoPressReducer(step2.state, "press");
      expect(step3.shouldExit).toBe(false);
      expect(step3.shouldShowHint).toBe(true);
    });

    test("press → timeout → press → press → exit", () => {
      const r1 = twoPressReducer(idle, "press");
      const r2 = twoPressReducer(r1.state, "timeout");
      const r3 = twoPressReducer(r2.state, "press");
      const r4 = twoPressReducer(r3.state, "press");
      expect(r4.shouldExit).toBe(true);
    });
  });
});
