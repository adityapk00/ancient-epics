import { getGitMetadata, loadDeployConfig, runPnpm, runWrangler } from "./cloudflare-lib.mjs";

const deployConfig = loadDeployConfig();
const git = getGitMetadata();
const webBuildEnv = {
  ...process.env,
  VITE_API_BASE_URL: `https://${deployConfig.apiDomain}`,
};

runPnpm(["--filter", "@ancient-epics/web", "build"], {
  env: webBuildEnv,
});

runWrangler(["deploy", "-e", "production", "--keep-vars"]);

const pagesDeployArgs = [
  "pages",
  "deploy",
  "../web/dist",
  "--project-name",
  deployConfig.pagesProjectName,
  "--branch",
  deployConfig.productionBranch,
  "--commit-hash",
  git.commitHash,
  "--commit-message",
  git.commitMessage,
];

if (git.dirty) {
  pagesDeployArgs.push("--commit-dirty");
}

runWrangler(pagesDeployArgs, {
  env: webBuildEnv,
});

console.log("");
console.log(`Published frontend to Pages project ${deployConfig.pagesProjectName}.`);
console.log(`Published API Worker ${deployConfig.workerName} to https://${deployConfig.apiDomain}.`);
