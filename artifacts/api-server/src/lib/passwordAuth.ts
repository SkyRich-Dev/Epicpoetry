import crypto from "node:crypto";
import type { Request } from "express";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { authTokensTable, db, tenantSchemaContext, usersTable } from "@workspace/db";
import { hashPassword } from "./auth";

export const PASSWORD_TOKEN_PURPOSES = {
  setup: "password_setup",
  reset: "password_reset",
  change: "password_change",
} as const;

export type PasswordTokenPurpose = typeof PASSWORD_TOKEN_PURPOSES[keyof typeof PASSWORD_TOKEN_PURPOSES];

export type PasswordTokenPayload = {
  userId: number;
  purpose: PasswordTokenPurpose;
  metadata: Record<string, unknown> | null;
  expiresAt: string;
  email: string | null;
  username: string;
  fullName: string;
  passwordSet: boolean;
  active: boolean;
};

const PURPOSE_SET = new Set<PasswordTokenPurpose>(Object.values(PASSWORD_TOKEN_PURPOSES));
const DEFAULT_EXPIRY_HOURS = 24;
const PASSWORD_MIN_LENGTH = 6;

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function encodeScopedToken(schemaName: string | null | undefined, rawToken: string): string {
  const scope = schemaName?.trim() || "public";
  return `${scope}.${rawToken}`;
}

function splitScopedToken(scopedToken: string): { schemaName: string | null; rawToken: string } | null {
  const index = scopedToken.indexOf(".");
  if (index <= 0 || index === scopedToken.length - 1) return null;
  const scope = scopedToken.slice(0, index).trim();
  const rawToken = scopedToken.slice(index + 1).trim();
  if (!rawToken) return null;
  return {
    schemaName: scope === "public" ? null : scope,
    rawToken,
  };
}

export function generatePasswordToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function isValidPasswordPurpose(value: string): value is PasswordTokenPurpose {
  return PURPOSE_SET.has(value as PasswordTokenPurpose);
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  return null;
}

export async function revokeOutstandingTokens(userId: number, purposes?: PasswordTokenPurpose[]) {
  const conditions = [eq(authTokensTable.userId, userId), isNull(authTokensTable.usedAt)] as any[];
  if (purposes?.length) conditions.push(inArray(authTokensTable.purpose, purposes));
  await db.delete(authTokensTable).where(and(...conditions));
}

export async function issuePasswordToken(opts: {
  userId: number;
  purpose: PasswordTokenPurpose;
  metadata?: Record<string, unknown> | null;
  expiresInHours?: number;
}) {
  const rawToken = generatePasswordToken();
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + (opts.expiresInHours ?? DEFAULT_EXPIRY_HOURS) * 60 * 60 * 1000);
  const scopedToken = encodeScopedToken(tenantSchemaContext.getStore() ?? null, rawToken);

  await revokeOutstandingTokens(opts.userId, [opts.purpose]);
  await db.insert(authTokensTable).values({
    userId: opts.userId,
    purpose: opts.purpose,
    tokenHash,
    metadata: opts.metadata ?? null,
    expiresAt,
  });

  return { rawToken: scopedToken, expiresAt };
}

export async function findPasswordToken(rawToken: string, expectedPurpose?: PasswordTokenPurpose): Promise<PasswordTokenPayload | null> {
  const tokenHash = sha256(rawToken);
  const [row] = await db.select({
    id: authTokensTable.id,
    userId: authTokensTable.userId,
    purpose: authTokensTable.purpose,
    metadata: authTokensTable.metadata,
    expiresAt: authTokensTable.expiresAt,
    usedAt: authTokensTable.usedAt,
    email: usersTable.email,
    username: usersTable.username,
    fullName: usersTable.fullName,
    passwordSet: usersTable.passwordSet,
    active: usersTable.active,
  }).from(authTokensTable)
    .innerJoin(usersTable, eq(usersTable.id, authTokensTable.userId))
    .where(eq(authTokensTable.tokenHash, tokenHash))
    .limit(1);

  if (!row) return null;
  if (!isValidPasswordPurpose(row.purpose)) return null;
  if (expectedPurpose && row.purpose !== expectedPurpose) return null;
  if (row.usedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  return {
    userId: row.userId,
    purpose: row.purpose,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    expiresAt: row.expiresAt.toISOString(),
    email: row.email ?? null,
    username: row.username,
    fullName: row.fullName,
    passwordSet: row.passwordSet,
    active: row.active,
  };
}

export async function inspectPasswordToken(rawToken: string) {
  const tokenHash = sha256(rawToken);
  const [row] = await db.select({
    purpose: authTokensTable.purpose,
    expiresAt: authTokensTable.expiresAt,
    usedAt: authTokensTable.usedAt,
    metadata: authTokensTable.metadata,
    userId: usersTable.id,
    email: usersTable.email,
    username: usersTable.username,
    fullName: usersTable.fullName,
    passwordSet: usersTable.passwordSet,
    active: usersTable.active,
  }).from(authTokensTable)
    .innerJoin(usersTable, eq(usersTable.id, authTokensTable.userId))
    .where(eq(authTokensTable.tokenHash, tokenHash))
    .limit(1);

  if (!row || !isValidPasswordPurpose(row.purpose)) return null;
  const expired = row.expiresAt.getTime() < Date.now();
  const used = !!row.usedAt;
  return {
    purpose: row.purpose,
    expiresAt: row.expiresAt.toISOString(),
    used,
    expired,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    userId: row.userId,
    email: row.email ?? null,
    username: row.username,
    fullName: row.fullName,
    passwordSet: row.passwordSet,
    active: row.active,
  };
}

export async function markPasswordTokenUsed(rawToken: string) {
  const scoped = splitScopedToken(rawToken);
  const tokenHash = sha256(scoped?.rawToken ?? rawToken);
  await db.update(authTokensTable)
    .set({ usedAt: new Date() })
    .where(eq(authTokensTable.tokenHash, tokenHash));
}

export async function applyUserPassword(userId: number, password: string) {
  const message = validatePasswordStrength(password);
  if (message) throw new Error(message);

  await db.update(usersTable).set({
    passwordHash: hashPassword(password),
    passwordSet: true,
    passwordSetupCompletedAt: new Date(),
  }).where(eq(usersTable.id, userId));
}

export async function applyPreHashedUserPassword(userId: number, passwordHash: string) {
  await db.update(usersTable).set({
    passwordHash,
    passwordSet: true,
    passwordSetupCompletedAt: new Date(),
  }).where(eq(usersTable.id, userId));
}

export async function deleteExpiredPasswordTokens() {
  await db.delete(authTokensTable).where(and(isNull(authTokensTable.usedAt), lt(authTokensTable.expiresAt, new Date())));
}

export function resolveTokenSchemaName(scopedToken: string): string | null {
  return splitScopedToken(scopedToken)?.schemaName ?? null;
}

export function stripScopedToken(scopedToken: string): string {
  return splitScopedToken(scopedToken)?.rawToken ?? scopedToken;
}

export function resolveSiteUrl(req?: Request): string {
  const explicit = process.env.SITE_URL?.trim() || process.env.EPICPOETRY_SAAS_BASE_URL?.trim() || "";
  if (explicit) return explicit.replace(/\/+$/, "");
  if (!req) return "";
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (!host) return "";
  return `${proto}://${host}`.replace(/\/+$/, "");
}
