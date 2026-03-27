import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  configPath,
  ensureD1Database,
  ensureLoggedIn,
  ensurePagesProject,
  ensureProductionWranglerConfig,
  ensureR2Bucket,
  loadDeployConfig,
} from "./cloudflare-lib.mjs";

if (!existsSync(configPath)) {
  copyFileSync(path.join(path.dirname(configPath), "cloudflare.config.example.json"), configPath);
  console.error(`Created ${path.basename(configPath)} from the example file. Fill it in and re-run this command.`);
  process.exit(1);
}

const deployConfig = loadDeployConfig();
const identity = ensureLoggedIn();

console.log(`Using Cloudflare account: ${identity.email}`);

const database = ensureD1Database({
  name: deployConfig.d1DatabaseName,
  location: deployConfig.d1Location,
});

ensureR2Bucket(deployConfig.r2BucketName);
ensureR2Bucket(deployConfig.r2PreviewBucketName);
ensurePagesProject(deployConfig.pagesProjectName, deployConfig.productionBranch);

ensureProductionWranglerConfig(deployConfig, database.uuid);

console.log("");
console.log("Cloudflare setup complete.");
console.log(`- D1 database: ${deployConfig.d1DatabaseName} (${database.uuid})`);
console.log(`- R2 bucket: ${deployConfig.r2BucketName}`);
console.log(`- R2 preview bucket: ${deployConfig.r2PreviewBucketName}`);
console.log(`- Pages project: ${deployConfig.pagesProjectName}`);
console.log("");
console.log("Next steps:");
console.log(`1. Buy or transfer ${deployConfig.zoneName} into Cloudflare if you have not already.`);
console.log(`2. Run \`pnpm remote:db:seed\` to apply migrations and seed remote D1/R2.`);
console.log("3. Run `pnpm remote:admin:password <your-password>` to set the first admin password.");
console.log("4. Run `pnpm cf:deploy` to publish the Worker and the Pages frontend.");
console.log(
  `5. In the Cloudflare dashboard, attach ${deployConfig.siteDomain} to the Pages project ${deployConfig.pagesProjectName}.`,
);
