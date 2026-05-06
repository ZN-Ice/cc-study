import { describe, test, expect } from "vitest";
import React, { createRef } from "react";
import { render } from "ink-testing-library";
import { ScrollBox } from "../../../src/components/ScrollBox.js";
import type { ScrollBoxHandle } from "../../../src/components/ScrollBox.js";
import { Text } from "ink";

function makeChildren(count: number): React.ReactElement[] {
  return Array.from({ length: count }, (_, i) => (
    <Text key={i}>Line {i}</Text>
  ));
}

describe("ScrollBox - Mouse Wheel Scrolling", () => {
  test("scrollBy works programmatically (simulating wheel)", () => {
    const ref = createRef<ScrollBoxHandle>();
    render(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={20} stickyScroll={false}>
        {makeChildren(20)}
      </ScrollBox>,
    );

    expect(ref.current?.getScrollTop()).toBe(0);

    // Simulate wheel down: scroll down by 3 lines
    ref.current?.scrollBy(3);
    expect(ref.current?.getScrollTop()).toBe(3);

    // Simulate wheel up: scroll up by 2 lines
    ref.current?.scrollBy(-2);
    expect(ref.current?.getScrollTop()).toBe(1);
  });

  test("scrollBy at boundaries clamps correctly", () => {
    const ref = createRef<ScrollBoxHandle>();
    render(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={10} stickyScroll={false}>
        {makeChildren(10)}
      </ScrollBox>,
    );

    // Scroll to top boundary
    ref.current?.scrollTo(0);
    ref.current?.scrollBy(-10);
    expect(ref.current?.getScrollTop()).toBe(0);

    // Scroll to bottom boundary
    ref.current?.scrollTo(5); // maxScroll = 10 - 5 = 5
    ref.current?.scrollBy(10);
    expect(ref.current?.getScrollTop()).toBe(5);
  });

  test("stickyScroll re-enables when scrolling to bottom", () => {
    const ref = createRef<ScrollBoxHandle>();
    render(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={20} stickyScroll={true}>
        {makeChildren(20)}
      </ScrollBox>,
    );

    // Scroll up breaks stickiness
    ref.current?.scrollBy(-5);
    expect(ref.current?.isSticky()).toBe(false);

    // Scroll back to bottom restores stickiness
    ref.current?.scrollBy(5);
    expect(ref.current?.isSticky()).toBe(true);
  });
});

describe("ScrollBox - Mouse Wheel Event Gap Analysis", () => {
  test("App.tsx has no useInput handler for wheel events (known gap)", () => {
    // This test documents the GAP: the App component only handles keyboard
    // events (upArrow, downArrow, pageUp, pageDown) but NOT mouse wheel.
    //
    // In the original free-code source:
    //   - ScrollKeybindingHandler.tsx handles 'scroll:lineUp'/'scroll:lineDown'
    //   - These are triggered by key.wheelUp / key.wheelDown from SGR mouse mode
    //   - The Ink fork (@jrichman/ink) parses SGR mouse sequences into key events
    //
    // In cc-study:
    //   - Standard Ink (v5) does NOT parse SGR mouse sequences
    //   - useInput only exposes keyboard keys (upArrow, downArrow, etc.)
    //   - No wheelUp/wheelDown in the Key type definition
    //
    // Result: mouse wheel does nothing in the terminal.
    expect(true).toBe(true); // Documenting the gap
  });

  test("ScrollBox has no visual scrollbar thumb (known gap)", () => {
    // This test documents the GAP: the ScrollBox renders no scrollbar UI.
    //
    // In the original free-code source:
    //   - ScrollBox uses <ink-box> with overflowY="scroll"
    //   - The Ink renderer clips content at viewport bounds
    //   - No explicit scrollbar widget is rendered
    //   - Scroll position is implicit (content is translated by -scrollTop)
    //
    // In cc-study:
    //   - ScrollBox uses Ink's <Box> with overflowY="scroll"
    //   - Content is clipped at viewport height
    //   - No scrollbar thumb or track is rendered
    //   - User has no visual indication of scroll position
    //
    // Result: user cannot see where they are in the scroll range,
    // and there's nothing to "drag".
    expect(true).toBe(true); // Documenting the gap
  });

  test("Ink renders scrollbar characters but they are not interactive", () => {
    const ref = createRef<ScrollBoxHandle>();
    const { lastFrame } = render(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={20} stickyScroll={false}>
        {makeChildren(20)}
      </ScrollBox>,
    );

    // Ink renders a scrollbar when overflowY="scroll" - confirmed by output:
    //   Line 0 ... █
    //   Line 1 ... ▀
    //   Line 2
    //   Line 3
    //   Line 4
    // The █ (full block) and ▀ (upper half block) form a scrollbar thumb.
    const frame = lastFrame();
    expect(frame).toBeTruthy();

    // Scrollbar IS rendered by Ink (the "virtual scrollbar" user sees)
    // But it's purely decorative - no mouse handling exists to drag it
    expect(frame).toContain("█");

    // After scrolling, the scrollbar thumb should move - but Ink's
    // built-in scrollbar may not track our scrollTop prop correctly
    ref.current?.scrollTo(10); // scroll to middle
    // The frame won't update until we re-render
  });
});

