/**
 * SGR mouse sequence parser.
 *
 * Terminals send SGR mouse events in the format:
 *   CSI < button ; col ; row M   (press / wheel)
 *   CSI < button ; col ; row m   (release)
 *
 * where CSI = \x1b[ and:
 *   button: bit 6 (0x40) = wheel, bit 5 (0x20) = drag/motion, bits 0-1 = button id
 *   col/row: 1-indexed terminal coordinates
 */

// SGR mouse event: ESC [ < button ; col ; row M/m
// Use \x1b directly for reliable matching (String.fromCharCode may produce
// a different internal representation on some platforms)
// eslint-disable-next-line no-control-regex
const SGR_MOUSE_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;

export interface SGRMouseEvent {
  /** Raw button code */
  button: number;
  /** 'press' for M terminator, 'release' for m terminator */
  action: "press" | "release";
  /** 1-indexed column from terminal */
  col: number;
  /** 1-indexed row from terminal */
  row: number;
}

export type MouseEventResult =
  | { type: "wheel"; direction: "up" | "down" }
  | { type: "click"; event: SGRMouseEvent }
  | { type: "drag"; event: SGRMouseEvent }
  | { type: "release"; event: SGRMouseEvent }
  | null;

/**
 * Parse a single SGR mouse escape sequence match into a MouseEventResult.
 */
function matchToResult(match: RegExpExecArray): MouseEventResult {
  const button = parseInt(match[1]!, 10);
  const col = parseInt(match[2]!, 10);
  const row = parseInt(match[3]!, 10);
  const action = match[4] === "M" ? "press" : "release";

  // Wheel events: bit 6 (0x40) is set
  if ((button & 0x40) !== 0) {
    // Mask with 0x43 to check direction (bits 6+1+0), ignoring modifier bits
    const direction = (button & 0x43) === 0x40 ? "up" : "down";
    return { type: "wheel", direction };
  }

  const event: SGRMouseEvent = { button, action, col, row };

  // Drag/motion events: bit 5 (0x20) is set
  if ((button & 0x20) !== 0) {
    return { type: "drag", event };
  }

  // Click (press) vs release
  return action === "press"
    ? { type: "click", event }
    : { type: "release", event };
}

/**
 * Parse an SGR mouse escape sequence from raw stdin data.
 * Returns null if the input is not a recognized SGR mouse sequence.
 */
export function parseSGRMouse(input: string): MouseEventResult {
  const match = SGR_MOUSE_RE.exec(input);
  if (!match) return null;
  return matchToResult(match);
}

/**
 * Parse ALL SGR mouse sequences from a single stdin chunk.
 * A single read() may contain multiple concatenated mouse events.
 */
export function parseSGRMouseAll(
  input: string,
): NonNullable<MouseEventResult>[] {
  const results: NonNullable<MouseEventResult>[] = [];
  // Strip anchors for multi-event matching: find all SGR sequences in input
  // eslint-disable-next-line no-control-regex
  const multiRe = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
  let match: RegExpExecArray | null;
  while ((match = multiRe.exec(input)) !== null) {
    results.push(matchToResult(match) as NonNullable<MouseEventResult>);
  }
  return results;
}
