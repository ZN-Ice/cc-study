import React from "react";
import { Box, Text } from "ink";
import type { Message, ContentBlock, ToolResultBlock, ToolUseBlock } from "../messages.js";

// ──────────────────────────────────────────────
// Tool Use Display
// ──────────────────────────────────────────────

const MAX_PREVIEW = 60;

/** Truncate a string for inline preview */
function truncate(s: string, max = MAX_PREVIEW): string {
  const oneLine = s.replace(/\n/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "..." : oneLine;
}

/** Format tool_use input as a human-readable one-liner */
function formatToolUseLabel(block: ToolUseBlock): string {
  const input = block.input;
  switch (block.name) {
    case "Read": {
      const path = (input.file_path as string) ?? "?";
      const offset = input.offset as number | undefined;
      const limit = input.limit as number | undefined;
      const range = offset || limit ? ` (lines ${offset ?? 1}${limit ? `-${(offset ?? 1) + limit - 1}` : "+"})` : "";
      return `Read: ${path}${range}`;
    }
    case "Write": {
      const path = (input.file_path as string) ?? "?";
      const content = (input.content as string) ?? "";
      const lines = content.split("\n").length;
      return `Write: ${path} (${lines} lines)`;
    }
    case "Edit": {
      const path = (input.file_path as string) ?? "?";
      const oldStr = (input.old_string as string) ?? "";
      return `Edit: ${path} — ${truncate(oldStr, 40)}`;
    }
    case "Bash": {
      const cmd = (input.command as string) ?? "";
      return `Bash: ${truncate(cmd, 50)}`;
    }
    case "Glob": {
      const pattern = (input.pattern as string) ?? "";
      return `Glob: ${pattern}`;
    }
    case "Grep": {
      const pattern = (input.pattern as string) ?? "";
      return `Grep: "${pattern}"`;
    }
    case "Agent": {
      const desc = (input.description as string) ?? "";
      const type = (input.subagent_type as string) ?? "general-purpose";
      return `Agent (${type}): ${truncate(desc, 40)}`;
    }
    default:
      return `${block.name}: ${truncate(JSON.stringify(input), 50)}`;
  }
}

/** Render a tool_use block */
function ToolUseDisplay({ block }: { readonly block: ToolUseBlock }): React.ReactElement {
  const label = formatToolUseLabel(block);
  return (
    <Box marginLeft={1}>
      <Text color="yellow">{"  "}▸ {label}</Text>
    </Box>
  );
}

// ──────────────────────────────────────────────
// Tool Result Display
// ──────────────────────────────────────────────

/** Format duration in seconds */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Format a tool_result block with structured display */
function ToolResultDisplay({ block }: { readonly block: ToolResultBlock }): React.ReactElement {
  const toolName = block.tool_name;
  const meta = block.metadata;

  // Error results: red with message
  if (block.is_error) {
    return (
      <Box marginLeft={1} flexDirection="column">
        <Text color="red">{"  "}✗ {block.content.split("\n")[0]}</Text>
      </Box>
    );
  }

  // Tool-specific rendering
  switch (toolName) {
    case "Read": {
      const lines = (meta?.shownLines as number) ?? "?";
      return (
        <Box marginLeft={1} flexDirection="column">
          <Text color="cyan">{"  "}📄 {block.content.split("\n")[0]}</Text>
          <Text dimColor>{"  "}(showing {lines} lines)</Text>
        </Box>
      );
    }
    case "Write": {
      const path = (meta?.path as string) ?? "";
      const action = (meta?.action as string) ?? "write";
      const lines = (meta?.lines as number) ?? 0;
      const verb = action === "create" ? "Created" : "Updated";
      return (
        <Box marginLeft={1}>
          <Text color="green">{"  "}✓ {verb}: {path} ({lines} lines)</Text>
        </Box>
      );
    }
    case "Edit": {
      const path = (meta?.path as string) ?? "";
      const replacements = (meta?.replacements as number) ?? 1;
      return (
        <Box marginLeft={1}>
          <Text color="green">{"  "}✓ Edited: {path} ({replacements} replacement{replacements > 1 ? "s" : ""})</Text>
        </Box>
      );
    }
    case "Bash": {
      const cmd = (meta?.command as string) ?? "";
      const duration = (meta?.durationMs as number) ?? 0;
      const lines = block.content.split("\n").length;
      const preview = truncate(block.content, 80);
      return (
        <Box marginLeft={1} flexDirection="column">
          <Text color="cyan">{"  "}⚡ {truncate(cmd, 50)} — {formatDuration(duration)}</Text>
          {lines <= 3 ? (
            <Text dimColor>{"  "}{preview}</Text>
          ) : (
            <Text dimColor>{"  "}{preview} ({lines} lines)</Text>
          )}
        </Box>
      );
    }
    case "Glob": {
      const count = (meta?.count as number) ?? 0;
      const truncated = meta?.truncated as boolean | undefined;
      return (
        <Box marginLeft={1}>
          <Text color="cyan">{"  "}📁 {count} file{count !== 1 ? "s" : ""} found{truncated ? " (truncated)" : ""}</Text>
        </Box>
      );
    }
    case "Grep": {
      const count = (meta?.count as number) ?? 0;
      const pattern = (meta?.pattern as string) ?? "";
      return (
        <Box marginLeft={1}>
          <Text color="cyan">{"  "}🔍 "{pattern}" — {count} match{count !== 1 ? "es" : ""}</Text>
        </Box>
      );
    }
    case "Agent": {
      const agentType = (meta?.agentType as string) ?? "agent";
      const toolUseCount = (meta?.toolUseCount as number) ?? 0;
      const durationMs = (meta?.durationMs as number) ?? 0;
      const preview = truncate(block.content, 80);
      return (
        <Box marginLeft={1} flexDirection="column">
          <Text color="magenta">{"  "}🤖 {agentType} — {toolUseCount} tool use{toolUseCount !== 1 ? "s" : ""} · {formatDuration(durationMs)}</Text>
          <Text dimColor>{"  "}{preview}</Text>
        </Box>
      );
    }
    default: {
      // Fallback: show truncated content
      return (
        <Box marginLeft={1}>
          <Text color="blue">{"  "}{truncate(block.content, 100)}</Text>
        </Box>
      );
    }
  }
}

// ──────────────────────────────────────────────
// Content Block View (dispatch)
// ──────────────────────────────────────────────

/** Render a single content block */
function ContentBlockView({ block }: { readonly block: ContentBlock }): React.ReactElement {
  switch (block.type) {
    case "text":
      return <Text>{block.text}</Text>;
    case "tool_use":
      return <ToolUseDisplay block={block} />;
    case "tool_result":
      return <ToolResultDisplay block={block} />;
    case "thinking":
      return <Text dimColor italic>[thinking...]</Text>;
  }
}

// ──────────────────────────────────────────────
// Message View
// ──────────────────────────────────────────────

interface MessageProps {
  readonly message: Message;
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
