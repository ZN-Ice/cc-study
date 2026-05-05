/**
 * Tests for AgentProgress component.
 */

import { describe, test, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { AgentProgress } from "../../../src/components/AgentProgress.js";

describe("AgentProgress", () => {
  test("shows agent type and description", () => {
    const { lastFrame } = render(
      React.createElement(AgentProgress, {
        agentType: "Explore",
        description: "Finding X",
        toolUseCount: 0,
        startTime: Date.now(),
      }),
    );
    const frame = lastFrame();
    expect(frame).toContain("Agent (Explore)");
    expect(frame).toContain("Finding X");
  });

  test("shows tool use count", () => {
    const { lastFrame } = render(
      React.createElement(AgentProgress, {
        agentType: "general-purpose",
        toolUseCount: 3,
        startTime: Date.now(),
      }),
    );
    expect(lastFrame()).toContain("3 tool uses");
  });

  test("shows singular 'tool use' for count of 1", () => {
    const { lastFrame } = render(
      React.createElement(AgentProgress, {
        agentType: "Plan",
        toolUseCount: 1,
        startTime: Date.now(),
      }),
    );
    expect(lastFrame()).toContain("1 tool use");
    expect(lastFrame()).not.toContain("1 tool uses");
  });

  test("works without description", () => {
    const { lastFrame } = render(
      React.createElement(AgentProgress, {
        agentType: "Explore",
        toolUseCount: 0,
        startTime: Date.now(),
      }),
    );
    const frame = lastFrame();
    expect(frame).toContain("Agent (Explore)");
    // No colon after type when no description
    expect(frame).not.toContain("Agent (Explore):");
  });

  // --- tokenCount & model optional props ---

  test("shows token count when provided", () => {
    const { lastFrame } = render(
      React.createElement(AgentProgress, {
        agentType: "Explore",
        toolUseCount: 2,
        startTime: Date.now(),
        tokenCount: 1500,
      }),
    );
    expect(lastFrame()).toContain("1,500 tokens");
  });

  test("does not show token count when not provided", () => {
    const { lastFrame } = render(
      React.createElement(AgentProgress, {
        agentType: "Explore",
        toolUseCount: 0,
        startTime: Date.now(),
      }),
    );
    expect(lastFrame()).not.toContain("tokens");
  });

  test("shows model when provided", () => {
    const { lastFrame } = render(
      React.createElement(AgentProgress, {
        agentType: "general-purpose",
        toolUseCount: 1,
        startTime: Date.now(),
        model: "claude-sonnet-4-6",
      }),
    );
    expect(lastFrame()).toContain("claude-sonnet-4-6");
  });

  test("does not show model when not provided", () => {
    const { lastFrame } = render(
      React.createElement(AgentProgress, {
        agentType: "Explore",
        toolUseCount: 0,
        startTime: Date.now(),
      }),
    );
    // The stats line should only contain tool uses and time — no model string
    const frame = lastFrame();
    expect(frame).not.toContain("claude");
    expect(frame).not.toContain("sonnet");
  });

  test("shows both token count and model when both provided", () => {
    const { lastFrame } = render(
      React.createElement(AgentProgress, {
        agentType: "Plan",
        toolUseCount: 5,
        startTime: Date.now(),
        tokenCount: 8200,
        model: "claude-sonnet-4-6",
      }),
    );
    const frame = lastFrame();
    expect(frame).toContain("8,200 tokens");
    expect(frame).toContain("claude-sonnet-4-6");
  });

  test("formats large token count correctly", () => {
    const { lastFrame } = render(
      React.createElement(AgentProgress, {
        agentType: "general-purpose",
        toolUseCount: 10,
        startTime: Date.now(),
        tokenCount: 12345,
      }),
    );
    expect(lastFrame()).toContain("12,345 tokens");
  });
});
