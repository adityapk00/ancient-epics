import { rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, "..");
const wranglerStateV3 = path.join(apiRoot, ".wrangler", "state", "v3");

const pathsToNuke = [path.join(wranglerStateV3, "d1"), path.join(wranglerStateV3, "r2")];

console.log("Nuking local D1 and R2 state...");

for (const p of pathsToNuke) {
  if (existsSync(p)) {
    console.log(`Deleting ${p}...`);
    rmSync(p, { recursive: true, force: true });
  } else {
    console.log(`Path ${p} does not exist, skipping.`);
  }
}

console.log("Local D1 and R2 state wiped.");
