import { copyFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiDir = join(__dirname, "..");
const wranglerStateDir = join(apiDir, ".wrangler", "state", "v3");
const exportDir = join(apiDir, "export-local");

// Reset export directory
if (existsSync(exportDir)) {
  rmSync(exportDir, { recursive: true, force: true });
}
mkdirSync(exportDir, { recursive: true });

function exportD1() {
  console.log("Exporting D1 SQLite Database...");
  const d1StateDir = join(wranglerStateDir, "d1", "miniflare-D1DatabaseObject");

  if (!existsSync(d1StateDir)) {
    console.log("No D1 state found. Skipping.");
    return;
  }

  const files = readdirSync(d1StateDir);
  const sqliteFile = files.find((f) => f.endsWith(".sqlite"));

  if (sqliteFile) {
    const sourceFilePath = join(d1StateDir, sqliteFile);
    const targetFilePath = join(exportDir, "database.sqlite3");
    copyFileSync(sourceFilePath, targetFilePath);
    console.log(`Copied D1 database to export-local/database.sqlite3`);
  } else {
    console.log("No D1 sqlite file found.");
  }
}

function exportR2() {
  console.log("Exporting R2 Objects...");
  const r2StateDir = join(wranglerStateDir, "r2");
  const miniflareObjectDir = join(r2StateDir, "miniflare-R2BucketObject");

  if (!existsSync(miniflareObjectDir)) {
    console.log("No R2 state found. Skipping.");
    return;
  }

  const exportR2Dir = join(exportDir, "r2");
  mkdirSync(exportR2Dir, { recursive: true });

  const r2Databases = readdirSync(miniflareObjectDir).filter((f) => f.endsWith(".sqlite"));

  if (r2Databases.length === 0) {
    console.log("No R2 miniflare DB found.");
    return;
  }

  // Find all blobs directories
  const bucketDirs = readdirSync(r2StateDir, { withFileTypes: true })
    .filter((dir) => dir.isDirectory() && !dir.name.startsWith("miniflare-"))
    .map((dir) => dir.name);

  let objectsExported = 0;

  for (const dbName of r2Databases) {
    const dbPath = join(miniflareObjectDir, dbName);
    const db = new Database(dbPath, { readonly: true });

    let rows = [];
    try {
      rows = db.prepare("SELECT key, blob_id FROM _mf_objects").all();
    } catch (err) {
      console.warn(`Could not read _mf_objects from ${dbName}: ${err.message}`);
      db.close();
      continue;
    }

    for (const row of rows) {
      const { key, blob_id } = row;
      let blobPath = null;

      // Look for the blob in any bucket's blobs folder
      for (const bucket of bucketDirs) {
        const testPath = join(r2StateDir, bucket, "blobs", blob_id);
        if (existsSync(testPath)) {
          blobPath = testPath;
          break;
        }
      }

      if (blobPath) {
        const targetPath = join(exportR2Dir, key);
        mkdirSync(dirname(targetPath), { recursive: true });
        copyFileSync(blobPath, targetPath);
        objectsExported++;
        console.log(`Exported R2 object: ${key}`);
      } else {
        console.warn(`Could not find blob file for R2 object: ${key}`);
      }
    }

    db.close();
  }

  console.log(`Exported ${objectsExported} R2 objects total.`);
}

exportD1();
exportR2();
console.log(`\nExport complete! Files are available in ${exportDir}`);
