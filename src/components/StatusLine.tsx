/**
 * StatusLine — single-line status bar showing model, token usage, cost,
 * executing tools, thinking state, and session duration.
 *
 * References: free-code/src/components/StatusLine.tsx
 */

import React from "react";
import { Box, Text } from "ink";
import type { TokenUsage } from "../cost-tracker.js";
import { formatNumber, formatDuration, formatCost } from "../utils/format.js";

interface StatusLineProps {
  readonly model: string;
  readonly tokenUsage: TokenUsage | null;
  readonly totalCost: number;
  readonly executingTools: readonly string[];
  readonly isLoading: boolean;
  readonly sessionDuration: number;
}

export function StatusLine(props: StatusLineProps): React.ReactElement {
  const {
    model,
    tokenUsage,
    totalCost,
    executingTools,
    isLoading,
    sessionDuration,
  } = props;

  const hasTools = executingTools.length > 0;
  const hasTokens =
    tokenUsage !== null &&
    (tokenUsage.inputTokens > 0 || tokenUsage.outputTokens > 0);
  const hasCost = totalCost > 0;
  const hasTime = sessionDuration > 0;

  const isExecuting = hasTools;
  const isThinking = !hasTools && isLoading;
  const isIdleWithTokens = !hasTools && !isLoading && hasTokens;

  if (!isExecuting && !isThinking && !isIdleWithTokens) {
    return (
      <Box>
        <Text>{model}</Text>
      </Box>
    );
  }

  const totalTokens =
    tokenUsage !== null
      ? tokenUsage.inputTokens + tokenUsage.outputTokens
      : 0;

  return (
    <Box>
      <Text dimColor={isIdleWithTokens}>{model}</Text>

      {isExecuting && (
        <>
          <Text dimColor> | </Text>
          <Text color="yellow">
            [Executing: {executingTools.join(", ")}]
          </Text>
          {hasCost && (
            <>
              <Text dimColor> · </Text>
              <Text color="green">{formatCost(totalCost)}</Text>
            </>
          )}
          {hasTime && (
            <>
              <Text dimColor> · </Text>
              <Text>{formatDuration(sessionDuration)}</Text>
            </>
          )}
        </>
      )}

      {isThinking && (
        <>
          <Text dimColor> | </Text>
          <Text color="magenta">● Thinking...</Text>
          {hasTokens && (
            <>
              <Text dimColor> · </Text>
              <Text>{formatNumber(totalTokens)} tokens</Text>
            </>
          )}
          {hasTime && (
            <>
              <Text dimColor> · </Text>
              <Text>{formatDuration(sessionDuration)}</Text>
            </>
          )}
        </>
      )}

      {isIdleWithTokens && (
        <>
          <Text dimColor> | </Text>
          <Text>{formatNumber(tokenUsage!.inputTokens)} in</Text>
          <Text dimColor> · </Text>
          <Text>{formatNumber(tokenUsage!.outputTokens)} out</Text>
          {hasCost && (
            <>
              <Text dimColor> · </Text>
              <Text color="green">{formatCost(totalCost)}</Text>
            </>
          )}
          {hasTime && (
            <>
              <Text dimColor> · </Text>
              <Text>{formatDuration(sessionDuration)}</Text>
            </>
          )}
        </>
      )}
    </Box>
  );
}
