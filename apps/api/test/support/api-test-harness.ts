import Database from "better-sqlite3";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import app from "../../src/index";
import type { AppEnv } from "../../src/http";

type D1Result<T> = {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
};

class TestD1PreparedStatement {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly sql: string,
    private readonly parameters: unknown[] = [],
  ) {}

  bind(...parameters: unknown[]) {
    return new TestD1PreparedStatement(
      this.sqlite,
      this.sql,
      parameters.map((parameter) => {
        if (parameter === undefined) {
          return null;
        }

        if (typeof parameter === "boolean") {
          return parameter ? 1 : 0;
        }

        return parameter;
      }),
    );
  }

  async all<T>(): Promise<D1Result<T>> {
    const rows = this.sqlite.prepare(this.sql).all(...this.parameters) as T[];

    return {
      results: rows,
      success: true,
      meta: { duration: 0 },
    };
  }

  async first<T>(columnName?: string): Promise<T | null> {
    const row = this.sqlite.prepare(this.sql).get(...this.parameters) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    if (columnName) {
      return ((row[columnName] ?? null) as T | null) ?? null;
    }

    return row as T;
  }

  async run(): Promise<{ success: boolean; meta: Record<string, unknown> }> {
    const result = this.sqlite.prepare(this.sql).run(...this.parameters);

    return {
      success: true,
      meta: {
        changes: result.changes,
        duration: 0,
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }
}

class TestD1Database {
  constructor(private readonly sqlite: Database.Database) {}

  prepare(sql: string) {
    return new TestD1PreparedStatement(this.sqlite, sql);
  }

  async exec(sql: string) {
    this.sqlite.exec(sql);
    return {
      count: 0,
      duration: 0,
    };
  }
}

class TestR2ObjectBody {
  constructor(private readonly value: Uint8Array) {}

  async json<T>() {
    return JSON.parse(await this.text()) as T;
  }

  async text() {
    return new TextDecoder().decode(this.value);
  }
}

class TestR2Bucket {
  private readonly objects = new Map<string, Uint8Array>();

  async get(key: string) {
    const value = this.objects.get(key);
    return value ? new TestR2ObjectBody(value) : null;
  }

  async put(key: string, value: string | ArrayBuffer | ArrayBufferView) {
    if (typeof value === "string") {
      this.objects.set(key, new TextEncoder().encode(value));
      return;
    }

    if (ArrayBuffer.isView(value)) {
      this.objects.set(key, new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)));
      return;
    }

    this.objects.set(key, new Uint8Array(value));
  }

  async delete(keys: string | string[]) {
    const values = Array.isArray(keys) ? keys : [keys];

    for (const key of values) {
      this.objects.delete(key);
    }
  }

  async list(options?: { prefix?: string; cursor?: string }) {
    const prefix = options?.prefix ?? "";
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();

    return {
      objects: keys.map((key) => ({ key })),
      truncated: false,
      cursor: options?.cursor,
    };
  }
}

export type ApiTestContext = {
  close: () => void;
  env: AppEnv["Bindings"];
  request: <T>(method: string, urlPath: string, body?: unknown) => Promise<{ status: number; json: T }>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, "..", "..");
const migrationsDir = path.join(apiRoot, "migrations");
const seedSqlPath = path.join(apiRoot, "seed", "seed.sql");
const seedR2Root = path.join(apiRoot, "seed", "r2");

export async function createApiTestContext(): Promise<ApiTestContext> {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");

  const db = new TestD1Database(sqlite);
  const bucket = new TestR2Bucket();

  for (const filePath of listFiles(migrationsDir)) {
    await db.exec(readFileSync(filePath, "utf8"));
  }

  await db.exec(readFileSync(seedSqlPath, "utf8"));

  for (const filePath of listFiles(seedR2Root)) {
    const relativePath = path.relative(seedR2Root, filePath).split(path.sep).join("/");
    await bucket.put(relativePath, readFileSync(filePath, "utf8"));
  }

  const env = {
    APP_ENV: "test",
    CONTENT_BUCKET: bucket as unknown as R2Bucket,
    DB: db as unknown as D1Database,
    PUBLIC_APP_URL: "http://127.0.0.1:5173",
  } satisfies AppEnv["Bindings"];

  return {
    close: () => sqlite.close(),
    env,
    request: async <T>(method: string, urlPath: string, body?: unknown) => {
      const response = await app.fetch(
        new Request(`http://localhost${urlPath}`, {
          method,
          headers: body === undefined ? undefined : { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        env,
        {
          passThroughOnException() {},
          waitUntil() {},
        } as ExecutionContext,
      );

      return {
        status: response.status,
        json: (await response.json()) as T,
      };
    },
  };
}

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const filePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return listFiles(filePath);
      }

      if (!statSync(filePath).isFile()) {
        return [];
      }

      return [filePath];
    })
    .sort((left, right) => left.localeCompare(right));
}