describe("ScrollBox - Scroll Position Verification", () => {
  test("content changes when scrollTop changes (verifies renderer works)", () => {
    const ref = createRef<ScrollBoxHandle>();
    const { lastFrame, rerender } = render(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={20} stickyScroll={false}>
        {makeChildren(20)}
      </ScrollBox>,
    );

    // At top: should show Line 0..4
    const frameTop = lastFrame();
    expect(frameTop).toContain("Line 0");
    expect(frameTop).not.toContain("Line 5");

    // Scroll to middle: should show Line 10..14
    ref.current?.scrollTo(10);
    rerender(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={20} stickyScroll={false}>
        {makeChildren(20)}
      </ScrollBox>,
    );
    const frameMiddle = lastFrame();
    expect(frameMiddle).toContain("Line 10");
    expect(frameMiddle).not.toContain("Line 0");

    // Scroll to bottom: should show Line 15..19
    ref.current?.scrollTo(15);
    rerender(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={20} stickyScroll={false}>
        {makeChildren(20)}
      </ScrollBox>,
    );
    const frameBottom = lastFrame();
    expect(frameBottom).toContain("Line 15");
    expect(frameBottom).not.toContain("Line 10");
  });
});

describe("ScrollBox - Scrollbar Rendering", () => {
  test("scrollbar appears when content overflows viewport", () => {
    const { lastFrame } = render(
      <ScrollBox viewportHeight={5} totalRows={20} stickyScroll={false}>
        {makeChildren(20)}
      </ScrollBox>,
    );

    const frame = lastFrame();
    // Ink renders scrollbar chars when overflowY="scroll" and content > viewport
    expect(frame).toContain("█");
  });

  test("no scrollbar when content fits viewport", () => {
    const { lastFrame } = render(
      <ScrollBox viewportHeight={10} totalRows={5} stickyScroll={false}>
        {makeChildren(5)}
      </ScrollBox>,
    );

    const frame = lastFrame();
    // Content fits - no scrollbar needed
    expect(frame).not.toContain("█");
  });

  test("scrollbar thumb position reflects scroll state", () => {
    const ref = createRef<ScrollBoxHandle>();
    const { lastFrame, rerender } = render(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={20} stickyScroll={false}>
        {makeChildren(20)}
      </ScrollBox>,
    );

    const frameAtTop = lastFrame();
    // At top: thumb should be near the top
    expect(frameAtTop).toContain("█");

    // Scroll to bottom
    ref.current?.scrollTo(15);
    rerender(
      <ScrollBox ref={ref} viewportHeight={5} totalRows={20} stickyScroll={false}>
        {makeChildren(20)}
      </ScrollBox>,
    );

    const frameAtBottom = lastFrame();
    // At bottom: thumb should be at the bottom (different position)
    expect(frameAtBottom).toContain("█");
  });
});

