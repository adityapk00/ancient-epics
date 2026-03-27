import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { getLocalWranglerArgs } from "./local-persist.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(apiRoot, "..", "..");
const deployConfigPath = path.join(workspaceRoot, "cloudflare.config.json");
const envFilePath = path.join(workspaceRoot, ".env");
const isRemote = process.argv.includes("--remote");
const localWranglerArgs = getLocalWranglerArgs(apiRoot);
const deployConfig = isRemote ? loadDeployConfig(deployConfigPath) : null;
const databaseName = deployConfig?.d1DatabaseName ?? "ancient-epics";

if (!isRemote) {
  ensureEnvFile(envFilePath);
}

runWrangler(["d1", "migrations", "apply", databaseName, getExecutionScopeFlag()], {
  stdio: ["ignore", "inherit", "inherit"],
});

console.log(`${isRemote ? "Remote" : "Local"} D1 migrations applied.`);

function getExecutionScopeFlag() {
  return isRemote ? "--remote" : "--local";
}

function getWranglerPrefix() {
  return isRemote ? ["exec", "wrangler", "-e", "production"] : ["exec", "wrangler"];
}

function getWranglerArgs(args) {
  return isRemote ? args : [...args, ...localWranglerArgs];
}

function runWrangler(args, opts = {}) {
  const result = spawnSync("pnpm", [...getWranglerPrefix(), ...getWranglerArgs(args)], {
    cwd: apiRoot,
    stdio: "inherit",
    ...opts,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function ensureEnvFile(filePath) {
  if (statIfExists(filePath)?.isFile()) {
    return;
  }

  writeFileSync(filePath, ["OPENROUTER_API_KEY=", "GEMINI_API_KEY=", ""].join("\n"), "utf8");
}

function loadDeployConfig(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`Unable to read ${path.basename(filePath)}. Run \`pnpm cf:setup\` first.`);
    throw error;
  }
}

function statIfExists(filePath) {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}
