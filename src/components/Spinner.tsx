import React, { useState, useEffect } from "react";
import { Text } from "ink";

interface SpinnerProps {
  readonly mode: "thinking" | "responding" | "executing";
  /** Tool names currently being executed */
  readonly toolNames?: readonly string[];
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

const LABELS: Record<SpinnerProps["mode"], string> = {
  thinking: "Thinking",
  responding: "Responding",
  executing: "Executing",
};

export const Spinner: React.FC<SpinnerProps> = ({ mode, toolNames }) => {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % FRAMES.length);
    }, INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  const label = LABELS[mode];
  const toolSuffix = toolNames && toolNames.length > 0
    ? ` ${toolNames.join(", ")}`
    : "";

  return (
    <Text>
      <Text color="green">{FRAMES[frameIndex]}</Text>
      <Text dimColor> {label}{toolSuffix}...</Text>
    </Text>
  );
};
