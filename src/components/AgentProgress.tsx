/**
 * AgentProgress — shows sub-agent execution progress.
 *
 * References: free-code/src/components/AgentProgressLine.tsx
 *
 * Displays agent type, description, tool use count, elapsed time,
 * and the last N tool invocations. Updates every second.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { formatNumber } from "../utils/format.js";

export interface AgentProgressProps {
  /** Agent type (e.g. "general-purpose", "Explore", "Plan") */
  readonly agentType: string;
  /** Description of what the agent is doing */
  readonly description?: string;
  /** Number of tool uses so far */
  readonly toolUseCount: number;
  /** Time when the agent started */
  readonly startTime: number;
  /** Last N tool invocations as short strings */
  readonly recentTools?: readonly string[];
  /** Token usage for this agent */
  readonly tokenCount?: number;
  /** Model used by this agent */
  readonly model?: string;
}

export const AgentProgress: React.FC<AgentProgressProps> = ({
  agentType,
  description,
  toolUseCount,
  startTime,
  recentTools,
  tokenCount,
  model,
}) => {
  const [elapsed, setElapsed] = useState(() => Math.round((Date.now() - startTime) / 1000));

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.round((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  const descPart = description ? `: ${description}` : "";
  const timeStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m${elapsed % 60}s`;

  const statsParts: string[] = [
    `${toolUseCount} tool use${toolUseCount !== 1 ? "s" : ""}`,
  ];
  if (tokenCount !== undefined) {
    statsParts.push(`${formatNumber(tokenCount)} tokens`);
  }
  if (model !== undefined) {
    statsParts.push(model);
  }
  statsParts.push(timeStr);

  return (
    <Box marginLeft={2} flexDirection="column">
      <Text color="magenta">
        🤖 Agent ({agentType}){descPart}
      </Text>
      <Text dimColor>
        {"   "}{statsParts.join(" · ")}
      </Text>
      {recentTools && recentTools.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {recentTools.map((tool, i) => (
            <Text key={i} dimColor>
              {"   "}▸ {tool}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
};
