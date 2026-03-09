import { execFileSync } from "node:child_process";

function runGit(...args) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    stdio: "pipe",
    encoding: "utf8",
  }).trim();
}

try {
  runGit("rev-parse", "--git-dir");
  runGit("config", "core.hooksPath", ".githooks");
  process.stdout.write("Configured Git hooks path to .githooks\n");
} catch (error) {
  const message = error instanceof Error && "message" in error ? error.message : String(error);
  process.stdout.write(`Skipping Git hook setup: ${message}\n`);
}
