#!/usr/bin/env node

import { spawn } from "node:child_process";

const child = spawn(
  "pnpm",
  ["--filter", "@ancient-epics/web", "exec", "playwright", "test", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    shell: false,
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
