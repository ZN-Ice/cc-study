/**
 * Command Selector component for slash command autocomplete
 * Pure display component — all keyboard handling is in PromptInput
 */

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { getCommands, getCommandName } from "../commands/index.js";
import type { Command, SubCommand } from "../commands/types.js";

export interface CommandSelectorResult {
  commands: Command[];
  subCommands: SubCommand[];
  currentCommand: Command | null;
  depth: number;
  showSubCommands: boolean;
}

interface CommandSelectorProps {
  readonly filter: string;
  readonly selectedIndex: number;
}

export function resolveCommandFilter(filter: string): CommandSelectorResult {
  const allCommands = getCommands();
  const visibleCommands = allCommands.filter(
    (cmd) => !cmd.isHidden && cmd.userInvocable,
  );

  if (!filter) {
    return { commands: visibleCommands, subCommands: [], currentCommand: null, depth: 0, showSubCommands: false };
  }

  const parts = filter.split(" ").filter((p) => p.length > 0);
  if (parts.length === 0) {
    return { commands: visibleCommands, subCommands: [], currentCommand: null, depth: 0, showSubCommands: false };
  }

  const cmdName = parts[0];
  const cmd = visibleCommands.find(
    (c) => getCommandName(c).toLowerCase() === cmdName.toLowerCase(),
  );

  // No command matched or no sub-commands → filter top-level
  if (!cmd || !cmd.subCommands || cmd.subCommands.length === 0) {
    const filterLower = filter.toLowerCase();
    const filtered = visibleCommands.filter((c) => {
      const name = getCommandName(c).toLowerCase();
      const description = c.description?.toLowerCase() ?? "";
      return name.includes(filterLower) || description.includes(filterLower);
    });
    return { commands: filtered, subCommands: [], currentCommand: null, depth: 0, showSubCommands: false };
  }

  // Walk through filter parts to find the target sub-command level
  let currentSubs = cmd.subCommands;
  let currentCmd: { subCommands?: SubCommand[] } = cmd;
  let depth = 0;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].toLowerCase();
    const matched = currentSubs.find((s) => s.name.toLowerCase() === part);

    if (matched?.subCommands && matched.subCommands.length > 0) {
      currentSubs = matched.subCommands;
      currentCmd = matched;
      depth = i;
    } else {
      const filtered = currentSubs.filter(
        (s) =>
          s.name.toLowerCase().includes(part) ||
          s.description.toLowerCase().includes(part),
      );
      return {
        commands: visibleCommands,
        subCommands: filtered,
        currentCommand: cmd,
        depth: i - 1,
        showSubCommands: true,
      };
    }
  }

  return {
    commands: visibleCommands,
    subCommands: currentSubs,
    currentCommand: cmd,
    depth,
    showSubCommands: true,
  };
}

export const CommandSelector: React.FC<CommandSelectorProps> = ({
  filter,
  selectedIndex,
}) => {
  const result = useMemo(() => resolveCommandFilter(filter), [filter]);

  const { showSubCommands, currentCommand, subCommands, commands, depth } = result;

  // Render sub-commands view
  if (showSubCommands && currentCommand) {
    const displaySubCommands = subCommands.length > 0 ? subCommands : (currentCommand.subCommands || []);

    // Build the path label (e.g., "/memory user")
    const pathParts = [getCommandName(currentCommand)];
    if (depth > 0 && filter) {
      const filterParts = filter.split(" ");
      for (let i = 1; i <= depth && i < filterParts.length; i++) {
        pathParts.push(filterParts[i]);
      }
    }
    const pathLabel = pathParts.join(" ");

    if (displaySubCommands.length === 0) {
      return (
        <Box flexDirection="column" paddingLeft={2}>
          <Text dimColor>/{pathLabel} - no more parameters</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text dimColor>/{pathLabel} parameters:</Text>
        {displaySubCommands.map((sub, index) => {
          const isSelected = index === selectedIndex;
          const hasNested = sub.subCommands && sub.subCommands.length > 0;
          return (
            <Box key={sub.name}>
              <Text color={isSelected ? "green" : undefined} bold={isSelected}>
                {isSelected ? "> " : "  "}
                {sub.name}
              </Text>
              {hasNested && (
                <Text dimColor> →</Text>
              )}
              <Text dimColor> - {sub.description}</Text>
            </Box>
          );
        })}
        <Text dimColor>
          {" "}(↑↓ navigate, Enter select, Esc/Backspace back, Tab complete)
        </Text>
      </Box>
    );
  }

  // Render commands view
  if (commands.length === 0) {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text dimColor>No matching commands</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text dimColor>Available commands:</Text>
      {commands.map((cmd, index) => {
        const name = getCommandName(cmd);
        const isSelected = index === selectedIndex;
        const hasSubCommands = cmd.subCommands && cmd.subCommands.length > 0;
        return (
          <Box key={name}>
            <Text color={isSelected ? "green" : undefined} bold={isSelected}>
              {isSelected ? "> " : "  "}
              /{name}
            </Text>
            {hasSubCommands && (
              <Text dimColor> →</Text>
            )}
            <Text dimColor> - {cmd.description}</Text>
          </Box>
        );
      })}
      <Text dimColor>
        {" "}(↑↓ navigate, Enter select, Esc cancel, Tab complete)
      </Text>
    </Box>
  );
};
