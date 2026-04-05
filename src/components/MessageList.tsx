import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../messages.js";
import { MessageView } from "./MessageView.js";

interface MessageListProps {
  readonly messages: readonly Message[];
  readonly streamingText: string | null;
}

export const MessageList: React.FC<MessageListProps> = ({ messages, streamingText }) => {
  return (
    <Box flexDirection="column">
      {messages.map((msg) => (
        <MessageView key={msg.id} message={msg} />
      ))}
      {streamingText && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="green" bold>[Assistant]</Text>
          <Text>{streamingText}</Text>
        </Box>
      )}
    </Box>
  );
};
