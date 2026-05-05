import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { Message } from "../messages.js";
import { MessageView } from "./MessageView.js";

interface MessageListProps {
  readonly messages: readonly Message[];
  readonly streamingText: string | null;
  readonly pageSize?: number;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  streamingText,
  pageSize = 20,
}) => {
  const [showAll, setShowAll] = useState(false);
  const totalCount = messages.length;
  const isStreaming = streamingText !== null;

  useEffect(() => {
    if (isStreaming) {
      setShowAll(false);
    }
  }, [isStreaming]);

  let visibleMessages: readonly Message[];
  let hiddenCount = 0;

  if (totalCount <= pageSize || showAll) {
    visibleMessages = messages;
  } else {
    visibleMessages = messages.slice(-pageSize);
    hiddenCount = totalCount - pageSize;
  }

  return (
    <Box flexDirection="column">
      {visibleMessages.map((msg) => (
        <MessageView key={msg.id} message={msg} />
      ))}
      {isStreaming && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="green" bold>[Assistant]</Text>
          <Text>{streamingText}</Text>
        </Box>
      )}
      {totalCount > pageSize && !isStreaming && (
        <Box marginTop={1}>
          {showAll ? (
            <Text dimColor>
              ─── showing all {totalCount} messages ───
            </Text>
          ) : (
            <Text dimColor>
              ─── {hiddenCount} more messages ─── [Show All] ───
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};
