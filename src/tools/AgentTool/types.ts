/**
 * Agent subsystem type definitions.
 *
 * References: free-code/src/tools/AgentTool/AgentTool.tsx, loadAgentsDir.ts
 */

import { z } from "zod";

// ──────────────────────────────────────────────
// Agent Type Identifiers
// ──────────────────────────────────────────────

/** Built-in agent type identifiers */
export type BuiltinAgentType = "general-purpose" | "Explore" | "Plan";

/** Agent type string (extensible for future custom agents) */
export type AgentType = BuiltinAgentType | (string & {});

// ──────────────────────────────────────────────
// Agent Definition
// ──────────────────────────────────────────────

/**
 * Definition of a single agent type.
 *
 * Each agent type specifies:
 * - What tools it can use (tools allowlist / disallowedTools denylist)
 * - Its own system prompt
 * - Whether it's read-only
 * - Maximum agentic turns
 */
export interface AgentDefinition {
  /** Unique agent type identifier */
  readonly agentType: AgentType;

  /** Human-readable description for LLM agent selection */
  readonly whenToUse: string;

  /**
   * Tools this agent is allowed to use.
   * undefined = all available tools.
   * ["*"] = all available tools (explicit wildcard).
   * ["Read", "Grep", ...] = only these tools.
   */
  readonly tools?: string[];

  /** Tools this agent is explicitly denied */
  readonly disallowedTools?: string[];

  /** System prompt factory for the agent */
  readonly getSystemPrompt: () => string;

  /** Whether this agent is read-only (never modifies files) */
  readonly isReadOnly?: boolean;

  /** Maximum number of agentic turns before stopping (default: 20) */
  readonly maxTurns?: number;
}

// ──────────────────────────────────────────────
// Agent Tool Input Schema
// ──────────────────────────────────────────────

/** Zod schema for AgentTool input parameters */
export const agentToolInputSchema = z.strictObject({
  description: z.string().describe(
    "A short (3-5 word) description of the task"
  ),
  prompt: z.string().describe(
    "The task for the agent to perform"
  ),
  subagent_type: z.string().optional().describe(
    "The type of agent to use. Defaults to 'general-purpose'."
  ),
  model: z.string().optional().describe(
    "Optional model override (currently unused, inherits parent model)"
  ),
});

export type AgentToolInput = z.infer<typeof agentToolInputSchema>;

// ──────────────────────────────────────────────
// Agent Tool Result
// ──────────────────────────────────────────────

/** Result produced by a completed agent run */
export interface AgentToolResult {
  readonly agentType: string;
  readonly content: string;
  readonly totalToolUseCount: number;
  readonly totalDurationMs: number;
}

// ──────────────────────────────────────────────
// Agent Progress Callback
// ──────────────────────────────────────────────

/** Progress event emitted during agent execution */
export interface AgentProgressEvent {
  readonly agentType: string;
  readonly description?: string;
  readonly toolUseCount: number;
  readonly startTime: number;
  /** Last N tool invocations as short human-readable strings (e.g. "Read: file.ts") */
  readonly recentTools: readonly string[];
}

/** Callback type for agent progress updates */
export type OnAgentProgress = (event: AgentProgressEvent) => void;

// ──────────────────────────────────────────────
// Agent Definition Registry
// ──────────────────────────────────────────────

/**
 * Registry of available agent definitions.
 * Separate from ToolRegistry — agents and tools are different concerns.
 */
export class AgentDefinitionRegistry {
  private readonly agents = new Map<string, AgentDefinition>();

  /** Register an agent definition */
  register(def: AgentDefinition): void {
    if (this.agents.has(def.agentType)) {
      throw new Error(`Agent type "${def.agentType}" is already registered`);
    }
    this.agents.set(def.agentType, def);
  }

  /** Get an agent definition by type */
  get(type: string): AgentDefinition | undefined {
    return this.agents.get(type);
  }

  /** Get all registered agent definitions */
  getAll(): AgentDefinition[] {
    return [...this.agents.values()];
  }

  /** Number of registered agent definitions */
  get size(): number {
    return this.agents.size;
  }
}
