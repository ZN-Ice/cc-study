/**
 * AgentTool description builder.
 *
 * References: free-code/src/tools/AgentTool/prompt.ts
 *
 * Generates the tool description string that tells the LLM which agent types
 * are available and when to use each.
 */

import type { AgentDefinition } from "./types.js";

/**
 * Build the tool description listing available agent types and usage notes.
 */
export function getAgentToolDescription(definitions: AgentDefinition[]): string {
  const agentList = definitions
    .map((def) => {
      const toolsNote = def.disallowedTools
        ? ` (excludes: ${def.disallowedTools.join(", ")})`
        : def.tools
          ? ` (tools: ${def.tools.join(", ")})`
          : " (all tools)";
      return `- ${def.agentType}: ${def.whenToUse}${toolsNote}`;
    })
    .join("\n");

  return (
    "Launch a new agent to handle complex, multi-step tasks autonomously.\n\n" +
    "Available agent types:\n" +
    agentList +
    "\n\n" +
    "Usage notes:\n" +
    "- Always include a short description (3-5 words)\n" +
    "- When the agent is done, it will return a single message back to you\n" +
    "- You can optionally specify a subagent_type to use a specialized agent\n" +
    "- If unsure which agent type to use, omit subagent_type (defaults to general-purpose)\n" +
    "- Do NOT use the agent tool for simple lookups that you can do yourself"
  );
}
