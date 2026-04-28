/**
 * Initialize all bundled skills.
 * Reference: free-code/src/skills/bundled/index.ts
 */

import { registerSimplifySkill } from "./simplify.js";
import { registerReviewSkill } from "./review.js";

export function initBundledSkills(): void {
  registerSimplifySkill();
  registerReviewSkill();
}
