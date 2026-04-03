import React from "react";
import { Box, Text } from "ink";
import { VERSION } from "../constants/version.js";

export const App: React.FC = () => {
  return (
    <Box flexDirection="column" padding={1}>
      <Text color="green" bold>
        cc-study v{VERSION}
      </Text>
      <Text dimColor>Type a message to start a conversation...</Text>
    </Box>
  );
};
