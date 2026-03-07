import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, '..');
const seedSqlPath = path.join(apiRoot, 'seed', 'seed.sql');
const r2SeedRoot = path.join(apiRoot, 'seed', 'r2');
const databaseName = 'ancient-epics';
const localBucketName = 'ancient-epics-content-preview';

runWrangler(['d1', 'migrations', 'apply', databaseName, '--local']);
runWrangler(['d1', 'execute', databaseName, '--local', '--file', seedSqlPath]);

for (const relativeFilePath of collectFiles(r2SeedRoot)) {
  const absoluteFilePath = path.join(r2SeedRoot, relativeFilePath);
  const objectKey = `${localBucketName}/${relativeFilePath.split(path.sep).join('/')}`;
  runWrangler(['r2', 'object', 'put', objectKey, '--file', absoluteFilePath, '--local']);
}

console.log('Local D1 and R2 seed completed.');

function collectFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absoluteEntryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectFiles(absoluteEntryPath).map((nestedPath) =>
        path.join(entry.name, nestedPath)
      );
    }

    if (!statSync(absoluteEntryPath).isFile()) {
      return [];
    }

    return [entry.name];
  });
}

function runWrangler(args) {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    cwd: apiRoot,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
