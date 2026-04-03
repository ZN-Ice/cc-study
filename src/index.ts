import { render } from "ink";
import React from "react";
import { parseCliArgs } from "./cli.js";
import { App } from "./components/App.js";
import { VERSION } from "./constants/version.js";

function main(): void {
  const args = process.argv.slice(2);
  const options = parseCliArgs(args);

  if (options.version) {
    console.log(`cc-study v${VERSION}`);
    process.exit(0);
  }

  if (options.help) {
    console.log(`
cc-study v${VERSION} - Learning Claude Code by reimplementing its core features

Usage: cc-study [options]

Options:
  -v, --version            Output version number
  -h, --help               Output help information
  -m, --model <model>      AI model to use (default: claude-sonnet-4-6)
  --debug                  Enable debug mode
`);
    process.exit(0);
  }

  // Default: launch interactive REPL
  render(React.createElement(App));
}

main();