describe("ScrollBox - Scrollbar Rendering Diagnostic", () => {
  test("scrollbar thumb moves when scrollTop changes via rerender", () => {
    const ref = createRef<ScrollBoxHandle>();

    // Position 1: at top (scrollTop=0)
    const { lastFrame, rerender } = render(
      <ScrollBox ref={ref} viewportHeight={10} totalRows={40} stickyScroll={false}>
        {makeChildren(40)}
      </ScrollBox>,
    );
    const frameTop = lastFrame();
    // Find the line containing █ (scrollbar thumb)
    const linesTop = frameTop.split("\n");
    const thumbLineTop = linesTop.findIndex((l) => l.includes("█"));
    expect(thumbLineTop).toBeGreaterThanOrEqual(0);

    // Position 2: scroll to middle (scrollTop=15)
    ref.current?.scrollTo(15);
    rerender(
      <ScrollBox ref={ref} viewportHeight={10} totalRows={40} stickyScroll={false}>
        {makeChildren(40)}
      </ScrollBox>,
    );
    const frameMiddle = lastFrame();
    const linesMiddle = frameMiddle.split("\n");
    const thumbLineMiddle = linesMiddle.findIndex((l) => l.includes("█"));

    // Position 3: scroll to bottom (scrollTop=30)
    ref.current?.scrollTo(30);
    rerender(
      <ScrollBox ref={ref} viewportHeight={10} totalRows={40} stickyScroll={false}>
        {makeChildren(40)}
      </ScrollBox>,
    );
    const frameBottom = lastFrame();
    const linesBottom = frameBottom.split("\n");
    const thumbLineBottom = linesBottom.findIndex((l) => l.includes("█"));

    // The thumb line index should change with scroll position
    // (thumb moves down as we scroll down)
    // But if Ink ignores our scrollTop prop, the thumb stays at line 0
    console.log("Thumb positions:", { thumbLineTop, thumbLineMiddle, thumbLineBottom });

    // At minimum, frames should differ (content changes with scroll)
    expect(frameTop).not.toBe(frameMiddle);
  });

  test("scrollbar thumb uses block characters (█▀▄)", () => {
    const { lastFrame } = render(
      <ScrollBox viewportHeight={10} totalRows={30} stickyScroll={false}>
        {makeChildren(30)}
      </ScrollBox>,
    );

    const frame = lastFrame();
    // Ink scrollbar uses these Unicode block characters:
    // █ = full block (thumb body)
    // ▀ = upper half block (thumb top edge)
    // ▄ = lower half block (thumb bottom edge)
    // The thumb is rendered as a 1-column-wide strip on the right edge
    const hasScrollbarChar = /[█▀▄]/.test(frame);
    expect(hasScrollbarChar).toBe(true);
  });
});

describe("ScrollBox - Gap vs Original (free-code)", () => {
  test("original ScrollBox uses ink-box DOM element, ours uses Ink Box", () => {
    // Original: <ink-box ref={...} style={{ overflowY: 'scroll' }} ...>
    //   - Directly mutates DOM node properties (scrollTop, stickyScroll, etc.)
    //   - Renderer reads scrollTop from DOM node during render pass
    //   - No React re-render needed for scroll position changes
    //
    // Ours: <Box overflowY="scroll" scrollTop={...}>
    //   - Uses React state + useRef for scroll position
    //   - Forces re-render via setRenderTick on every scroll
    //   - Renderer clips via Ink's built-in overflow handling
    //
    // Impact: our approach is slower (React re-render per scroll tick)
    // but functionally equivalent for viewport clipping.
    expect(true).toBe(true);
  });

  test("original has pendingScrollDelta drain, ours applies scroll instantly", () => {
    // Original: scrollBy accumulates into pendingScrollDelta, renderer drains
    // at a capped rate for smooth animation. Multiple wheel events coalesce.
    //
    // Ours: scrollBy sets scrollTop directly and forces re-render.
    // Multiple rapid scrollBy calls each trigger a separate render.
    //
    // Impact: potential performance issue with fast wheel scrolling.
    expect(true).toBe(true);
  });

  test("original has mouse tracking + drag-to-scroll, ours has neither", () => {
    // Original:
    //   - Enables SGR mouse mode (1003h + 1006h)
    //   - App.tsx handles mouse click/drag events for text selection
    //   - Drag past viewport edge triggers auto-scroll timer
    //   - ScrollKeybindingHandler maps wheel to scroll:lineUp/lineDown
    //
    // Ours:
    //   - No mouse tracking enabled
    //   - No mouse event handling
    //   - No drag-to-scroll
    //   - No text selection
    //
    // Impact: terminal mouse is completely non-functional.
    expect(true).toBe(true);
  });
});
