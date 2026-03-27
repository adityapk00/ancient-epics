#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const apiRoot = path.join(repoRoot, "apps", "api");
const webRoot = path.join(repoRoot, "apps", "web");

const uiTestApiPort = Number(process.env.UI_TEST_API_PORT ?? 8788);
const uiTestWebPort = Number(process.env.UI_TEST_WEB_PORT ?? 4173);
const uiTestAdminPassword = process.env.UI_TEST_ADMIN_PASSWORD?.trim() || "password";
const uiTestPersistTo = mkdtempSync(path.join(os.tmpdir(), "ancient-epics-ui-test-"));
const uiTestBaseUrl = `http://127.0.0.1:${uiTestWebPort}`;
const uiTestApiUrl = `http://127.0.0.1:${uiTestApiPort}`;

const sharedEnv = {
  ...process.env,
  AE_LOCAL_PERSIST_TO: uiTestPersistTo,
};

let apiServer = null;
let webServer = null;
let shuttingDown = false;

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await shutdown(1);
});

async function main() {
  mkdirSync(path.dirname(uiTestPersistTo), { recursive: true });

  console.log(`🧪  Creating isolated UI test state at ${uiTestPersistTo}`);
  console.log("🧹  Nuking isolated D1 + R2 state…");
  runNodeScript("seed-nuke.mjs", "local:db:nuke");

  console.log("🌱  Re-seeding isolated state…");
  runNodeScript("seed-db.mjs", "local:db:seed");

  console.log("🔐  Seeding admin password…");
  runNodeScript("seed-password.mjs", "local:admin:password", [uiTestAdminPassword]);

  apiServer = spawn(
    "pnpm",
    ["exec", "wrangler", "dev", "--port", String(uiTestApiPort), "--persist-to", uiTestPersistTo, "--ip", "127.0.0.1"],
    {
      cwd: apiRoot,
      env: {
        ...sharedEnv,
        PUBLIC_APP_URL: uiTestBaseUrl,
      },
      stdio: "pipe",
    },
  );

  pipeChildLogs("api", apiServer);
  watchChildExit("Wrangler API", apiServer);
  await waitForServerReady(apiServer, {
    label: "Wrangler API",
    readyPattern: "Ready on",
  });

  webServer = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(uiTestWebPort)], {
    cwd: webRoot,
    env: {
      ...sharedEnv,
      PORT: String(uiTestWebPort),
      VITE_PORT: String(uiTestWebPort),
      VITE_API_PROXY_TARGET: uiTestApiUrl,
    },
    stdio: "pipe",
  });

  pipeChildLogs("web", webServer);
  watchChildExit("Vite web", webServer);
  await waitForServerReady(webServer, {
    label: "Vite web",
    readyPattern: uiTestBaseUrl,
  });

  console.log(`✔  UI test stack ready at ${uiTestBaseUrl}`);

  process.once("SIGINT", () => void shutdown(0));
  process.once("SIGTERM", () => void shutdown(0));

  await new Promise(() => {});
}

function runNodeScript(scriptName, label, args = []) {
  const result = spawnSync("node", [path.join(apiRoot, "scripts", scriptName), ...args], {
    cwd: apiRoot,
    env: sharedEnv,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 1}.`);
  }
}

function pipeChildLogs(label, child) {
  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[${label}] ${chunk.toString()}`);
  });

  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[${label}] ${chunk.toString()}`);
  });
}

function watchChildExit(label, child) {
  child.once("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    console.error(`${label} exited unexpectedly (code: ${code ?? "null"}, signal: ${signal ?? "null"}).`);
    void shutdown(1);
  });
}

async function waitForServerReady(child, { label, readyPattern }) {
  let ready = false;

  await new Promise((resolve, reject) => {
    const startupTimeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${label} to start.`));
    }, 30_000);

    startupTimeout.unref?.();

    const onData = (chunk) => {
      const text = chunk.toString();
      if (text.includes(readyPattern)) {
        ready = true;
        cleanup();
        resolve();
      }
    };

    const onExit = (code, signal) => {
      if (!ready) {
        cleanup();
        reject(new Error(`${label} exited before startup (code: ${code ?? "null"}, signal: ${signal ?? "null"}).`));
      }
    };

    const cleanup = () => {
      clearTimeout(startupTimeout);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", onExit);
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise((resolve) => {
    const forceKillTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 2_000);

    const onClose = () => {
      clearTimeout(forceKillTimer);
      resolve();
    };

    child.once("close", onClose);
    child.kill("SIGTERM");
  });
}

async function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  await stopChild(webServer);
  await stopChild(apiServer);

  if (existsSync(uiTestPersistTo)) {
    rmSync(uiTestPersistTo, { recursive: true, force: true });
  }

  process.exit(exitCode);
}
