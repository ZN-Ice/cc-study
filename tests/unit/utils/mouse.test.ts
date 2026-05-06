import { describe, test, expect } from "vitest";
import { parseSGRMouse, parseSGRMouseAll } from "../../../src/utils/mouse.js";

const ESC = "\x1b";

describe("parseSGRMouse", () => {
  test("parses wheel up event", () => {
    // button=64 (0x40, wheel up), col=10, row=5
    const result = parseSGRMouse(`${ESC}[<64;10;5M`);
    expect(result).toEqual({ type: "wheel", direction: "up" });
  });

  test("parses wheel down event", () => {
    // button=65 (0x41, wheel down), col=10, row=5
    const result = parseSGRMouse(`${ESC}[<65;10;5M`);
    expect(result).toEqual({ type: "wheel", direction: "down" });
  });

  test("parses left click", () => {
    // button=0 (left click press), col=20, row=3
    const result = parseSGRMouse(`${ESC}[<0;20;3M`);
    expect(result).toEqual({
      type: "click",
      event: { button: 0, action: "press", col: 20, row: 3 },
    });
  });

  test("parses mouse release", () => {
    // button=0, col=20, row=3, 'm' = release
    const result = parseSGRMouse(`${ESC}[<0;20;3m`);
    expect(result).toEqual({
      type: "release",
      event: { button: 0, action: "release", col: 20, row: 3 },
    });
  });

  test("parses drag/motion event", () => {
    // button=32 (0x20, motion bit set), col=15, row=8
    const result = parseSGRMouse(`${ESC}[<32;15;8M`);
    expect(result).toEqual({
      type: "drag",
      event: { button: 32, action: "press", col: 15, row: 8 },
    });
  });

  test("returns null for non-mouse input", () => {
    expect(parseSGRMouse("hello")).toBeNull();
    expect(parseSGRMouse(`${ESC}[A`)).toBeNull(); // up arrow
    expect(parseSGRMouse("")).toBeNull();
  });
});

describe("parseSGRMouseAll", () => {
  test("parses single event", () => {
    const results = parseSGRMouseAll(`${ESC}[<64;10;5M`);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ type: "wheel", direction: "up" });
  });

  test("parses multiple concatenated events", () => {
    // Two wheel events in one chunk (common during fast scrolling)
    const chunk = `${ESC}[<64;10;5M${ESC}[<65;10;6M`;
    const results = parseSGRMouseAll(chunk);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ type: "wheel", direction: "up" });
    expect(results[1]).toEqual({ type: "wheel", direction: "down" });
  });

  test("parses mixed event types", () => {
    const chunk = `${ESC}[<0;20;3M${ESC}[<32;21;3M${ESC}[<0;21;3m`;
    const results = parseSGRMouseAll(chunk);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      type: "click",
      event: { button: 0, action: "press", col: 20, row: 3 },
    });
    expect(results[1]).toEqual({
      type: "drag",
      event: { button: 32, action: "press", col: 21, row: 3 },
    });
    expect(results[2]).toEqual({
      type: "release",
      event: { button: 0, action: "release", col: 21, row: 3 },
    });
  });

  test("returns empty array for non-mouse input", () => {
    expect(parseSGRMouseAll("hello world")).toEqual([]);
    expect(parseSGRMouseAll("")).toEqual([]);
  });

  test("handles Buffer-like data (escape sequences with control chars)", () => {
    // Simulate what stdin.read() might return: mouse events interleaved
    // with other terminal data
    const chunk = `some noise${ESC}[<64;10;5Mmore noise`;
    const results = parseSGRMouseAll(chunk);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ type: "wheel", direction: "up" });
  });
});
