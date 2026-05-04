/**
 * Tests for AgentTool — the Tool interface implementation.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { AgentTool } from "../../../../src/tools/AgentTool/index.js";
import type { ToolContext } from "../../../../src/tools/types.js";
import { ToolRegistry } from "../../../../src/tools/registry.js";

// Mock the orchestrator
vi.mock("../../../../src/tools/AgentTool/orchestrator.js", () => ({
  runSubAgent: vi.fn(),
  filterToolsForAgent: vi.fn(),
}));

// Mock the spawn module
vi.mock("../../../../src/utils/teammate/spawnInProcess.js", () => ({
  spawnInProcessTeammate: vi.fn(),
}));

import { runSubAgent } from "../../../../src/tools/AgentTool/orchestrator.js";
import { spawnInProcessTeammate } from "../../../../src/utils/teammate/spawnInProcess.js";

const mockedRunSubAgent = vi.mocked(runSubAgent);
const mockedSpawnTeammate = vi.mocked(spawnInProcessTeammate);

function createTestContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    workingDirectory: process.cwd(),
    abortSignal: new AbortController().signal,
    apiConfig: {
      apiKey: "test-key",
      model: "test-model",
      maxTokens: 4096,
      systemPrompt: "test",
      temperature: 0,
    },
    toolRegistry: new ToolRegistry(),
    ...overrides,
  };
}

describe("AgentTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateInput", () => {
    test("accepts valid input with default agent type", async () => {
      const result = await AgentTool.validateInput(
        { description: "search", prompt: "Find all TODOs" },
        createTestContext(),
      );
      expect(result.ok).toBe(true);
    });

    test("accepts valid input with explicit agent type", async () => {
      const result = await AgentTool.validateInput(
        { description: "explore", prompt: "Search codebase", subagent_type: "Explore" },
        createTestContext(),
      );
      expect(result.ok).toBe(true);
    });

    test("rejects empty prompt", async () => {
      const result = await AgentTool.validateInput(
        { description: "task", prompt: "" },
        createTestContext(),
      );
      expect(result.ok).toBe(false);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("prompt");
      }
    });

    test("rejects unknown agent type", async () => {
      const result = await AgentTool.validateInput(
        { description: "task", prompt: "Do something", subagent_type: "NonExistentAgent" },
        createTestContext(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Unknown agent type");
        expect(result.error).toContain("NonExistentAgent");
      }
    });
  });

  describe("execute", () => {
    test("returns text result from sub-agent", async () => {
      mockedRunSubAgent.mockResolvedValueOnce({
        agentType: "general-purpose",
        content: "Found 3 TODO comments",
        totalToolUseCount: 2,
        totalDurationMs: 1500,
      });

      const result = await AgentTool.execute(
        { description: "search", prompt: "Find TODOs" },
        createTestContext(),
      );

      expect(result.output).toBe("Found 3 TODO comments");
      expect(result.error).toBeUndefined();
    });

    test("returns error when API config is missing", async () => {
      const ctx = createTestContext({ apiConfig: undefined });

      const result = await AgentTool.execute(
        { description: "task", prompt: "Do something" },
        ctx,
      );

      expect(result.error).toBe(true);
      expect(result.output).toContain("API config");
    });

    test("returns error when tool registry is missing", async () => {
      const ctx = createTestContext({ toolRegistry: undefined });

      const result = await AgentTool.execute(
        { description: "task", prompt: "Do something" },
        ctx,
      );

      expect(result.error).toBe(true);
      expect(result.output).toContain("Tool registry");
    });

    test("handles sub-agent execution error", async () => {
      mockedRunSubAgent.mockRejectedValueOnce(new Error("API timeout"));

      const result = await AgentTool.execute(
        { description: "task", prompt: "Do something" },
        createTestContext(),
      );

      expect(result.error).toBe(true);
      expect(result.output).toContain("Agent execution error");
      expect(result.output).toContain("API timeout");
    });

    test("handles abort gracefully", async () => {
      const controller = new AbortController();
      controller.abort();

      mockedRunSubAgent.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

      const result = await AgentTool.execute(
        { description: "task", prompt: "Do something" },
        createTestContext({ abortSignal: controller.signal }),
      );

      expect(result.error).toBe(true);
      expect(result.output).toContain("cancelled");
    });

    test("uses correct agent type from input", async () => {
      mockedRunSubAgent.mockResolvedValueOnce({
        agentType: "Explore",
        content: "Found files",
        totalToolUseCount: 0,
        totalDurationMs: 500,
      });

      await AgentTool.execute(
        { description: "explore", prompt: "Find files", subagent_type: "Explore" },
        createTestContext(),
      );

      expect(mockedRunSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentDefinition: expect.objectContaining({ agentType: "Explore" }),
        }),
      );
    });
  });

  describe("isSearchOrReadCommand", () => {
    test("returns false for both search and read", () => {
      const result = AgentTool.isSearchOrReadCommand!({ description: "task", prompt: "Do it" });
      expect(result.isSearch).toBe(false);
      expect(result.isRead).toBe(false);
    });
  });

  describe("isReadOnly", () => {
    test("returns false", () => {
      expect(AgentTool.isReadOnly!({ description: "task", prompt: "Do it" })).toBe(false);
    });
  });

  describe("teammate spawn path", () => {
    test("validateInput: accepts team_name with name", async () => {
      const result = await AgentTool.validateInput(
        {
          description: "research",
          prompt: "Analyze the project structure",
          team_name: "research-team",
          name: "explorer",
        },
        createTestContext(),
      );
      expect(result.ok).toBe(true);
    });

    test("validateInput: rejects team_name without name", async () => {
      const result = await AgentTool.validateInput(
        {
          description: "research",
          prompt: "Analyze the project structure",
          team_name: "research-team",
        },
        createTestContext(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("name is required");
      }
    });

    test("execute: spawn returns immediately with agent_id", async () => {
      mockedSpawnTeammate.mockReturnValue({
        success: true,
        agentId: "explorer@research-team",
        taskId: "abc12345",
        abortController: new AbortController(),
        teammateContext: {
          agentId: "explorer@research-team",
          agentName: "explorer",
          teamName: "research-team",
          planModeRequired: false,
          parentSessionId: "abc12345",
          abortController: new AbortController(),
          isInProcess: true,
        },
      });

      const result = await AgentTool.execute(
        {
          description: "research",
          prompt: "Analyze the project",
          team_name: "research-team",
          name: "explorer",
        },
        createTestContext(),
      );

      expect(result.error).toBeUndefined();
      const parsed = JSON.parse(result.output);
      expect(parsed.status).toBe("teammate_spawned");
      expect(parsed.agent_id).toBe("explorer@research-team");
      expect(parsed.teammate_name).toBe("explorer");
      expect(parsed.team_name).toBe("research-team");
      expect(result.metadata?.spawned).toBe(true);

      // Should NOT have called the synchronous runSubAgent
      expect(mockedRunSubAgent).not.toHaveBeenCalled();
    });

    test("execute: spawn failure returns error", async () => {
      mockedSpawnTeammate.mockReturnValue({
        success: false,
        agentId: "explorer@research-team",
        error: "Context initialization failed",
      });

      const result = await AgentTool.execute(
        {
          description: "research",
          prompt: "Analyze the project",
          team_name: "research-team",
          name: "explorer",
        },
        createTestContext(),
      );

      expect(result.error).toBe(true);
      expect(result.output).toContain("Failed to spawn teammate");
      expect(result.output).toContain("Context initialization failed");
    });

    test("execute: without team_name still uses synchronous path", async () => {
      mockedRunSubAgent.mockResolvedValueOnce({
        agentType: "general-purpose",
        content: "Sync result",
        totalToolUseCount: 1,
        totalDurationMs: 100,
      });

      const result = await AgentTool.execute(
        { description: "task", prompt: "Do something" },
        createTestContext(),
      );

      expect(mockedRunSubAgent).toHaveBeenCalled();
      expect(mockedSpawnTeammate).not.toHaveBeenCalled();
      expect(result.output).toBe("Sync result");
    });

    test("execute: spawn output includes agent_type from subagent_type", async () => {
      mockedSpawnTeammate.mockReturnValue({
        success: true,
        agentId: "explorer@research-team",
        taskId: "abc12345",
        abortController: new AbortController(),
        teammateContext: {
          agentId: "explorer@research-team",
          agentName: "explorer",
          teamName: "research-team",
          planModeRequired: false,
          parentSessionId: "abc12345",
          abortController: new AbortController(),
          isInProcess: true,
        },
      });

      const result = await AgentTool.execute(
        {
          description: "explore",
          prompt: "Search codebase",
          team_name: "research-team",
          name: "explorer",
          subagent_type: "Explore",
        },
        createTestContext(),
      );

      const parsed = JSON.parse(result.output);
      expect(parsed.agent_type).toBe("Explore");
      expect(mockedSpawnTeammate).toHaveBeenCalledWith(
        expect.objectContaining({
          agentDefinition: expect.objectContaining({ agentType: "Explore" }),
        }),
      );
    });

    test("execute: spawn output defaults agent_type to teammate when omitted", async () => {
      mockedSpawnTeammate.mockReturnValue({
        success: true,
        agentId: "helper@research-team",
        taskId: "abc12346",
        abortController: new AbortController(),
        teammateContext: {
          agentId: "helper@research-team",
          agentName: "helper",
          teamName: "research-team",
          planModeRequired: false,
          parentSessionId: "abc12346",
          abortController: new AbortController(),
          isInProcess: true,
        },
      });

      const result = await AgentTool.execute(
        {
          description: "help",
          prompt: "Do general work",
          team_name: "research-team",
          name: "helper",
        },
        createTestContext(),
      );

      const parsed = JSON.parse(result.output);
      expect(parsed.agent_type).toBe("teammate");
      expect(mockedSpawnTeammate).toHaveBeenCalledWith(
        expect.objectContaining({
          agentDefinition: expect.objectContaining({ agentType: "teammate" }),
        }),
      );
    });
  });
});
