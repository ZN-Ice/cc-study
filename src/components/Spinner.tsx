import React, { useState, useEffect } from "react";
import { Text } from "ink";

interface SpinnerProps {
  readonly mode: "thinking" | "responding";
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

const LABELS: Record<SpinnerProps["mode"], string> = {
  thinking: "Thinking",
  responding: "Responding",
};

export const Spinner: React.FC<SpinnerProps> = ({ mode }) => {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % FRAMES.length);
    }, INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  return (
    <Text>
      <Text color="green">{FRAMES[frameIndex]}</Text>
      <Text dimColor> {LABELS[mode]}...</Text>
    </Text>
  );
};
