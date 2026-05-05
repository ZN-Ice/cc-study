/**
 * Built-in agent definitions.
 *
 * References: free-code/src/tools/AgentTool/builtInAgents.ts, built-in/
 */

import type { AgentDefinition } from "./types.js";
import { AgentDefinitionRegistry } from "./types.js";

// ──────────────────────────────────────────────
// general-purpose Agent
// ──────────────────────────────────────────────

const generalPurposeAgent: AgentDefinition = {
  agentType: "general-purpose",
  whenToUse:
    "General-purpose agent for researching complex questions, searching for code, " +
    "and executing multi-step tasks autonomously. Use when the task doesn't match " +
    "a more specialized agent type.",
  // tools: undefined means all available tools
  disallowedTools: undefined,
  isReadOnly: false,
  maxTurns: 20,
  getSystemPrompt: () =>
    "You are a helpful AI assistant working as a sub-agent. " +
    "Complete the task you are given thoroughly and report back concisely. " +
    "When you are done, provide a clear summary of what you found or accomplished. " +
    "You have access to tools for reading files, searching code, and executing commands. " +
    "Use them as needed to complete your task.",
};

// ──────────────────────────────────────────────
// Explore Agent
// ──────────────────────────────────────────────

const exploreAgent: AgentDefinition = {
  agentType: "Explore",
  whenToUse:
    "Fast agent specialized for exploring codebases. Use when you need to " +
    "quickly find files by patterns, search for keywords, or answer questions " +
    "about the codebase. This agent is READ-ONLY and will not modify any files.",
  disallowedTools: ["Write", "Edit", "Agent"],
  isReadOnly: true,
  maxTurns: 20,
  getSystemPrompt: () =>
    "You are a fast codebase exploration agent. Your job is to search and find " +
    "information in the codebase quickly. You are READ-ONLY — never modify any files. " +
    "Use Glob to find files by pattern, Grep to search file contents, and Read to " +
    "examine specific files. Be thorough but efficient. " +
    "Report your findings clearly and concisely when done.",
};

// ──────────────────────────────────────────────
// Plan Agent
// ──────────────────────────────────────────────

const planAgent: AgentDefinition = {
  agentType: "Plan",
  whenToUse:
    "Software architect agent for designing implementation plans. Use when you " +
    "need to plan the implementation strategy for a task. Returns step-by-step plans, " +
    "identifies critical files, and considers architectural trade-offs. " +
    "This agent is READ-ONLY and will not modify any files.",
  disallowedTools: ["Write", "Edit", "Agent"],
  isReadOnly: true,
  maxTurns: 20,
  getSystemPrompt: () =>
    "You are a software architect agent. Your job is to explore the codebase and " +
    "design implementation plans. You are READ-ONLY — never modify any files. " +
    "Analyze the existing architecture, identify relevant files and patterns, " +
    "and produce a clear step-by-step implementation plan. " +
    "Consider edge cases, test strategies, and potential risks. " +
    "Output your plan in a structured, actionable format.",
};

// ──────────────────────────────────────────────
// Registry Factory
// ──────────────────────────────────────────────

const teammateAgent: AgentDefinition = {
  agentType: "teammate",
  whenToUse:
    "Teammate agent for collaborative multi-agent work within a team. " +
    "Use when you need to coordinate with other agents via messaging.",
  disallowedTools: ["Agent", "team_create"],
  maxTurns: 30,
  getSystemPrompt: () =>
    "You are a collaborative teammate in a multi-agent team. " +
    "Work on your assigned task independently. Your progress is automatically monitored via heartbeat. " +
    "Coordinate with other team members via send_message ONLY when you need to share findings or request input. " +
    "Report your results clearly and concisely when done — results are delivered to the team lead automatically. " +
    "DO NOT send status update messages unless explicitly asked.",
};

/**
 * Create an AgentDefinitionRegistry populated with all built-in agents.
 */
export function createDefaultAgentDefinitions(): AgentDefinitionRegistry {
  const registry = new AgentDefinitionRegistry();
  registry.register(generalPurposeAgent);
  registry.register(exploreAgent);
  registry.register(planAgent);
  registry.register(teammateAgent);
  return registry;
}

/**
 * The built-in agent definitions as an array (for convenience).
 */
export const builtInAgentDefinitions: AgentDefinition[] = [
  generalPurposeAgent,
  exploreAgent,
  planAgent,
  teammateAgent,
];
