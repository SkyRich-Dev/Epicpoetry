import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { LoginBody, LoginResponse, GetMeResponse } from "@workspace/api-zod";
import { hashPassword, verifyPassword, createToken, authMiddleware } from "../lib/auth";
import { getEffectivePermissionsForRole } from "./roles";
import { findTenantBySelector, getSaasAccessState, runWithTenantSchema } from "../lib/saas";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const selector =
    typeof body.tenantSchemaName === "string" ? body.tenantSchemaName
    : typeof body.tenant === "string" ? body.tenant
    : typeof req.headers["x-epicpoetry-tenant"] === "string" ? req.headers["x-epicpoetry-tenant"]
    : typeof req.headers["x-platr-tenant"] === "string" ? req.headers["x-platr-tenant"]
    : parsed.data.username.includes("@") ? parsed.data.username
    : null;
  const tenant = await findTenantBySelector(selector);
  const tenantSchemaName = tenant?.tenantSchemaName ?? null;

  const [user] = await runWithTenantSchema(tenantSchemaName, async () => (
    await db.select().from(usersTable).where(eq(usersTable.username, parsed.data.username))
  ));
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
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
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current and new password are required" });
    return;
  }

  if (newPassword.length < 6) {
    res.status(400).json({ error: "New password must be at least 6 characters" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (!verifyPassword(currentPassword, user.passwordHash)) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  await db.update(usersTable).set({ passwordHash: hashPassword(newPassword) }).where(eq(usersTable.id, userId));
  res.json({ message: "Password changed successfully" });
});

export default router;

