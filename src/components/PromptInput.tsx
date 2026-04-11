import React from "react";
import { Box, Text, useInput } from "ink";

interface PromptInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
  readonly isLoading: boolean;
  readonly placeholder?: string;
}

export const PromptInput: React.FC<PromptInputProps> = ({
  value,
  onChange,
  onSubmit,
  isLoading,
  placeholder = "Type a message...",
}) => {
  useInput((input, key) => {
    if (isLoading) return;

    if (key.return) {
      if (value.trim()) {
        onSubmit(value);
      }
      return;
    }

    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      onChange(value + input);
    }
  });

  return (
    <Box>
      <Text color="green" bold>{"> "}</Text>
      {isLoading ? (
        <Text dimColor>Waiting for response...</Text>
      ) : value ? (
        <Text>{value}</Text>
      ) : (
        <Text dimColor>{placeholder}</Text>
      )}
    </Box>
  );
};
