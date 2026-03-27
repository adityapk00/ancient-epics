import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { getLocalWranglerArgs } from "./local-persist.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(apiRoot, "..", "..");
const deployConfigPath = path.join(workspaceRoot, "cloudflare.config.json");
const localWranglerArgs = getLocalWranglerArgs(apiRoot);
const passwordHashIterations = 100_000;
const isRemote = process.argv.includes("--remote");
const password = process.argv.slice(2).find((value) => value !== "--remote") ?? "";
const databaseName = isRemote ? loadDeployConfig(deployConfigPath).d1DatabaseName : "ancient-epics";

if (password.length < 8) {
  console.error("Provide an admin password with at least 8 characters.");
  process.exit(1);
}

if (password.length > 200) {
  console.error("Admin password is too long.");
  process.exit(1);
}

const passwordHash = await hashPassword(password);
const statements = [
  "DELETE FROM admin_sessions;",
  `INSERT INTO admin_credentials (id, password_hash, updated_at)
   VALUES (1, '${escapeSqlString(passwordHash)}', datetime('now'))
   ON CONFLICT(id) DO UPDATE SET
     password_hash = excluded.password_hash,
     updated_at = excluded.updated_at;`,
];

runWrangler(["d1", "execute", databaseName, isRemote ? "--remote" : "--local", "--command", statements.join("\n")]);
console.log(`Admin password seeded into ${isRemote ? "remote" : "local"} D1.`);

async function hashPassword(value) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(value),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const derivedBits = await webcrypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: copyToArrayBuffer(salt),
      iterations: passwordHashIterations,
    },
    keyMaterial,
    32 * 8,
  );

  return `pbkdf2_sha256$${passwordHashIterations}$${toHex(salt)}$${toHex(new Uint8Array(derivedBits))}`;
}

function copyToArrayBuffer(bytes) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function toHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function escapeSqlString(value) {
  return value.replaceAll("'", "''");
}

function runWrangler(args) {
  const result = spawnSync(
    "pnpm",
    ["exec", "wrangler", ...(isRemote ? ["-e", "production"] : []), ...args, ...(isRemote ? [] : localWranglerArgs)],
    {
      cwd: apiRoot,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
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
