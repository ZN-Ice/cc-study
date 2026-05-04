/**
 * Tests for src/utils/teammate.ts
 *
 * Covers: setDynamicTeamContext, clearDynamicTeamContext, getDynamicTeamContext,
 * getAgentId, getAgentName, getTeamName, getParentSessionId, getTeammateColor,
 * isTeammate, isTeamLead, isPlanModeRequired.
 * Priority: AsyncLocalStorage > dynamicTeamContext.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  setDynamicTeamContext,
  clearDynamicTeamContext,
  getDynamicTeamContext,
  getAgentId,
  getAgentName,
  getTeamName,
  getParentSessionId,
  getTeammateColor,
  isTeammate,
  isTeamLead,
  isPlanModeRequired,
  runWithTeammateContext,
  createTeammateContext,
} from "../../../src/utils/teammate.js";

// ──────────────────────────────────────────────
// Dynamic Team Context
// ──────────────────────────────────────────────

describe("teammate — dynamicTeamContext", () => {
  beforeEach(() => {
    clearDynamicTeamContext();
  });

  afterEach(() => {
    clearDynamicTeamContext();
  });

  test("initially returns null", () => {
    expect(getDynamicTeamContext()).toBeNull();
  });

  test("setDynamicTeamContext sets context", () => {
    const ctx = {
      agentId: "researcher@team-1",
      agentName: "researcher",
      teamName: "team-1",
      planModeRequired: false,
    };
    setDynamicTeamContext(ctx);
    expect(getDynamicTeamContext()).toEqual(ctx);
  });

  test("clearDynamicTeamContext resets to null", () => {
    setDynamicTeamContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      planModeRequired: false,
    });
    clearDynamicTeamContext();
    expect(getDynamicTeamContext()).toBeNull();
  });

  test("setDynamicTeamContext with null clears context", () => {
    setDynamicTeamContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      planModeRequired: false,
    });
    setDynamicTeamContext(null);
    expect(getDynamicTeamContext()).toBeNull();
  });
});

// ──────────────────────────────────────────────
// getAgentId
// ──────────────────────────────────────────────

describe("getAgentId", () => {
  beforeEach(() => {
    clearDynamicTeamContext();
  });

  afterEach(() => {
    clearDynamicTeamContext();
  });

  test("returns undefined without any context", () => {
    expect(getAgentId()).toBeUndefined();
  });

  test("returns agentId from dynamicTeamContext", () => {
    setDynamicTeamContext({
      agentId: "dev@my-team",
      agentName: "dev",
      teamName: "my-team",
      planModeRequired: false,
    });
    expect(getAgentId()).toBe("dev@my-team");
  });

  test("prefers AsyncLocalStorage over dynamicTeamContext", () => {
    setDynamicTeamContext({
      agentId: "dynamic@team",
      agentName: "dynamic",
      teamName: "team",
      planModeRequired: false,
    });

    const ctx = createTeammateContext({
      agentId: "inprocess@team",
      agentName: "inprocess",
      teamName: "team",
      planModeRequired: false,
      parentSessionId: "sess-1",
      abortController: new AbortController(),
    });

    const result = runWithTeammateContext(ctx, () => getAgentId());
    expect(result).toBe("inprocess@team");
  });

  test("falls back to dynamicTeamContext when no AsyncLocalStorage", () => {
    setDynamicTeamContext({
      agentId: "fallback@team",
      agentName: "fallback",
      teamName: "team",
      planModeRequired: false,
    });
    expect(getAgentId()).toBe("fallback@team");
  });
});

// ──────────────────────────────────────────────
// getAgentName
// ──────────────────────────────────────────────

describe("getAgentName", () => {
  beforeEach(() => {
    clearDynamicTeamContext();
  });

  afterEach(() => {
    clearDynamicTeamContext();
  });

  test("returns undefined without context", () => {
    expect(getAgentName()).toBeUndefined();
  });

  test("returns agentName from dynamicTeamContext", () => {
    setDynamicTeamContext({
      agentId: "dev@team",
      agentName: "developer",
      teamName: "team",
      planModeRequired: false,
    });
    expect(getAgentName()).toBe("developer");
  });

  test("prefers AsyncLocalStorage over dynamicTeamContext", () => {
    setDynamicTeamContext({
      agentId: "d@t",
      agentName: "dynamic-name",
      teamName: "team",
      planModeRequired: false,
    });

    const ctx = createTeammateContext({
      agentId: "i@t",
      agentName: "inprocess-name",
      teamName: "team",
      planModeRequired: false,
      parentSessionId: "sess-1",
      abortController: new AbortController(),
    });

    const result = runWithTeammateContext(ctx, () => getAgentName());
    expect(result).toBe("inprocess-name");
  });
});

// ──────────────────────────────────────────────
// getTeamName
// ──────────────────────────────────────────────

describe("getTeamName", () => {
  beforeEach(() => {
    clearDynamicTeamContext();
  });

  afterEach(() => {
    clearDynamicTeamContext();
  });

  test("returns undefined without any context", () => {
    expect(getTeamName()).toBeUndefined();
  });

  test("returns teamName from dynamicTeamContext", () => {
    setDynamicTeamContext({
      agentId: "a@proj",
      agentName: "a",
      teamName: "proj",
      planModeRequired: false,
    });
    expect(getTeamName()).toBe("proj");
  });

  test("returns teamName from teamContext param when no dynamic context", () => {
    expect(getTeamName({ teamName: "param-team" })).toBe("param-team");
  });

  test("prefers dynamicTeamContext over teamContext param", () => {
    setDynamicTeamContext({
      agentId: "a@dyn",
      agentName: "a",
      teamName: "dyn-team",
      planModeRequired: false,
    });
    expect(getTeamName({ teamName: "param-team" })).toBe("dyn-team");
  });

  test("prefers AsyncLocalStorage over dynamicTeamContext", () => {
    setDynamicTeamContext({
      agentId: "a@dyn",
      agentName: "a",
      teamName: "dyn-team",
      planModeRequired: false,
    });

    const ctx = createTeammateContext({
      agentId: "a@als",
      agentName: "a",
      teamName: "als-team",
      planModeRequired: false,
      parentSessionId: "sess-1",
      abortController: new AbortController(),
    });

    const result = runWithTeammateContext(ctx, () => getTeamName());
    expect(result).toBe("als-team");
  });
});

// ──────────────────────────────────────────────
// getParentSessionId
// ──────────────────────────────────────────────

describe("getParentSessionId", () => {
  beforeEach(() => {
    clearDynamicTeamContext();
  });

  afterEach(() => {
    clearDynamicTeamContext();
  });

  test("returns undefined without context", () => {
    expect(getParentSessionId()).toBeUndefined();
  });

  test("returns parentSessionId from dynamicTeamContext", () => {
    setDynamicTeamContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      planModeRequired: false,
      parentSessionId: "parent-123",
    });
    expect(getParentSessionId()).toBe("parent-123");
  });

  test("prefers AsyncLocalStorage over dynamicTeamContext", () => {
    setDynamicTeamContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      planModeRequired: false,
      parentSessionId: "dynamic-sess",
    });

    const ctx = createTeammateContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      planModeRequired: false,
      parentSessionId: "als-sess",
      abortController: new AbortController(),
    });

    const result = runWithTeammateContext(ctx, () => getParentSessionId());
    expect(result).toBe("als-sess");
  });
});

// ──────────────────────────────────────────────
// getTeammateColor
// ──────────────────────────────────────────────

describe("getTeammateColor", () => {
  beforeEach(() => {
    clearDynamicTeamContext();
  });

  afterEach(() => {
    clearDynamicTeamContext();
  });

  test("returns undefined without context", () => {
    expect(getTeammateColor()).toBeUndefined();
  });

  test("returns color from dynamicTeamContext", () => {
    setDynamicTeamContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      color: "#ff0000",
      planModeRequired: false,
    });
    expect(getTeammateColor()).toBe("#ff0000");
  });

  test("returns undefined when color not set in context", () => {
    setDynamicTeamContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      planModeRequired: false,
    });
    expect(getTeammateColor()).toBeUndefined();
  });

  test("prefers AsyncLocalStorage over dynamicTeamContext", () => {
    setDynamicTeamContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      color: "#00ff00",
      planModeRequired: false,
    });

    const ctx = createTeammateContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      color: "#0000ff",
      planModeRequired: false,
      parentSessionId: "sess-1",
      abortController: new AbortController(),
    });

    const result = runWithTeammateContext(ctx, () => getTeammateColor());
    expect(result).toBe("#0000ff");
  });
});

// ──────────────────────────────────────────────
// isTeammate
// ──────────────────────────────────────────────

describe("isTeammate", () => {
  beforeEach(() => {
    clearDynamicTeamContext();
  });

  afterEach(() => {
    clearDynamicTeamContext();
  });

  test("returns false without any context", () => {
    expect(isTeammate()).toBe(false);
  });

  test("returns true with valid dynamicTeamContext", () => {
    setDynamicTeamContext({
      agentId: "researcher@team",
      agentName: "researcher",
      teamName: "team",
      planModeRequired: false,
    });
    expect(isTeammate()).toBe(true);
  });

  test("returns false if agentId is missing in dynamicTeamContext", () => {
    setDynamicTeamContext({
      agentId: "",
      agentName: "a",
      teamName: "team",
      planModeRequired: false,
    });
    expect(isTeammate()).toBe(false);
  });

  test("returns false if teamName is missing in dynamicTeamContext", () => {
    setDynamicTeamContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "",
      planModeRequired: false,
    });
    expect(isTeammate()).toBe(false);
  });

  test("returns true when running in AsyncLocalStorage context", () => {
    const ctx = createTeammateContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      planModeRequired: false,
      parentSessionId: "sess-1",
      abortController: new AbortController(),
    });

    const result = runWithTeammateContext(ctx, () => isTeammate());
    expect(result).toBe(true);
  });

  test("AsyncLocalStorage takes priority even when dynamicTeamContext is empty", () => {
    clearDynamicTeamContext();

    const ctx = createTeammateContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      planModeRequired: false,
      parentSessionId: "sess-1",
      abortController: new AbortController(),
    });

    const result = runWithTeammateContext(ctx, () => isTeammate());
    expect(result).toBe(true);
  });
});

// ──────────────────────────────────────────────
// isTeamLead
// ──────────────────────────────────────────────

describe("isTeamLead", () => {
  beforeEach(() => {
    clearDynamicTeamContext();
  });

  afterEach(() => {
    clearDynamicTeamContext();
  });

  test("returns false when teamContext is undefined", () => {
    expect(isTeamLead(undefined)).toBe(false);
  });

  test("returns false when leadAgentId is empty string", () => {
    expect(isTeamLead({ leadAgentId: "" })).toBe(false);
  });

  test("returns true when agentId matches leadAgentId", () => {
    setDynamicTeamContext({
      agentId: "lead@team",
      agentName: "lead",
      teamName: "team",
      planModeRequired: false,
    });
    expect(isTeamLead({ leadAgentId: "lead@team" })).toBe(true);
  });

  test("returns false when agentId does not match leadAgentId", () => {
    setDynamicTeamContext({
      agentId: "worker@team",
      agentName: "worker",
      teamName: "team",
      planModeRequired: false,
    });
    expect(isTeamLead({ leadAgentId: "lead@team" })).toBe(false);
  });

  test("returns true when no agentId is set (backwards compat)", () => {
    // No dynamicTeamContext → no agentId → the original lead session
    expect(isTeamLead({ leadAgentId: "lead@team" })).toBe(true);
  });

  test("AsyncLocalStorage agentId takes priority for lead check", () => {
    const ctx = createTeammateContext({
      agentId: "lead@team",
      agentName: "lead",
      teamName: "team",
      planModeRequired: false,
      parentSessionId: "sess-1",
      abortController: new AbortController(),
    });

    const result = runWithTeammateContext(ctx, () =>
      isTeamLead({ leadAgentId: "lead@team" }),
    );
    expect(result).toBe(true);
  });

  test("AsyncLocalStorage with non-lead agentId returns false", () => {
    const ctx = createTeammateContext({
      agentId: "worker@team",
      agentName: "worker",
      teamName: "team",
      planModeRequired: false,
      parentSessionId: "sess-1",
      abortController: new AbortController(),
    });

    const result = runWithTeammateContext(ctx, () =>
      isTeamLead({ leadAgentId: "lead@team" }),
    );
    expect(result).toBe(false);
  });
});

// ──────────────────────────────────────────────
// isPlanModeRequired
// ──────────────────────────────────────────────

describe("isPlanModeRequired", () => {
  beforeEach(() => {
    clearDynamicTeamContext();
  });

  afterEach(() => {
    clearDynamicTeamContext();
  });

  test("returns false without any context", () => {
    expect(isPlanModeRequired()).toBe(false);
  });

  test("returns true when dynamicTeamContext has planModeRequired=true", () => {
    setDynamicTeamContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      planModeRequired: true,
    });
    expect(isPlanModeRequired()).toBe(true);
  });

  test("returns false when dynamicTeamContext has planModeRequired=false", () => {
    setDynamicTeamContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      planModeRequired: false,
    });
    expect(isPlanModeRequired()).toBe(false);
  });

  test("prefers AsyncLocalStorage over dynamicTeamContext", () => {
    setDynamicTeamContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      planModeRequired: false,
    });

    const ctx = createTeammateContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      planModeRequired: true,
      parentSessionId: "sess-1",
      abortController: new AbortController(),
    });

    const result = runWithTeammateContext(ctx, () => isPlanModeRequired());
    expect(result).toBe(true);
  });
});
