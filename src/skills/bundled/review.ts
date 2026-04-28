/**
 * Bundled skill: review
 * Review a pull request.
 */

import { registerBundledSkill } from "../bundledRegistry.js";

const REVIEW_PROMPT = `# Code Review

Review the current changes on this branch.

## Steps

1. Get the git diff of the changes
2. For each change, analyze:
   - Correctness: Does the code do what it claims?
   - Security: Any injection, XSS, or access control issues?
   - Performance: Any obvious bottlenecks?
   - Maintainability: Is the code readable and well-structured?
3. Summarize findings as:
   - **Critical**: Must fix before merge
   - **Important**: Should fix soon
   - **Minor**: Nice to have improvements

## Rules
- Be constructive, not critical
- Suggest specific fixes, not vague improvements
- Acknowledge good patterns when you see them
`;

export function registerReviewSkill(): void {
  registerBundledSkill({
    name: "review",
    description: "Review the current changes or a pull request for quality and correctness",
    whenToUse:
      "Use when the user wants a code review of their changes. Works with branches, PRs, or staged changes.",
    userInvocable: true,
    async getPromptForCommand(args) {
      let prompt = REVIEW_PROMPT;
      if (args) {
        prompt += `\n## Additional context\n\n${args}`;
      }
      return [{ type: "text", text: prompt }];
    },
  });
}
