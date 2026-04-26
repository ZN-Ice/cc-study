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
});
