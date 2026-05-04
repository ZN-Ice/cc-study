import { describe, test, expect, beforeEach } from "vitest";
import {
  createTeammateContext,
  getTeammateContext,
  runWithTeammateContext,
  isInProcessTeammate,
  type TeammateContext,
} from "../../../src/utils/teammateContext.js";

describe("createTeammateContext", () => {
  test("produces correct shape with all fields", () => {
    const ac = new AbortController();
    const ctx = createTeammateContext({
      agentId: "researcher@team-1",
      agentName: "researcher",
      teamName: "team-1",
      color: "#ff0000",
      planModeRequired: true,
      parentSessionId: "parent-sess-123",
      abortController: ac,
    });

    expect(ctx).toEqual({
      agentId: "researcher@team-1",
      agentName: "researcher",
      teamName: "team-1",
      color: "#ff0000",
      planModeRequired: true,
      parentSessionId: "parent-sess-123",
      abortController: ac,
      isInProcess: true,
    });
  });

  test("produces correct shape without optional color", () => {
    const ac = new AbortController();
    const ctx = createTeammateContext({
      agentId: "dev@team",
      agentName: "dev",
      teamName: "team",
      planModeRequired: false,
      parentSessionId: "sess-1",
      abortController: ac,
    });

    expect(ctx.isInProcess).toBe(true);
    expect(ctx.color).toBeUndefined();
    expect(ctx.agentId).toBe("dev@team");
  });

  test("always sets isInProcess to true", () => {
    const ac = new AbortController();
    const ctx = createTeammateContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      planModeRequired: false,
      parentSessionId: "s",
      abortController: ac,
    });
    expect(ctx.isInProcess).toBe(true);
  });
});

describe("getTeammateContext", () => {
  test("returns undefined with no context set", () => {
    expect(getTeammateContext()).toBeUndefined();
  });
});

describe("runWithTeammateContext", () => {
  test("sets context for execution", () => {
    const ac = new AbortController();
    const ctx = createTeammateContext({
      agentId: "worker@team",
      agentName: "worker",
      teamName: "team",
      planModeRequired: false,
      parentSessionId: "sess-1",
      abortController: ac,
    });

    let captured: TeammateContext | undefined;
    runWithTeammateContext(ctx, () => {
      captured = getTeammateContext();
    });

    expect(captured).toBe(ctx);
  });

  test("returns the function's return value", () => {
    const ac = new AbortController();
    const ctx = createTeammateContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      planModeRequired: false,
      parentSessionId: "s",
      abortController: ac,
    });

    const result = runWithTeammateContext(ctx, () => 42);
    expect(result).toBe(42);
  });

  test("restores context after execution", () => {
    const ac1 = new AbortController();
    const ctx1 = createTeammateContext({
      agentId: "outer@team",
      agentName: "outer",
      teamName: "team",
      planModeRequired: false,
      parentSessionId: "sess-1",
      abortController: ac1,
    });

    const ac2 = new AbortController();
    const ctx2 = createTeammateContext({
      agentId: "inner@team",
      agentName: "inner",
      teamName: "team",
      planModeRequired: false,
      parentSessionId: "sess-2",
      abortController: ac2,
    });

    runWithTeammateContext(ctx1, () => {
      expect(getTeammateContext()).toBe(ctx1);

      runWithTeammateContext(ctx2, () => {
        expect(getTeammateContext()).toBe(ctx2);
      });

      expect(getTeammateContext()).toBe(ctx1);
    });

    expect(getTeammateContext()).toBeUndefined();
  });

  test("context is undefined after run completes", () => {
    const ac = new AbortController();
    const ctx = createTeammateContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      planModeRequired: false,
      parentSessionId: "s",
      abortController: ac,
    });

    runWithTeammateContext(ctx, () => {
      // execute
    });

    expect(getTeammateContext()).toBeUndefined();
  });
});

describe("isInProcessTeammate", () => {
  test("returns false outside context", () => {
    expect(isInProcessTeammate()).toBe(false);
  });

  test("returns true within context", () => {
    const ac = new AbortController();
    const ctx = createTeammateContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      planModeRequired: false,
      parentSessionId: "s",
      abortController: ac,
    });

    const result = runWithTeammateContext(ctx, () => isInProcessTeammate());
    expect(result).toBe(true);
  });

  test("returns false after context exits", () => {
    const ac = new AbortController();
    const ctx = createTeammateContext({
      agentId: "a@t",
      agentName: "a",
      teamName: "t",
      planModeRequired: false,
      parentSessionId: "s",
      abortController: ac,
    });

    runWithTeammateContext(ctx, () => {
      expect(isInProcessTeammate()).toBe(true);
    });

    expect(isInProcessTeammate()).toBe(false);
  });
});
