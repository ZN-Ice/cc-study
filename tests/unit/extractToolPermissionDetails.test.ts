import { describe, test, expect } from "vitest";
import { extractToolPermissionDetails } from "../../src/hooks/useStreamResponse.js";

describe("extractToolPermissionDetails", () => {
  describe("Agent tool", () => {
    test("displays 'teammate' when team_name is set, ignoring subagent_type", () => {
      const result = extractToolPermissionDetails("Agent", {
        team_name: "research-team",
        name: "explorer",
        subagent_type: "Explore",
        description: "search codebase",
      });
      expect(result.subtitle).toBe("Type: teammate — search codebase");
    });

    test("displays 'teammate' when team_name is set without subagent_type", () => {
      const result = extractToolPermissionDetails("Agent", {
        team_name: "research-team",
        name: "helper",
        description: "do work",
      });
      expect(result.subtitle).toBe("Type: teammate — do work");
    });

    test("displays subagent_type when team_name is absent", () => {
      const result = extractToolPermissionDetails("Agent", {
        subagent_type: "Explore",
        description: "search codebase",
      });
      expect(result.subtitle).toBe("Type: Explore — search codebase");
    });

    test("defaults to 'general-purpose' when no team_name and no subagent_type", () => {
      const result = extractToolPermissionDetails("Agent", {
        description: "general task",
      });
      expect(result.subtitle).toBe("Type: general-purpose — general task");
    });

    test("omits description when not provided", () => {
      const result = extractToolPermissionDetails("Agent", {
        team_name: "my-team",
        name: "worker",
      });
      expect(result.subtitle).toBe("Type: teammate");
    });
  });

  describe("Bash tool", () => {
    test("returns command as content", () => {
      const result = extractToolPermissionDetails("Bash", {
        command: "ls -la",
      });
      expect(result.content).toBe("ls -la");
      expect(result.subtitle).toBeUndefined();
    });
  });
});
