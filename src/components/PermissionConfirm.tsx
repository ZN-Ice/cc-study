/**
 * PermissionConfirm - Interactive permission confirmation UI.
 *
 * Displays when a tool requires user approval (ask decision).
 * Options: [Y]es (once), [A]lways allow, [N]o (deny).
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface PermissionRequest {
  toolName: string;
  message?: string;
  /** Relevant content (e.g. command or file path) */
  content?: string;
}

interface PermissionConfirmProps {
  request: PermissionRequest;
  onRespond: (allowed: boolean, alwaysAllow: boolean) => void;
}

export const PermissionConfirm: React.FC<PermissionConfirmProps> = ({
  request,
  onRespond,
}) => {
  const [answered, setAnswered] = useState(false);

  useInput((input) => {
    if (answered) return;

    const key = input.toLowerCase();
    if (key === "y") {
      setAnswered(true);
      onRespond(true, false);
    } else if (key === "a") {
      setAnswered(true);
      onRespond(true, true);
    } else if (key === "n") {
      setAnswered(true);
      onRespond(false, false);
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
      {!answered ? (
        <Box marginTop={1}>
          <Text>[Y]es </Text>
          <Text color="green">[A]lways allow </Text>
          <Text color="red">[N]o</Text>
        </Box>
      ) : (
        <Text dimColor>Responded.</Text>
      )}
    </Box>
  );
};
