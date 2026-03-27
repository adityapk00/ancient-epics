import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, "..");
export const apiRoot = path.join(repoRoot, "apps", "api");
export const webRoot = path.join(repoRoot, "apps", "web");
export const configPath = path.join(repoRoot, "cloudflare.config.json");
export const apiWranglerConfigPath = path.join(apiRoot, "wrangler.jsonc");
export const appVersionPath = path.join(webRoot, "src", "app-version.json");
export const seedSqlPath = path.join(apiRoot, "seed", "seed.sql");
export const r2SeedRoot = path.join(apiRoot, "seed", "r2");
export const wranglerBinPath = path.join(
  apiRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler",
);

export function loadDeployConfig() {
  const config = JSON.parse(readFileSync(configPath, "utf8"));

  const requiredKeys = [
    "accountId",
    "zoneName",
    "siteDomain",
    "apiDomain",
    "pagesProjectName",
    "workerName",
    "d1DatabaseName",
    "r2BucketName",
    "r2PreviewBucketName",
  ];

  for (const key of requiredKeys) {
    if (!config[key] || typeof config[key] !== "string") {
      throw new Error(`Missing required key \`${key}\` in ${path.basename(configPath)}.`);
    }
  }

  return {
    d1Location: "enam",
    productionBranch: "main",
    ...config,
  };
}

export function getCurrentAppVersion() {
  const payload = JSON.parse(readFileSync(appVersionPath, "utf8"));
  const version = payload.version;

  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`Invalid app version in ${path.relative(repoRoot, appVersionPath)}.`);
  }

  return version;
}

export function writeAppVersion(version) {
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`Cannot write invalid app version: ${version}`);
  }

  writeFileSync(appVersionPath, `${JSON.stringify({ version }, null, 2)}\n`, "utf8");
}

export function loadWranglerConfig() {
  return parseJsonc(readFileSync(apiWranglerConfigPath, "utf8"));
}

export function writeWranglerConfig(config) {
  writeFileSync(apiWranglerConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function ensureProductionWranglerConfig(deployConfig, d1DatabaseId) {
  const wranglerConfig = loadWranglerConfig();

  wranglerConfig.account_id = deployConfig.accountId;
  wranglerConfig.name = deployConfig.workerName;
  wranglerConfig.env ??= {};
  wranglerConfig.env.production = {
    vars: {
      APP_ENV: "production",
      PUBLIC_APP_URL: `https://${deployConfig.siteDomain}`,
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: deployConfig.d1DatabaseName,
        database_id: d1DatabaseId,
        migrations_dir: "migrations",
      },
    ],
    r2_buckets: [
      {
        binding: "CONTENT_BUCKET",
        bucket_name: deployConfig.r2BucketName,
        preview_bucket_name: deployConfig.r2PreviewBucketName,
      },
    ],
    routes: [
      {
        pattern: deployConfig.apiDomain,
        custom_domain: true,
      },
    ],
  };

  writeWranglerConfig(wranglerConfig);
}

export function ensureLoggedIn() {
  const result = runWrangler(["whoami", "--json"], {
    captureOutput: true,
    allowFailure: true,
  });

  if (result.status !== 0) {
    throw new Error("Wrangler is not authenticated. Run `pnpm exec wrangler login` first.");
  }

  return JSON.parse(result.stdout);
}

export function getD1DatabaseByName(name) {
  const databases = JSON.parse(runWrangler(["d1", "list", "--json"], { captureOutput: true }).stdout);
  return databases.find((database) => database.name === name) ?? null;
}

export function ensureD1Database({ name, location }) {
  const existing = getD1DatabaseByName(name);
  if (existing) {
    return existing;
  }

  const args = ["d1", "create", name];
  if (location) {
    args.push("--location", location);
  }
  args.push("--binding", "DB");

  runWrangler(args, {
    env: {
      ...process.env,
      CI: "1",
    },
  });
  const created = getD1DatabaseByName(name);

  if (!created) {
    throw new Error(`Failed to find D1 database \`${name}\` after creation.`);
  }

  return created;
}

export function ensureR2Bucket(name) {
  const existing = getR2Bucket(name);
  if (existing) {
    return existing;
  }

  runWrangler(["r2", "bucket", "create", name], {
    env: {
      ...process.env,
      CI: "1",
    },
  });
  return getR2Bucket(name);
}

export function getR2Bucket(name) {
  const result = runWrangler(["r2", "bucket", "info", name, "--json"], {
    captureOutput: true,
    allowFailure: true,
  });

  if (result.status !== 0) {
    return null;
  }

  return JSON.parse(result.stdout);
}

export function ensurePagesProject(name, productionBranch) {
  const projects = JSON.parse(
    runWrangler(["pages", "project", "list", "--json"], {
      captureOutput: true,
      env: withCloudflareAccountEnv(process.env),
    }).stdout,
  );
  const existing = projects.find((project) => getPagesProjectName(project) === name);
  if (existing) {
    return existing;
  }

  runWrangler(["pages", "project", "create", name, "--production-branch", productionBranch], {
    env: withCloudflareAccountEnv({
      ...process.env,
      CI: "1",
    }),
  });
  const refreshedProjects = JSON.parse(
    runWrangler(["pages", "project", "list", "--json"], {
      captureOutput: true,
      env: withCloudflareAccountEnv(process.env),
    }).stdout,
  );
  return refreshedProjects.find((project) => getPagesProjectName(project) === name) ?? null;
}

export function runWrangler(args, options = {}) {
  const { captureOutput = false, allowFailure = false, env = process.env, cwd = apiRoot } = options;
  const result = spawnSync(wranglerBinPath, args, {
    cwd,
    env: withCloudflareAccountEnv(env),
    stdio: captureOutput ? "pipe" : "inherit",
    encoding: "utf8",
  });

  if (!allowFailure && result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result;
}

export function runPnpm(args, options = {}) {
  const { cwd = repoRoot, env = process.env, captureOutput = false } = options;
  const result = spawnSync("pnpm", args, {
    cwd,
    env,
    stdio: captureOutput ? "pipe" : "inherit",
    encoding: "utf8",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result;
}

export function getGitMetadata() {
  return {
    branch: execGit(["rev-parse", "--abbrev-ref", "HEAD"]),
    commitHash: execGit(["rev-parse", "HEAD"]),
    commitMessage: execGit(["log", "-1", "--pretty=%s"]),
    dirty: spawnSync("git", ["diff", "--quiet"], { cwd: repoRoot }).status !== 0,
  };
}

export function loadDotEnv(filePath) {
  const entries = {};
  const contents = readFileSync(filePath, "utf8");

  for (const rawLine of contents.split(/\r?\n/u)) {
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

    if (key) {
      entries[key] = value;
    }
  }

  return entries;
}

export function escapeSqlString(value) {
  return value.replaceAll("'", "''");
}

export function withCloudflareAccountEnv(env) {
  try {
    const deployConfig = loadDeployConfig();
    return {
      ...env,
      CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID ?? deployConfig.accountId,
    };
  } catch {
    return env;
  }
}

function execGit(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

function parseJsonc(value) {
  const withoutComments = value.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
  const withoutTrailingCommas = withoutComments.replace(/,\s*([}\]])/gu, "$1");
  return JSON.parse(withoutTrailingCommas);
}

function getPagesProjectName(project) {
  return project.name ?? project["Project Name"] ?? null;
}
