/**
 * Skills system unified API.
 */

// Types
export type {
  SkillSource,
  LoadedFrom,
  SkillFrontmatter,
  ParsedSkill,
  BundledSkillDefinition,
  SkillCommand,
  SkillUsageEntry,
  SkillUsageMap,
} from "./types.js";

// Parser
export {
  parseFrontmatter,
  parseSkillFrontmatter,
  parseSkillPaths,
  createSkillCommand,
} from "./parser.js";

// Loader
export { loadSkillsFromDir, loadAllSkills } from "./loader.js";

// Bundled registry
export {
  registerBundledSkill,
  getBundledSkills,
  clearBundledSkills,
} from "./bundledRegistry.js";

// Init bundled skills
export { initBundledSkills } from "./bundled/index.js";

// Usage tracking
export {
  recordSkillUsage,
  getSkillUsageScore,
  sortByUsage,
  clearUsageData,
} from "./usageTracking.js";
