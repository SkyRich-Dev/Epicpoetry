import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { LoginBody, LoginResponse, GetMeResponse } from "@workspace/api-zod";
import { hashPassword, verifyPassword, createToken, authMiddleware } from "../lib/auth";
import { getEffectivePermissionsForRole } from "./roles";
import { findTenantBySelector, getSaasAccessState, runWithTenantSchema } from "../lib/saas";
import {
  PASSWORD_TOKEN_PURPOSES,
  applyPreHashedUserPassword,
  applyUserPassword,
  findPasswordToken,
  inspectPasswordToken,
  issuePasswordToken,
  markPasswordTokenUsed,
  resolveTokenSchemaName,
  stripScopedToken,
  validatePasswordStrength,
} from "../lib/passwordAuth";
import { sendPasswordActionEmail } from "../lib/accountEmails";
import { z } from "zod";

const router: IRouter = Router();

const PasswordTokenParams = z.object({
  token: z.string().min(32),
});

const PasswordSetupBody = z.object({
  token: z.string().min(32),
  password: z.string(),
  confirmPassword: z.string(),
});

const ForgotPasswordBody = z.object({
  username: z.string().trim().min(1),
  tenant: z.string().trim().optional(),
});

const ChangePasswordRequestBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string(),
});

function resolveTenantSelector(req: any, username: string) {
  const body = req.body as Record<string, unknown>;
  return typeof body.tenantSchemaName === "string" ? body.tenantSchemaName
    : typeof body.tenant === "string" ? body.tenant
    : typeof req.headers["x-epicpoetry-tenant"] === "string" ? req.headers["x-epicpoetry-tenant"]
    : typeof req.headers["x-platr-tenant"] === "string" ? req.headers["x-platr-tenant"]
    : username.includes("@") ? username
    : null;
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const selector = resolveTenantSelector(req, parsed.data.username);
  const tenant = await findTenantBySelector(selector);
  const tenantSchemaName = tenant?.tenantSchemaName ?? null;

  const [user] = await runWithTenantSchema(tenantSchemaName, async () => (
    await db.select().from(usersTable).where(eq(usersTable.username, parsed.data.username))
  ));
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  if (!user.passwordHash) {
    res.status(403).json({
      error: "Your account setup is not completed. Please check your email and create your password.",
      reason: "password_setup_required",
    });
    return;
  }

  if (!verifyPassword(parsed.data.password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  if (!user.active) {
    res.status(403).json({ error: "Account is inactive" });
    return;
  }

  const saasState = await getSaasAccessState(tenantSchemaName);
  if (!saasState.allowed) {
    const messageByReason: Record<string, string> = {
      not_provisioned: "This Epicpoetry instance is not linked to a Platr subscription yet.",
      customer_disabled: "This customer account is disabled in Platr-Link.",
      subscription_inactive: "Your subscription is not active. Please renew or reactivate it in Platr-Link.",
      subscription_expired: "Your subscription has expired. Please renew it in Platr-Link.",
      subscription_canceled: "Your subscription has been canceled in Platr-Link.",
      payment_failed: "Your payment grace period has ended. Please renew in Platr-Link.",
    };
    res.status(402).json({ error: messageByReason[saasState.reason] || "Subscription inactive", reason: saasState.reason });
    return;
  }

  const token = createToken({ userId: user.id, role: user.role, tenantSchemaName });
  res.json(LoginResponse.parse({
    token,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt.toISOString(),
    },
  }));
});

router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const selector = parsed.data.tenant || parsed.data.username;
  const tenant = await findTenantBySelector(selector);
  const tenantSchemaName = tenant?.tenantSchemaName ?? null;

  const [user] = await runWithTenantSchema(tenantSchemaName, async () => {
    const byUsername = await db.select().from(usersTable).where(eq(usersTable.username, parsed.data.username)).limit(1);
    if (byUsername[0]) return byUsername;
    if (!parsed.data.username.includes("@")) return [];
    return db.select().from(usersTable).where(eq(usersTable.email, parsed.data.username)).limit(1);
  });

  if (!user || !user.email) {
    res.json({ ok: true, message: "If the account exists, a password reset email has been sent." });
    return;
  }

  const result = await runWithTenantSchema(tenantSchemaName, async () => {
    const { rawToken, expiresAt } = await issuePasswordToken({
      userId: user.id,
      purpose: PASSWORD_TOKEN_PURPOSES.reset,
    });
    return sendPasswordActionEmail({
      req,
      to: user.email!,
      fullName: user.fullName,
      rawToken,
      expiresAt,
      purpose: PASSWORD_TOKEN_PURPOSES.reset,
    });
  });

  res.json({
    ok: true,
    message: "If the account exists, a password reset email has been sent.",
    delivery: result.ok ? "sent" : "pending",
  });
});

