/**
 * PermissionConfirm - Interactive permission confirmation UI.
 *
 * Displays when a tool requires user approval (ask decision).
 * Navigate with Up/Down arrows, confirm with Enter.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface PermissionRequest {
  toolName: string;
  message?: string;
  /** Relevant content (e.g. command or file path) */
  content?: string;
}

interface Option {
  label: string;
  allowed: boolean;
  alwaysAllow: boolean;
}

const OPTIONS: Option[] = [
  { label: "Yes (this time only)", allowed: true, alwaysAllow: false },
  { label: "Always allow", allowed: true, alwaysAllow: true },
  { label: "No (deny)", allowed: false, alwaysAllow: false },
];

interface PermissionConfirmProps {
  request: PermissionRequest;
  onRespond: (allowed: boolean, alwaysAllow: boolean) => void;
}

export const PermissionConfirm: React.FC<PermissionConfirmProps> = ({
  request,
  onRespond,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [answered, setAnswered] = useState(false);

  useInput((_input, key) => {
    if (answered) return;

    if (key.upArrow) {
      setSelectedIndex((i) => (i - 1 + OPTIONS.length) % OPTIONS.length);
    } else if (key.downArrow) {
      setSelectedIndex((i) => (i + 1) % OPTIONS.length);
    } else if (key.return) {
      const opt = OPTIONS[selectedIndex];
      setAnswered(true);
      onRespond(opt.allowed, opt.alwaysAllow);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow">
        Permission Required
      </Text>
      <Text>
        Tool: <Text bold>{request.toolName}</Text>
      </Text>
      {request.content && (
        <Text dimColor>
          {request.content.length > 100
            ? request.content.slice(0, 100) + "..."
            : request.content}
        </Text>
      )}
      {request.message && (
        <Text dimColor>{request.message}</Text>
      )}
      <Box flexDirection="column" marginTop={1}>
        {OPTIONS.map((opt, i) => {
          const isSelected = i === selectedIndex && !answered;
          const color = i === 2 ? "red" : i === 1 ? "green" : undefined;

          return (
            <Box key={i}>
              <Text>{isSelected ? "❯ " : "  "}</Text>
              <Text
                bold={isSelected}
                color={isSelected ? "cyan" : color}
              >
                {opt.label}
              </Text>
            </Box>
          );
        })}
      </Box>
      {!answered && (
        <Box marginTop={1}>
          <Text dimColor>↑↓ navigate · Enter confirm</Text>
        </Box>
      )}
    </Box>
  );
};
