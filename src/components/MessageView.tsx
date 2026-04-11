import React from "react";
import { Box, Text } from "ink";
import type { Message, ContentBlock } from "../messages.js";

interface MessageProps {
  readonly message: Message;
}

/** Render a single content block */
function ContentBlockView({ block }: { readonly block: ContentBlock }): React.ReactElement {
  switch (block.type) {
    case "text":
      return <Text>{block.text}</Text>;
    case "tool_use":
      return (
        <Box flexDirection="column" marginLeft={2}>
          <Text color="yellow">
            [Tool: {block.name}]
          </Text>
          <Text dimColor>{JSON.stringify(block.input, null, 2)}</Text>
        </Box>
      );
    case "tool_result":
      return (
        <Box marginLeft={2}>
          <Text color={block.is_error ? "red" : "blue"}>
            [Result{block.is_error ? " (error)" : ""}]: {block.content}
          </Text>
        </Box>
      );
    case "thinking":
      return <Text dimColor italic>[thinking...]</Text>;
  }
}

/** Render a single message */
export const MessageView: React.FC<MessageProps> = ({ message }) => {
  const label = message.type === "user" ? "You" : "Assistant";
  const color = message.type === "user" ? "cyan" : "green";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color} bold>
        [{label}]
      </Text>
      {message.content.map((block, i) => (
        <ContentBlockView key={i} block={block} />
      ))}
    </Box>
  );
};
