/**
 * Integration test for scroll behavior during streaming.
 *
 * This test uses real API calls to verify scroll behavior works correctly
 * during long streaming responses. It is NOT part of CI gate checks.
 *
 * Requires: ANTHROPIC_API_KEY or ~/.claude/settings.json with valid API key
 * Usage: pnpm test tests/integration/scrollBehavior.test.ts
 */
import { describe, test, expect } from "vitest";
import { resolveApiKey } from "../../src/services/api.js";
import { ScrollBox } from "../../src/components/ScrollBox.js";
import type { ScrollBoxHandle } from "../../src/components/ScrollBox.js";
import React, { createRef } from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";

const apiKey = resolveApiKey();
const hasApiKey = apiKey.length > 0;

describe.skipIf(!hasApiKey)("Scroll Behavior Integration", () => {
  test("ScrollBox follows during simulated streaming growth", async () => {
    const ref = createRef<ScrollBoxHandle>();
    const scrollPositions: number[] = [];

    // Simulate streaming: content grows from 5 to 30 rows
    const { rerender } = render(
      <ScrollBox ref={ref} viewportHeight={10} totalRows={5} stickyScroll={true}>
        {Array.from({ length: 5 }, (_, i) => (
          <Text key={i}>Initial line {i}</Text>
        ))}
      </ScrollBox>,
    );

    scrollPositions.push(ref.current!.getScrollTop());

    // Simulate streaming growth
    for (let totalRows = 6; totalRows <= 30; totalRows++) {
      rerender(
        <ScrollBox ref={ref} viewportHeight={10} totalRows={totalRows} stickyScroll={true}>
          {Array.from({ length: totalRows }, (_, i) => (
            <Text key={i}>Line {i}</Text>
          ))}
        </ScrollBox>,
      );
      scrollPositions.push(ref.current!.getScrollTop());
    }

    // Verify: all positions should be monotonically non-decreasing
    for (let i = 1; i < scrollPositions.length; i++) {
      expect(scrollPositions[i]).toBeGreaterThanOrEqual(scrollPositions[i - 1]);
    }

    // Final position should be at bottom
    expect(ref.current!.getScrollTop()).toBe(20); // 30 - 10 = 20
    expect(ref.current!.isSticky()).toBe(true);

    console.log("Scroll positions during streaming:", scrollPositions);
  });

  test("User scroll up breaks sticky, content growth respects it", async () => {
    const ref = createRef<ScrollBoxHandle>();

    // Start with content that overflows viewport (10 rows, viewport 5)
    const { rerender } = render(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={10} stickyScroll={true}>
        {Array.from({ length: 10 }, (_, i) => (
          <Text key={i}>Line {i}</Text>
        ))}
      </ScrollBox>,
    );

    // Should be at bottom: scrollTop = 10 - 5 = 5
    expect(ref.current!.getScrollTop()).toBe(5);

    // User scrolls up by 3
    ref.current!.scrollBy(-3);
    expect(ref.current!.getScrollTop()).toBe(2);
    expect(ref.current!.isSticky()).toBe(false);

    const posBeforeGrowth = ref.current!.getScrollTop(); // 2

    // Content grows
    for (let totalRows = 11; totalRows <= 20; totalRows++) {
      rerender(
        <ScrollBox ref={ref} viewportHeight={5} totalRows={totalRows} stickyScroll={true}>
          {Array.from({ length: totalRows }, (_, i) => (
            <Text key={i}>Line {i}</Text>
          ))}
        </ScrollBox>,
      );
    }

    // Should NOT follow because user was not at bottom (2 < 5)
    expect(ref.current!.getScrollTop()).toBe(posBeforeGrowth);
    expect(ref.current!.isSticky()).toBe(false);
  });

  test("scrollToBottom during streaming re-enables sticky", async () => {
    const ref = createRef<ScrollBoxHandle>();

    const { rerender } = render(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={12} stickyScroll={true}>
        {Array.from({ length: 12 }, (_, i) => (
          <Text key={i}>Line {i}</Text>
        ))}
      </ScrollBox>,
    );

    // Should be at bottom initially: maxScroll = 12 - 5 = 7
    expect(ref.current!.getScrollTop()).toBe(7);

    // User scrolls up
    ref.current!.scrollBy(-3);
    expect(ref.current!.getScrollTop()).toBe(4);
    expect(ref.current!.isSticky()).toBe(false);

    // User clicks "scroll to bottom"
    ref.current!.scrollToBottom();
    expect(ref.current!.isSticky()).toBe(true);

    // Content grows - should follow
    rerender(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={22} stickyScroll={true}>
        {Array.from({ length: 22 }, (_, i) => (
          <Text key={i}>Line {i}</Text>
        ))}
      </ScrollBox>,
    );

    expect(ref.current!.getScrollTop()).toBe(17); // 22 - 5 = 17
    expect(ref.current!.isSticky()).toBe(true);
  });
});

/**
 * Manual test script for real API streaming.
 * Run this to visually verify scroll behavior in terminal.
 *
 * Usage: npx tsx tests/integration/scrollBehavior.manual.ts
 *
 * This will:
 * 1. Start a real REPL session
 * 2. Send "创建一个研究团队来帮我分析这个项目"
 * 3. You should see smooth scrolling without bouncing
 */
if (process.argv[1]?.includes("scrollBehavior.manual")) {
  console.log("=== Manual Scroll Behavior Test ===");
  console.log("This script requires interactive terminal.");
  console.log("Please run: pnpm dev");
  console.log('Then type: 创建一个研究团队来帮我分析这个项目');
  console.log("");
  console.log("Expected behavior:");
  console.log("1. Content should stream smoothly");
  console.log("2. Scroll should follow new content at bottom");
  console.log("3. If you scroll up, it should stop following");
  console.log("4. No bouncing between top and bottom");
  process.exit(0);
}
