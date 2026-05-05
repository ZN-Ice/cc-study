import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, rm } from "node:fs/promises";

// Mock mailbox operations
vi.mock("../../../src/utils/teammateMailbox.js", () => ({
  writeToMailbox: vi.fn().mockResolvedValue(undefined),
  createIdleNotification: vi.fn((agentId, opts) => ({
    type: "idle_notification",
    from: agentId,
    timestamp: new Date().toISOString(),
    idleReason: opts?.idleReason,
    summary: opts?.summary,
  })),
  TEAM_LEAD_NAME: "team-lead",
  readMailbox: vi.fn().mockResolvedValue([]),
}));

// Mock runSubAgent
vi.mock("../../../src/tools/AgentTool/orchestrator.js", () => ({
  runSubAgent: vi.fn().mockResolvedValue({
    agentType: "teammate",
    content: "Mock result from teammate",
    totalToolUseCount: 2,
    totalDurationMs: 100,
  }),
}));

// Mock teamHelper - will be configured in beforeEach
const mockReadTeamFile = vi.fn();
const mockWriteTeamFileSync = vi.fn();
vi.mock("../../../src/utils/teamHelper.js", () => ({
  generateAgentId: vi.fn((name: string, teamName: string) => `${name}@${teamName}`),
  readTeamFile: (...args: unknown[]) => mockReadTeamFile(...args),
  writeTeamFileSync: (...args: unknown[]) => mockWriteTeamFileSync(...args),
  getTeamFilePath: (teamName: string) => {
    const home = process.env.HOME ?? "/tmp";
    return join(home, ".claude", "teams", teamName.toLowerCase(), "team.json");
  },
  getTeamDir: (teamName: string) => {
    const home = process.env.HOME ?? "/tmp";
    return join(home, ".claude", "teams", teamName.toLowerCase());
  },
  sanitizeName: (name: string) => name.toLowerCase(),
}));

import { spawnInProcessTeammate } from "../../../src/utils/teammate/spawnInProcess.js";
import { getRunningAgentIds, getRunningCount, cancelAllRunners } from "../../../src/utils/teammate/runnerRegistry.js";
import { runSubAgent } from "../../../src/tools/AgentTool/orchestrator.js";
import { createDefaultRegistry } from "../../../src/tools/index.js";
import { writeToMailbox } from "../../../src/utils/teammateMailbox.js";

