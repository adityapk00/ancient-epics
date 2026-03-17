import type { ApiFailure, ApiSuccess } from "@ancient-epics/shared";

export type AppEnv = {
  Bindings: {
    APP_ENV?: string;
    CONTENT_BUCKET: R2Bucket;
    DB: D1Database;
    PUBLIC_APP_URL?: string;
    SESSION_SECRET?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
  };
};

export function success<T>(data: T): ApiSuccess<T> {
  return {
    ok: true,
    data,
  };
}

export function failure(code: string, message: string): ApiFailure {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  };
}

export async function readObjectJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const object = await bucket.get(key);

  if (!object) {
    return null;
  }

  return (await object.json()) as T;
}

export async function writeObjectJson(bucket: R2Bucket, key: string, value: unknown): Promise<void> {
  await bucket.put(key, JSON.stringify(value, null, 2), {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
    },
  });
}

export async function readObjectText(bucket: R2Bucket, key: string): Promise<string | null> {
  const object = await bucket.get(key);

  if (!object) {
    return null;
  }

  return await object.text();
}

export async function writeObjectText(bucket: R2Bucket, key: string, value: string): Promise<void> {
  await bucket.put(key, value, {
    httpMetadata: {
      contentType: "text/plain; charset=utf-8",
    },
  });
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
