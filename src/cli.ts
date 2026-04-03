import { Command } from "commander";
import { VERSION, DEFAULT_MODEL } from "./constants/version.js";

export interface CliOptions {
  version: boolean;
  help: boolean;
  model: string;
  debug: boolean;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const program = new Command()
    .exitOverride(() => {})
    .version(VERSION, "-v, --version")
    .option("-m, --model <model>", "AI model to use", DEFAULT_MODEL)
    .option("--debug", "Enable debug mode", false);

  try {
    program.parse(argv, { from: "user" });
  } catch {
    // Commander throws on --help/--version; return defaults for those
    return {
      version: argv.includes("--version") || argv.includes("-v"),
      help: argv.includes("--help") || argv.includes("-h"),
      model: DEFAULT_MODEL,
      debug: false,
    };
  }

  const opts = program.opts();
  return {
    version: argv.includes("--version") || argv.includes("-v"),
    help: argv.includes("--help") || argv.includes("-h"),
    model: opts.model ?? DEFAULT_MODEL,
    debug: opts.debug ?? false,
  };
}