describe("spawnInProcessTeammate", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `cc-study-spawn-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await mkdir(testDir, { recursive: true });
    process.env.HOME = testDir;

    vi.clearAllMocks();
    vi.mocked(runSubAgent).mockResolvedValue({
      agentType: "teammate",
      content: "Mock result from teammate",
      totalToolUseCount: 2,
      totalDurationMs: 100,
    });
    vi.mocked(writeToMailbox).mockClear();
    mockReadTeamFile.mockReset();
    mockWriteTeamFileSync.mockReset();
    cancelAllRunners();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("spawns a teammate and starts execution immediately", async () => {
    const registry = createDefaultRegistry();
    const apiConfig = {
      apiKey: "test-key",
      model: "test-model",
      maxTokens: 1024,
      systemPrompt: "Test prompt",
    };

    const result = spawnInProcessTeammate({
      name: "test-teammate",
      teamName: "test-team",
      prompt: "Analyze the project",
      agentDefinition: {
        agentType: "teammate",
        whenToUse: "Test",
        getSystemPrompt: () => "You are a teammate",
        maxTurns: 10,
      },
      apiConfig,
      parentRegistry: registry,
      context: {
        workingDirectory: testDir,
        abortSignal: new AbortController().signal,
      },
    });

    expect(result.success).toBe(true);
    expect(result.agentId).toBe("test-teammate@test-team");

    // runSubAgent should be called (the teammate should start executing)
    await vi.waitFor(() => {
      expect(vi.mocked(runSubAgent)).toHaveBeenCalled();
    }, { timeout: 2000 });
  });

  test("registers the runner in the registry", async () => {
    const registry = createDefaultRegistry();
    const apiConfig = {
      apiKey: "test-key",
      model: "test-model",
      maxTokens: 1024,
      systemPrompt: "Test prompt",
    };

    spawnInProcessTeammate({
      name: "test-teammate",
      teamName: "test-team",
      prompt: "Analyze the project",
      agentDefinition: {
        agentType: "teammate",
        whenToUse: "Test",
        getSystemPrompt: () => "You are a teammate",
      },
      apiConfig,
      parentRegistry: registry,
      context: {
        workingDirectory: testDir,
        abortSignal: new AbortController().signal,
      },
    });

    expect(getRunningCount()).toBe(1);
    expect(getRunningAgentIds()).toContain("test-teammate@test-team");
  });

  test("adds teammate to team.json members list", async () => {
    const registry = createDefaultRegistry();
    const apiConfig = {
      apiKey: "test-key",
      model: "test-model",
      maxTokens: 1024,
      systemPrompt: "Test prompt",
    };

    // Mock readTeamFile to return a team with just the lead
    const initialTeamFile = {
      name: "test-team",
      description: "Test team",
      createdAt: Date.now(),
      leadAgentId: "team-lead@test-team",
      members: [{
        agentId: "team-lead@test-team",
        name: "team-lead",
        agentType: "team-lead",
        joinedAt: Date.now(),
        cwd: testDir,
        color: "green",
      }],
    };
    mockReadTeamFile.mockReturnValue(initialTeamFile);

    spawnInProcessTeammate({
      name: "test-teammate",
      teamName: "test-team",
      prompt: "Analyze the project",
      agentDefinition: {
        agentType: "teammate",
        whenToUse: "Test",
        getSystemPrompt: () => "You are a teammate",
      },
      apiConfig,
      parentRegistry: registry,
      context: {
        workingDirectory: testDir,
        abortSignal: new AbortController().signal,
      },
    });

    // Verify writeTeamFileSync was called with updated members
    expect(mockWriteTeamFileSync).toHaveBeenCalled();
    const callArg = mockWriteTeamFileSync.mock.calls[0]![1];
    expect(callArg.members).toHaveLength(2);
    expect(callArg.members.some((m: { name: string }) => m.name === "test-teammate")).toBe(true);
  });

  test("reports completion to mailbox", async () => {
    const registry = createDefaultRegistry();
    const apiConfig = {
      apiKey: "test-key",
      model: "test-model",
      maxTokens: 1024,
      systemPrompt: "Test prompt",
    };

    spawnInProcessTeammate({
      name: "test-teammate",
      teamName: "test-team",
      prompt: "Analyze the project",
      agentDefinition: {
        agentType: "teammate",
        whenToUse: "Test",
        getSystemPrompt: () => "You are a teammate",
      },
      apiConfig,
      parentRegistry: registry,
      context: {
        workingDirectory: testDir,
        abortSignal: new AbortController().signal,
      },
    });

    // Wait for teammate to complete and write to mailbox
    await vi.waitFor(() => {
      expect(writeToMailbox).toHaveBeenCalled();
    }, { timeout: 3000 });

    // Check that writeToMailbox was called with completion message
    const calls = vi.mocked(writeToMailbox).mock.calls;
    const completionCall = calls.find((call) => {
      const text = call[1]?.text ?? "";
      return text.includes("teammate_completion") || text.includes("idle_notification");
    });
    expect(completionCall).toBeDefined();
  });

  test("runner is unregistered after completion", async () => {
    const registry = createDefaultRegistry();
    const apiConfig = {
      apiKey: "test-key",
      model: "test-model",
      maxTokens: 1024,
      systemPrompt: "Test prompt",
    };

    spawnInProcessTeammate({
      name: "test-teammate",
      teamName: "test-team",
      prompt: "Analyze the project",
      agentDefinition: {
        agentType: "teammate",
        whenToUse: "Test",
        getSystemPrompt: () => "You are a teammate",
      },
      apiConfig,
      parentRegistry: registry,
      context: {
        workingDirectory: testDir,
        abortSignal: new AbortController().signal,
      },
    });

    // Wait for runner to be unregistered after completion
    await vi.waitFor(() => {
      expect(getRunningCount()).toBe(0);
    }, { timeout: 3000 });
  });

  test("cancelled teammate stops execution", async () => {
    const abortController = new AbortController();
    const registry = createDefaultRegistry();
    const apiConfig = {
      apiKey: "test-key",
      model: "test-model",
      maxTokens: 1024,
      systemPrompt: "Test prompt",
    };

    // Make runSubAgent hang until aborted
    vi.mocked(runSubAgent).mockImplementation(async () => {
      await new Promise((resolve) => {
        abortController.signal.addEventListener("abort", () => resolve({
          agentType: "teammate",
          content: "Cancelled",
          totalToolUseCount: 0,
          totalDurationMs: 0,
        }));
      });
      throw new Error("Should not reach here");
    });

    spawnInProcessTeammate({
      name: "test-teammate",
      teamName: "test-team",
      prompt: "Analyze the project",
      agentDefinition: {
        agentType: "teammate",
        whenToUse: "Test",
        getSystemPrompt: () => "You are a teammate",
      },
      apiConfig,
      parentRegistry: registry,
      context: {
        workingDirectory: testDir,
        abortSignal: abortController.signal,
      },
    });

    // Verify runner is registered
    expect(getRunningCount()).toBe(1);

    // Cancel the runner
    abortController.abort();

    // Wait for runner to be unregistered
    await vi.waitFor(() => {
      expect(getRunningCount()).toBe(0);
    }, { timeout: 1000 });
  });

  test("passes correct parameters to runSubAgent", async () => {
    const registry = createDefaultRegistry();
    const apiConfig = {
      apiKey: "test-key",
      model: "test-model",
      maxTokens: 1024,
      systemPrompt: "Test prompt",
    };

    spawnInProcessTeammate({
      name: "test-teammate",
      teamName: "test-team",
      prompt: "Analyze the codebase",
      description: "Architecture analysis",
      agentDefinition: {
        agentType: "teammate",
        whenToUse: "Test",
        getSystemPrompt: () => "You are a test teammate",
        maxTurns: 15,
      },
      apiConfig,
      parentRegistry: registry,
      context: {
        workingDirectory: testDir,
        abortSignal: new AbortController().signal,
      },
    });

    await vi.waitFor(() => {
      expect(vi.mocked(runSubAgent)).toHaveBeenCalled();
    }, { timeout: 2000 });

    const call = vi.mocked(runSubAgent).mock.calls[0]![0];
    expect(call.prompt).toBe("Analyze the codebase");
    expect(call.agentId).toBe("test-teammate@test-team");
    expect(call.description).toBe("Architecture analysis");
    expect(call.maxTurns).toBe(15);
  });
});