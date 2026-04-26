/**
 * AgentProgress — shows sub-agent execution progress.
 *
 * References: free-code/src/components/AgentProgressLine.tsx
 *
 * Displays agent type, description, tool use count, and elapsed time.
 * Updates every second for real-time feedback.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

export interface AgentProgressProps {
  /** Agent type (e.g. "general-purpose", "Explore", "Plan") */
  readonly agentType: string;
  /** Description of what the agent is doing */
  readonly description?: string;
  /** Number of tool uses so far */
  readonly toolUseCount: number;
  /** Time when the agent started */
  readonly startTime: number;
}

export const AgentProgress: React.FC<AgentProgressProps> = ({
  agentType,
  description,
  toolUseCount,
  startTime,
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

  return (
    <Box marginLeft={2} flexDirection="column">
      <Text color="magenta">
        🤖 Agent ({agentType}){descPart}
      </Text>
      <Text dimColor>
        {"   "}{toolUseCount} tool use{toolUseCount !== 1 ? "s" : ""} · {timeStr}
      </Text>
    </Box>
  );
};
