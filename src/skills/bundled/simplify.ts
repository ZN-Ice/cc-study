/**
 * Bundled skill: simplify
 * Reviews changed code for reuse, quality, and efficiency.
 */

import { registerBundledSkill } from "../bundledRegistry.js";

const SIMPLIFY_PROMPT = `# Simplify Code Review

Review the changed code for reuse, quality, and efficiency.

## Steps

1. Read the current git diff to see what changed
2. For each change, check:
   - Dead code or unused imports
   - Duplicated logic that could be extracted
   - Overly complex abstractions
   - Missing error handling at system boundaries
   - Opportunities for simpler data structures
3. Fix any issues found directly
4. Explain what you changed and why

## Rules
- Only fix actual problems, don't refactor for style
- Keep changes minimal and focused
- Don't add abstractions unless they reduce real duplication
`;

export function registerSimplifySkill(): void {
  registerBundledSkill({
    name: "simplify",
    description: "Review changed code for reuse, quality, and efficiency, then fix any issues found",
    whenToUse:
      "Use when the user wants to clean up or simplify recently changed code. Good after implementing a feature.",
    userInvocable: true,
    async getPromptForCommand(args) {
      let prompt = SIMPLIFY_PROMPT;
      if (args) {
        prompt += `\n## Additional context\n\n${args}`;
      }
      return [{ type: "text", text: prompt }];
    },
  });
}
