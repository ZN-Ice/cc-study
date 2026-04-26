import React, { useCallback, useState, useMemo, useRef, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { CommandSelector, resolveCommandFilter } from "./CommandSelector.js";
import { findCommand } from "../commands/index.js";
import type { SubCommand } from "../commands/types.js";

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
  const [cursorOffset, setCursorOffset] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectorVisibleRef = useRef(false);

  const cursorPos = value.length - cursorOffset;

  // Derive the command filter from value
  const commandFilter = useMemo(() => {
    if (!value.startsWith("/")) return "";
    return value.slice(1);
  }, [value]);

  // Resolve what the selector should show
  const selectorResult = useMemo(
    () => resolveCommandFilter(commandFilter),
    [commandFilter],
  );

  // Determine if selector should be visible
  const showCommandSelector = useMemo(() => {
    if (!value.startsWith("/")) return false;

    // No space → show top-level commands
    if (!value.includes(" ")) return true;

    // Has space → show only if current level has sub-commands
    return selectorResult.showSubCommands;
  }, [value, selectorResult]);

  // Sync ref for immediate useInput response
  useEffect(() => {
    selectorVisibleRef.current = showCommandSelector;
  }, [showCommandSelector]);

  // Reset selected index when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [commandFilter]);

  const handleChange = useCallback(
    (newValue: string, newCursorOffset = 0) => {
      onChange(newValue);
      setCursorOffset(newCursorOffset);
    },
    [onChange],
  );

  // --- Command selection helpers ---

  const getDisplayList = useCallback(() => {
    if (selectorResult.showSubCommands) {
      return selectorResult.subCommands.length > 0
        ? selectorResult.subCommands
        : (selectorResult.currentCommand?.subCommands ?? []);
    }
    return selectorResult.commands;
  }, [selectorResult]);

  const selectItem = useCallback(
    (index: number) => {
      const list = getDisplayList();
      if (index < 0 || index >= list.length) return;

      if (selectorResult.showSubCommands) {
        // Selecting a sub-command
        const sub = selectorResult.subCommands.length > 0
          ? selectorResult.subCommands[index]
          : (selectorResult.currentCommand?.subCommands ?? [])[index];
        if (!sub) return;

        // Build full path from filter + selected sub-command name
        const parts = commandFilter.split(" ").filter((p) => p.length > 0);
        const pathParts = parts.length > 0 ? [`/${parts[0]}`, ...parts.slice(1)] : [];
        const fullPath = [...pathParts, sub.name].join(" ");

        onChange(fullPath + " ");
        setCursorOffset(0);

        // Check if this sub-command has nested sub-commands
        if (!sub.subCommands || sub.subCommands.length === 0) {
          // No more levels → close selector
          selectorVisibleRef.current = false;
        }
        // Otherwise keep selector open to show next level
      } else {
        // Selecting a top-level command
        const cmd = selectorResult.commands[index];
        if (!cmd) return;
        const name = cmd.name;
        onChange(`/${name} `);
        setCursorOffset(0);

        // Check if command has sub-commands
        if (!cmd.subCommands || cmd.subCommands.length === 0) {
          selectorVisibleRef.current = false;
        }
      }
    },
    [selectorResult, commandFilter, onChange, getDisplayList],
  );

  const goBack = useCallback(
    (depth: number = 1) => {
      if (!value.startsWith("/")) return;
      const parts = value.split(" ");
      const keep = Math.max(1, parts.length - depth);
      const newValue = parts.slice(0, keep).join(" ") + (keep < parts.length ? " " : "");
      onChange(newValue);
    },
    [value, onChange],
  );

  const cancelSelection = useCallback(() => {
    onChange("");
    setCursorOffset(0);
    selectorVisibleRef.current = false;
  }, [onChange]);

  // --- Keyboard handling (single useInput, no conflicts) ---

  useInput((input, key) => {
    if (isLoading) return;

    const isSelectorVisible = selectorVisibleRef.current;
    const list = isSelectorVisible ? getDisplayList() : [];
    const listLength = list.length;

    // === Selector visible: handle all navigation ===
    if (isSelectorVisible) {
      if (key.upArrow) {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : listLength - 1));
        return;
      }

      if (key.downArrow) {
        setSelectedIndex((prev) => (prev < listLength - 1 ? prev + 1 : 0));
        return;
      }

      if (key.return) {
        if (listLength > 0 && selectedIndex < listLength) {
          selectItem(selectedIndex);
        } else {
          // No items or invalid index → submit raw value
          if (value.trim()) {
            onSubmit(value);
            setCursorOffset(0);
          }
        }
        return;
      }

      if (key.escape) {
        if (selectorResult.showSubCommands) {
          goBack(selectorResult.depth ?? 0);
        } else {
          cancelSelection();
        }
        return;
      }

      if (input === "\t") {
        if (listLength > 0 && selectedIndex < listLength) {
          selectItem(selectedIndex);
        }
        return;
      }

      if (key.backspace) {
        if (selectorResult.showSubCommands) {
          // In sub-command mode → go back one level
          goBack(1);
        } else {
          // In command mode → delete character
          if (cursorPos > 0) {
            const newValue = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
            handleChange(newValue, cursorOffset);
          }
        }
        return;
      }

      // Regular characters → fall through to update value (filters the list)
    }

    // === Normal input handling ===

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

    if (key.ctrl && input === "a") {
      setCursorOffset(value.length);
      return;
    }

    if (key.ctrl && input === "e") {
      setCursorOffset(0);
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        const newValue = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
        handleChange(newValue, cursorOffset);
      }
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      const newValue = value.slice(0, cursorPos) + input + value.slice(cursorPos);
      handleChange(newValue, cursorOffset);
    }
  });

  // Split value for cursor rendering
  const beforeCursor = value.slice(0, cursorPos);
  const cursorChar = value[cursorPos] ?? " ";
  const afterCursor = value.slice(cursorPos + 1);

  return (
    <Box flexDirection="column">
      {showCommandSelector && (
        <CommandSelector
          filter={commandFilter}
          selectedIndex={selectedIndex}
        />
      )}
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
    </Box>
  );
};
