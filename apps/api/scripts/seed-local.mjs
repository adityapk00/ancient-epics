import { mkdtempSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { getLocalWranglerArgs } from "./local-persist.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(apiRoot, "..", "..");
const seedSqlPath = path.join(apiRoot, "seed", "seed.sql");
const r2SeedRoot = path.join(apiRoot, "seed", "r2");
const databaseName = "ancient-epics";
const localBucketName = "ancient-epics-content-preview";
const envFilePath = path.join(workspaceRoot, ".env");
const localWranglerArgs = getLocalWranglerArgs(apiRoot);

ensureEnvFile(envFilePath);

const env = loadDotEnv(envFilePath);
const seededSettings = [
  ["openrouter_api_key", env.OPENROUTER_API_KEY ?? ""],
  ["google_api_key", env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? ""],
];

runWrangler(["d1", "migrations", "apply", databaseName, "--local", ...localWranglerArgs], {
  stdio: ["ignore", "inherit", "inherit"],
});
runWrangler(["d1", "execute", databaseName, "--local", "--file", seedSqlPath, ...localWranglerArgs]);
seedAppSettings(seededSettings);

for (const relativeFilePath of collectFiles(r2SeedRoot)) {
  const absoluteFilePath = path.join(r2SeedRoot, relativeFilePath);
  const objectKey = `${localBucketName}/${relativeFilePath.split(path.sep).join("/")}`;
  runWrangler(["r2", "object", "put", objectKey, "--file", absoluteFilePath, "--local", ...localWranglerArgs]);
}

console.log("Local D1 and R2 seed completed.");

function collectFiles(directory) {
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
}

function runWrangler(args, opts = {}) {
  const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
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

function loadDotEnv(filePath) {
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
}

function seedAppSettings(settings) {
  const statements = settings.map(([key, value]) => {
    const escapedKey = escapeSqlString(key);
    const escapedValue = escapeSqlString(value);
    return `UPDATE app_settings SET value = '${escapedValue}', updated_at = datetime('now') WHERE key = '${escapedKey}';`;
  });

  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "ancient-epics-seed-"));
  const tempSqlPath = path.join(tempDirectory, "seed-settings.sql");

  writeFileSync(tempSqlPath, `${statements.join("\n")}\n`, "utf8");

  try {
    runWrangler(["d1", "execute", databaseName, "--local", "--file", tempSqlPath, ...localWranglerArgs]);
  } finally {
    unlinkSync(tempSqlPath);
  }
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
