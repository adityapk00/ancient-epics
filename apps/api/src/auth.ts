import type { AuthSessionPayload, AuthUser } from "@ancient-epics/shared";
import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import type { AppEnv } from "./http";

const SESSION_COOKIE_NAME = "ancient_epics_session";
const ADMIN_SESSION_COOKIE_NAME = "ancient_epics_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_HASH_ITERATIONS = 600_000;
const PASSWORD_HASH_KEY_LENGTH = 32;
const PASSWORD_SALT_LENGTH = 16;

type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validateEmailAndPassword(input: { email?: string; password?: string }): {
  email: string;
  password: string;
} {
  const email = normalizeEmail(input.email ?? "");
  const password = validatePasswordInput(input.password);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }

  return { email, password };
}

export function validatePasswordInput(password?: string): string {
  const value = password ?? "";

  if (value.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }

  if (value.length > 200) {
    throw new Error("Password is too long.");
  }

  return value;
}

export async function createUserAccount(
  db: D1Database,
  input: {
    email: string;
    password: string;
  },
): Promise<{ user: AuthUser; sessionToken: string }> {
  const existing = await db
    .prepare(`SELECT id FROM users WHERE email = ?`)
    .bind(normalizeEmail(input.email))
    .first<{ id: string }>();

  if (existing) {
    throw new Error("An account with this email already exists.");
  }

  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const passwordHash = await hashPasswordForStorage(input.password);

  await db
    .prepare(`INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(userId, normalizeEmail(input.email), passwordHash, now, now)
    .run();

  const user = {
    id: userId,
    email: normalizeEmail(input.email),
    createdAt: now,
  } satisfies AuthUser;

  const sessionToken = await createSession(db, user.id);
  return { user, sessionToken };
}

export async function authenticateUser(
  db: D1Database,
  input: {
    email: string;
    password: string;
  },
): Promise<{ user: AuthUser; sessionToken: string } | null> {
  const user = await db
    .prepare(
      `
        SELECT id, email, password_hash AS passwordHash, created_at AS createdAt
        FROM users
        WHERE email = ?
      `,
    )
    .bind(normalizeEmail(input.email))
    .first<UserRow>();

  if (!user) {
    return null;
  }

  const isValidPassword = await verifyPasswordHash(input.password, user.passwordHash);
  if (!isValidPassword) {
    return null;
  }

  const sessionToken = await createSession(db, user.id);

  return {
    user: mapAuthUser(user),
    sessionToken,
  };
}

export async function getCurrentAuthUser(c: Context<AppEnv>): Promise<AuthUser | null> {
  const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
  if (!sessionToken) {
    return null;
  }

  const sessionTokenHash = await sha256Hex(sessionToken);
  const now = new Date().toISOString();
  const user = await c.env.DB.prepare(
    `
        SELECT users.id, users.email, users.created_at AS createdAt
        FROM user_sessions
        JOIN users
          ON users.id = user_sessions.user_id
        WHERE user_sessions.session_token_hash = ?
          AND user_sessions.expires_at > ?
        LIMIT 1
      `,
  )
    .bind(sessionTokenHash, now)
    .first<AuthUser>();

  return user ?? null;
}

export async function revokeCurrentSession(c: Context<AppEnv>): Promise<void> {
  const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
  if (sessionToken) {
    const sessionTokenHash = await sha256Hex(sessionToken);
    await c.env.DB.prepare(`DELETE FROM user_sessions WHERE session_token_hash = ?`).bind(sessionTokenHash).run();
  }

  setCookie(c, SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "Lax",
    secure: isSecureRequest(c),
  });
}

export function setAuthSessionCookie(c: Context<AppEnv>, sessionToken: string): void {
  setCookie(c, SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
    sameSite: "Lax",
    secure: isSecureRequest(c),
  });
}

export async function authenticateAdminPassword(
  db: D1Database,
  password: string,
): Promise<{
  sessionToken: string;
} | null> {
  const credential = await db
    .prepare(`SELECT password_hash AS passwordHash FROM admin_credentials WHERE id = 1 LIMIT 1`)
    .first<{ passwordHash: string }>();

  if (!credential) {
    return null;
  }

  const isValidPassword = await verifyPasswordHash(password, credential.passwordHash);
  if (!isValidPassword) {
    return null;
  }

  return {
    sessionToken: await createAdminSession(db),
  };
}

export async function getCurrentAdminSession(c: Context<AppEnv>): Promise<boolean> {
  const sessionToken = getCookie(c, ADMIN_SESSION_COOKIE_NAME);
  if (!sessionToken) {
    return false;
  }

  const sessionTokenHash = await sha256Hex(sessionToken);
  const now = new Date().toISOString();
  const sessionExists = await c.env.DB.prepare(
    `
        SELECT 1
        FROM admin_sessions
        WHERE session_token_hash = ?
          AND expires_at > ?
        LIMIT 1
      `,
  )
    .bind(sessionTokenHash, now)
    .first<number>("1");

  return sessionExists === 1;
}

export async function revokeCurrentAdminSession(c: Context<AppEnv>): Promise<void> {
  const sessionToken = getCookie(c, ADMIN_SESSION_COOKIE_NAME);
  if (sessionToken) {
    const sessionTokenHash = await sha256Hex(sessionToken);
    await c.env.DB.prepare(`DELETE FROM admin_sessions WHERE session_token_hash = ?`).bind(sessionTokenHash).run();
  }

  setCookie(c, ADMIN_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "Lax",
    secure: isSecureRequest(c),
  });
}

export function setAdminSessionCookie(c: Context<AppEnv>, sessionToken: string): void {
  setCookie(c, ADMIN_SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
    sameSite: "Lax",
    secure: isSecureRequest(c),
  });
}

export function buildAuthSessionPayload(user: AuthUser | null): AuthSessionPayload {
  return { user };
}

async function createSession(db: D1Database, userId: string): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
  const sessionToken = randomHex(32);
  const sessionTokenHash = await sha256Hex(sessionToken);

  await db
    .prepare(
      `
        INSERT INTO user_sessions (id, user_id, session_token_hash, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(crypto.randomUUID(), userId, sessionTokenHash, expiresAt, now.toISOString(), now.toISOString())
    .run();

  return sessionToken;
}

async function createAdminSession(db: D1Database): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
  const sessionToken = randomHex(32);
  const sessionTokenHash = await sha256Hex(sessionToken);

  await db
    .prepare(
      `
        INSERT INTO admin_sessions (id, session_token_hash, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
    )
    .bind(crypto.randomUUID(), sessionTokenHash, expiresAt, now.toISOString(), now.toISOString())
    .run();

  return sessionToken;
}

export async function hashPasswordForStorage(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_LENGTH));
  const derived = await derivePasswordHash(password, salt, PASSWORD_HASH_ITERATIONS);
  return `pbkdf2_sha256$${PASSWORD_HASH_ITERATIONS}$${toHex(salt)}$${toHex(derived)}`;
}

export async function verifyPasswordHash(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, iterationsValue, saltHex, hashHex] = storedHash.split("$");
  if (algorithm !== "pbkdf2_sha256" || !iterationsValue || !saltHex || !hashHex) {
    return false;
  }

  const iterations = Number(iterationsValue);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false;
  }

  const derived = await derivePasswordHash(password, fromHex(saltHex), iterations);
  return constantTimeEqual(derived, fromHex(hashHex));
}

async function derivePasswordHash(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const saltBuffer = new ArrayBuffer(salt.byteLength);
  new Uint8Array(saltBuffer).set(salt);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBuffer,
      iterations,
    },
    keyMaterial,
    PASSWORD_HASH_KEY_LENGTH * 8,
  );

  return new Uint8Array(derivedBits);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
}

function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return toHex(bytes);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array {
  if (value.length % 2 !== 0) {
    throw new Error("Hex value has invalid length.");
  }

  const output = new Uint8Array(value.length / 2);

  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }

  return output;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < left.length; index += 1) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return mismatch === 0;
}

function mapAuthUser(row: Pick<UserRow, "id" | "email" | "createdAt">): AuthUser {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.createdAt,
  };
}

function isSecureRequest(c: Context<AppEnv>): boolean {
  return new URL(c.req.url).protocol === "https:";
}
