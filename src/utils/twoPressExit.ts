/**
 * Pure state machine for two-press exit confirmation.
 *
 * State transitions:
 *   IDLE --press--> WAITING  (show hint)
 *   WAITING --press--> IDLE  (exit)
 *   WAITING --timeout--> IDLE (dismiss hint)
 */

export interface TwoPressExitState {
  readonly waitingForSecondPress: boolean;
}

export type TwoPressExitAction = "press" | "timeout";

export interface TwoPressExitResult {
  readonly state: TwoPressExitState;
  readonly shouldExit: boolean;
  readonly shouldShowHint: boolean;
}

const IDLE: TwoPressExitState = { waitingForSecondPress: false };
const WAITING: TwoPressExitState = { waitingForSecondPress: true };

export function twoPressReducer(
  state: TwoPressExitState,
  action: TwoPressExitAction,
): TwoPressExitResult {
  switch (action) {
    case "press":
      if (state.waitingForSecondPress) {
        return { state: IDLE, shouldExit: true, shouldShowHint: false };
      }
      return { state: WAITING, shouldExit: false, shouldShowHint: true };

    case "timeout":
      return { state: IDLE, shouldExit: false, shouldShowHint: false };
  }
}
