import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { getLocalWranglerArgs } from "./local-persist.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(apiRoot, "..", "..");
const deployConfigPath = path.join(workspaceRoot, "cloudflare.config.json");
const seedSqlPath = path.join(apiRoot, "seed", "seed.sql");
const r2SeedRoot = path.join(apiRoot, "seed", "r2");
const envFilePath = path.join(workspaceRoot, ".env");
const isRemote = process.argv.includes("--remote");
const localWranglerArgs = getLocalWranglerArgs(apiRoot);
const deployConfig = isRemote ? loadDeployConfig(deployConfigPath) : null;
const databaseName = deployConfig?.d1DatabaseName ?? "ancient-epics";
const bucketName = deployConfig?.r2BucketName ?? "ancient-epics-content-preview";

if (!isRemote) {
  ensureEnvFile(envFilePath);
}

const env = loadDotEnv(envFilePath);
const seededSettings = [
  ["openrouter_api_key", env.OPENROUTER_API_KEY ?? ""],
  ["google_api_key", env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? ""],
];

runWrangler(["d1", "migrations", "apply", databaseName, getExecutionScopeFlag()], {
  stdio: ["ignore", "inherit", "inherit"],
});
runWrangler(["d1", "execute", databaseName, getExecutionScopeFlag(), "--file", seedSqlPath]);
seedAppSettings(seededSettings);

for (const relativeFilePath of collectFiles(r2SeedRoot)) {
  const absoluteFilePath = path.join(r2SeedRoot, relativeFilePath);
  const objectKey = `${bucketName}/${relativeFilePath.split(path.sep).join("/")}`;
  runWrangler(["r2", "object", "put", objectKey, "--file", absoluteFilePath, getExecutionScopeFlag()]);
}

console.log(`${isRemote ? "Remote" : "Local"} D1 and R2 seed completed.`);

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

function collectFiles(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const absoluteEntryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return collectFiles(absoluteEntryPath).map((nestedPath) => path.join(entry.name, nestedPath));
      }

      if (!statSync(absoluteEntryPath).isFile()) {
        return [];
      }

      return [entry.name];
    });
  } catch {
    return [];
  }
}

function ensureEnvFile(filePath) {
  if (statIfExists(filePath)?.isFile()) {
    return;
  }

  writeFileSync(filePath, ["OPENROUTER_API_KEY=", "GEMINI_API_KEY=", ""].join("\n"), "utf8");
}

function loadDotEnv(filePath) {
  try {
    const fileContents = readFileSync(filePath, "utf8");
    const entries = {};

    for (const rawLine of fileContents.split(/\r?\n/u)) {
      const line = rawLine.trim();

      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");

      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line
        .slice(separatorIndex + 1)
        .trim()
        .replace(/^['"]|['"]$/gu, "");

      if (!key) {
        continue;
      }

      entries[key] = value;
    }

    return entries;
  } catch {
    return {};
  }
}

function loadDeployConfig(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`Unable to read ${path.basename(filePath)}. Run \`pnpm cf:setup\` first.`);
    throw error;
  }
}

function seedAppSettings(settings) {
  const statements = settings.map(([key, value]) => {
    const escapedKey = escapeSqlString(key);
    const escapedValue = escapeSqlString(value);
    return `UPDATE app_settings SET value = '${escapedValue}', updated_at = datetime('now') WHERE key = '${escapedKey}';`;
  });

  runWrangler(["d1", "execute", databaseName, getExecutionScopeFlag(), "--command", statements.join("\n")]);
}

function escapeSqlString(value) {
  return value.replaceAll("'", "''");
}

function statIfExists(filePath) {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}
