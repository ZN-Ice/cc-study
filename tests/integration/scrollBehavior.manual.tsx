/**
 * Manual test script for verifying scroll behavior during streaming.
 *
 * This script is NOT run by CI. It's for manual visual verification.
 *
 * Usage:
 *   pnpm dev
 *   Then type: 创建一个研究团队来帮我分析这个项目
 *
 * Expected behavior:
 * 1. Content streams smoothly without bouncing
 * 2. Scroll follows new content at bottom
 * 3. If you scroll up (↑), it should stop following
 * 4. If you scroll to bottom (↓ to end), it should resume following
 * 5. No visual jitter or position jumping
 *
 * What to watch for:
 * - The scroll position should move smoothly DOWN as content streams
 * - It should NOT jump back and forth between top and bottom
 * - When you manually scroll up, the auto-follow should stop
 * - When you scroll back to bottom, auto-follow should resume
 */

console.log(`
╔══════════════════════════════════════════════════════════════╗
║         Scroll Behavior Manual Test Instructions            ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  1. Run: pnpm dev                                            ║
║                                                              ║
║  2. Type this message and press Enter:                       ║
║     创建一个研究团队来帮我分析这个项目                        ║
║                                                              ║
║  3. Observe the scrolling behavior:                          ║
║     ✓ Content should stream smoothly                         ║
║     ✓ Scroll should follow at bottom                         ║
║     ✓ No bouncing between top/bottom                         ║
║                                                              ║
║  4. Test manual scroll:                                      ║
║     - Press ↑ to scroll up → should stop following           ║
║     - Press ↓ repeatedly to go back to bottom                ║
║     - Should resume following when at bottom                 ║
║                                                              ║
║  5. Test during active streaming:                            ║
║     - Scroll up while content is streaming                   ║
║     - Should NOT jump back to bottom                         ║
║     - Content should continue streaming at your position     ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

// Test the ScrollBox in isolation
import React, { createRef } from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { ScrollBox } from "../../src/components/ScrollBox.js";
import type { ScrollBoxHandle } from "../../src/components/ScrollBox.js";

async function runIsolatedTest() {
  console.log("Running isolated ScrollBox test...\n");

  const ref = createRef<ScrollBoxHandle>();
  const positions: number[] = [];

  const { rerender, unmount } = render(
    <ScrollBox ref={ref} viewportHeight={5} totalRows={5} stickyScroll={true}>
      {Array.from({ length: 5 }, (_, i) => (
        <Text key={i}>Line {i}</Text>
      ))}
    </ScrollBox>,
  );

  positions.push(ref.current!.getScrollTop());
  console.log(`Initial position: ${ref.current!.getScrollTop()}`);

  // Simulate streaming
  for (let i = 6; i <= 15; i++) {
    rerender(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={i} stickyScroll={true}>
        {Array.from({ length: i }, (_, j) => (
          <Text key={j}>Line {j}</Text>
        ))}
      </ScrollBox>,
    );
    positions.push(ref.current!.getScrollTop());
  }

  console.log(`Final position: ${ref.current!.getScrollTop()}`);
  console.log(`Positions: [${positions.join(", ")}]`);

  // Check for bouncing
  let hasBouncing = false;
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] < positions[i - 1]) {
      hasBouncing = true;
      console.log(`❌ Bouncing detected at index ${i}: ${positions[i - 1]} -> ${positions[i]}`);
    }
  }

  if (!hasBouncing) {
    console.log("✅ No bouncing detected - scroll follows smoothly!");
  } else {
    console.log("❌ Bouncing detected - scroll is not working correctly");
  }

  unmount();
}

runIsolatedTest().catch(console.error);