router.get("/auth/password-tokens/:token", async (req, res): Promise<void> => {
  const parsed = PasswordTokenParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const inspection = await runWithTenantSchema(resolveTokenSchemaName(parsed.data.token), async () => (
    inspectPasswordToken(stripScopedToken(parsed.data.token))
  ));
  if (!inspection) {
    res.status(404).json({ error: "Invalid password action link" });
    return;
  }

  res.json({
    purpose: inspection.purpose,
    expiresAt: inspection.expiresAt,
    used: inspection.used,
    expired: inspection.expired,
    email: inspection.email,
    username: inspection.username,
    fullName: inspection.fullName,
    passwordSet: inspection.passwordSet,
    requiresPasswordInput: inspection.purpose !== PASSWORD_TOKEN_PURPOSES.change,
  });
});

router.post("/auth/password-tokens/complete", async (req, res): Promise<void> => {
  const rawToken = typeof req.body?.token === "string" ? req.body.token : "";
  const inspection = rawToken
    ? await runWithTenantSchema(resolveTokenSchemaName(rawToken), async () => inspectPasswordToken(stripScopedToken(rawToken)))
    : null;
  if (!inspection) {
    res.status(404).json({ error: "Invalid password action link" });
    return;
  }
  if (inspection.used) {
    res.status(409).json({ error: "This password action link has already been used." });
    return;
  }
  if (inspection.expired) {
    res.status(410).json({ error: "This password action link has expired." });
    return;
  }

  const tokenSchemaName = resolveTokenSchemaName(rawToken);
  const normalizedRawToken = stripScopedToken(rawToken);

  if (inspection.purpose === PASSWORD_TOKEN_PURPOSES.change) {
    const token = await runWithTenantSchema(tokenSchemaName, async () => findPasswordToken(normalizedRawToken, PASSWORD_TOKEN_PURPOSES.change));
    const nextPasswordHash = typeof token?.metadata?.nextPasswordHash === "string" ? token.metadata.nextPasswordHash : "";
    if (!token || !nextPasswordHash) {
      res.status(400).json({ error: "This password change request is invalid." });
      return;
    }
    await runWithTenantSchema(tokenSchemaName, async () => {
      await applyPreHashedUserPassword(token.userId, nextPasswordHash);
      await markPasswordTokenUsed(normalizedRawToken);
    });
    res.json({ ok: true, message: "Password changed successfully. You can now sign in with your new password." });
    return;
  }

  const parsed = PasswordSetupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.password !== parsed.data.confirmPassword) {
    res.status(400).json({ error: "Passwords do not match" });
    return;
  }
  const passwordError = validatePasswordStrength(parsed.data.password);
  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }

  const expectedPurpose = inspection.purpose === PASSWORD_TOKEN_PURPOSES.setup
    ? PASSWORD_TOKEN_PURPOSES.setup
    : PASSWORD_TOKEN_PURPOSES.reset;
  const token = await runWithTenantSchema(tokenSchemaName, async () => findPasswordToken(normalizedRawToken, expectedPurpose));
  if (!token) {
    res.status(404).json({ error: "Invalid password action link" });
    return;
  }

  await runWithTenantSchema(tokenSchemaName, async () => {
    await applyUserPassword(token.userId, parsed.data.password);
    await markPasswordTokenUsed(normalizedRawToken);
  });
  res.json({
    ok: true,
    message: expectedPurpose === PASSWORD_TOKEN_PURPOSES.setup
      ? "Password created successfully. You can now sign in."
      : "Password reset successfully. You can now sign in.",
  });
});

router.get("/auth/me", authMiddleware, async (req, res): Promise<void> => {
  const userId = (req as any).userId;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const permissions = await getEffectivePermissionsForRole(user.role);
  res.json({
    ...GetMeResponse.parse({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt.toISOString(),
    }),
    permissions,
  });
});

router.post("/auth/change-password", authMiddleware, async (req, res): Promise<void> => {
  const userId = (req as any).userId;
  const parsed = ChangePasswordRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { currentPassword, newPassword } = parsed.data;

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current and new password are required" });
    return;
  }

  const passwordError = validatePasswordStrength(newPassword);
  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (!user.passwordHash || !verifyPassword(currentPassword, user.passwordHash)) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  if (!user.email) {
    res.status(400).json({ error: "Your account does not have an email address configured for verification." });
    return;
  }

  const { rawToken, expiresAt } = await issuePasswordToken({
    userId: user.id,
    purpose: PASSWORD_TOKEN_PURPOSES.change,
    metadata: { nextPasswordHash: hashPassword(newPassword) },
  });
  const delivery = await sendPasswordActionEmail({
    req,
    to: user.email,
    fullName: user.fullName,
    rawToken,
    expiresAt,
    purpose: PASSWORD_TOKEN_PURPOSES.change,
  });

  if (!delivery.ok) {
    res.status(500).json({ error: delivery.error || "Failed to send verification email" });
    return;
  }

  res.json({ message: "Verification email sent. Confirm the change from your inbox." });
});

export default router;

