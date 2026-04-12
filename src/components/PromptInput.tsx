import React, { useCallback, useState } from "react";
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
  // cursorOffset: distance from the end of the string (0 = after last char)
  const [cursorOffset, setCursorOffset] = useState(0);

  const cursorPos = value.length - cursorOffset;

  const handleChange = useCallback(
    (newValue: string, newCursorOffset = 0) => {
      onChange(newValue);
      setCursorOffset(newCursorOffset);
    },
    [onChange],
  );

  useInput((input, key) => {
    if (isLoading) return;

    if (key.return) {
      if (value.trim()) {
        onSubmit(value);
        setCursorOffset(0);
      }
      return;
    }

    if (key.leftArrow) {
      if (cursorPos > 0) {
        setCursorOffset(cursorOffset + 1);
      }
      return;
    }

    if (key.rightArrow) {
      if (cursorOffset > 0) {
        setCursorOffset(cursorOffset - 1);
      }
      return;
    }

    // Home: move cursor to start
    if (key.ctrl && input === "a") {
      setCursorOffset(value.length);
      return;
    }

    // End: move cursor to end
    if (key.ctrl && input === "e") {
      setCursorOffset(0);
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        handleChange(
          value.slice(0, cursorPos - 1) + value.slice(cursorPos),
          cursorOffset,
        );
      }
      return;
    }

    // Regular character input — insert at cursor position
    if (input && !key.ctrl && !key.meta) {
      handleChange(
        value.slice(0, cursorPos) + input + value.slice(cursorPos),
        cursorOffset,
      );
    }
  });

  // Split value into before-cursor and after-cursor for rendering
  const beforeCursor = value.slice(0, cursorPos);
  const cursorChar = value[cursorPos] ?? " ";
  const afterCursor = value.slice(cursorPos + 1);

  return (
    <Box>
      <Text color="green" bold>{"> "}</Text>
      {isLoading ? (
        <Text dimColor>Waiting for response...</Text>
      ) : value ? (
        <Text>
          {beforeCursor}
          <Text inverse bold>{cursorChar}</Text>
          {afterCursor}
        </Text>
      ) : (
        <Text dimColor>{placeholder}</Text>
      )}
    </Box>
  );
};
