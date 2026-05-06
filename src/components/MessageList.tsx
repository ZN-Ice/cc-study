import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../messages.js";
import { MessageView } from "./MessageView.js";
import { ScrollBox, computeViewportHeight, estimateLines } from "./ScrollBox.js";
import type { ScrollBoxHandle } from "./ScrollBox.js";

interface MessageListProps {
  readonly messages: readonly Message[];
  readonly streamingText: string | null;
  readonly scrollRef: React.Ref<ScrollBoxHandle>;
  /** Sub-agent progress entries rendered inside the scroll area */
  readonly agentProgress?: React.ReactNode;
  /** Permission confirmation dialog rendered inside the scroll area */
  readonly permissionDialog?: React.ReactNode;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  streamingText,
  scrollRef,
  agentProgress,
  permissionDialog,
}) => {
  const isStreaming = streamingText !== null;

  // Estimate total visual rows for sticky scroll tracking
  const perMessageLines = messages.map((msg) => estimateLines(msg));
  const streamingLines = isStreaming ? 3 : 0;
  const totalVisualRows = perMessageLines.reduce((sum, h) => sum + h, 0) + streamingLines;

  const viewportHeight = computeViewportHeight();

  return (
    <ScrollBox
      ref={scrollRef}
      totalRows={totalVisualRows}
      stickyScroll={isStreaming}
      viewportHeight={viewportHeight}
    >
      {messages.map((msg) => (
        <MessageView key={msg.id} message={msg} />
      ))}
      {isStreaming && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="green" bold>[Assistant]</Text>
          <Text>{streamingText}</Text>
        </Box>
      )}
      {agentProgress}
      {permissionDialog}
    </ScrollBox>
  );
};
