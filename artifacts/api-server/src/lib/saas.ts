import crypto from "crypto";

import { db, saasSubscriptionLinkTable, tenantSchemaContext, type SaasSubscriptionLink } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";

function readBool(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export const SAAS_ENFORCEMENT_ENABLED = readBool(process.env.SAAS_ENFORCEMENT_ENABLED);
const INTERNAL_SHARED_SECRET = process.env.PLATR_LINK_SHARED_SECRET?.trim() || "";

export type SaasAccessState = {
  enabled: boolean;
  allowed: boolean;
  reason:
    | "disabled"
    | "active"
    | "grace_period"
    | "trial"
    | "not_provisioned"
    | "customer_disabled"
    | "subscription_inactive"
    | "subscription_expired"
    | "subscription_canceled"
    | "payment_failed";
  link: SaasSubscriptionLink | null;
};

function normalizeSchemaName(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(normalized)) return null;
  if (normalized === "public" || normalized.startsWith("pg_") || normalized === "information_schema") return null;
  return normalized;
}

function secureEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export async function getSaasLink(schemaName?: string | null) {
  const normalizedSchema = normalizeSchemaName(schemaName ?? tenantSchemaContext.getStore() ?? null);
  if (normalizedSchema) {
    const rows = await db.select()
      .from(saasSubscriptionLinkTable)
      .where(eq(saasSubscriptionLinkTable.tenantSchemaName, normalizedSchema))
      .limit(1);
    return rows[0] ?? null;
  }

  const rows = await db.select()
    .from(saasSubscriptionLinkTable)
    .orderBy(desc(saasSubscriptionLinkTable.updatedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function getSaasAccessState(schemaName?: string | null): Promise<SaasAccessState> {
  if (!SAAS_ENFORCEMENT_ENABLED) {
    return { enabled: false, allowed: true, reason: "disabled", link: null };
  }

  const link = await getSaasLink(schemaName);
  if (!link) {
    return { enabled: true, allowed: false, reason: "not_provisioned", link };
  }

  if ((link.customerStatus || "active") !== "active") {
    return { enabled: true, allowed: false, reason: "customer_disabled", link };
  }

  const status = (link.subscriptionStatus || "").toLowerCase();
  const now = Date.now();
  const trialEndsAt = link.trialEndsAt ? new Date(link.trialEndsAt).getTime() : null;
  const periodEndsAt = link.currentPeriodEnd ? new Date(link.currentPeriodEnd).getTime() : null;
  const graceEndsAt = link.graceEndsAt ? new Date(link.graceEndsAt).getTime() : null;

  if (status === "active" || status === "trialing") {
    if (periodEndsAt && periodEndsAt < now) {
      return { enabled: true, allowed: false, reason: "subscription_expired", link };
    }
    return { enabled: true, allowed: true, reason: "active", link };
  }

  if (status === "past_due") {
    if (graceEndsAt && graceEndsAt >= now) {
      return { enabled: true, allowed: true, reason: "grace_period", link };
    }
    return { enabled: true, allowed: false, reason: "payment_failed", link };
  }

  if (status === "canceled") {
    return { enabled: true, allowed: false, reason: "subscription_canceled", link };
  }

  if (status === "expired") {
    return { enabled: true, allowed: false, reason: "subscription_expired", link };
  }

  if (status === "pending" && trialEndsAt && trialEndsAt >= now) {
    return { enabled: true, allowed: true, reason: "trial", link };
  }

  return { enabled: true, allowed: false, reason: "subscription_inactive", link };
}

export function runWithTenantSchema<T>(schemaName: string | null | undefined, fn: () => T): T {
  const normalizedSchema = normalizeSchemaName(schemaName ?? null);
  if (!normalizedSchema) return fn();
  return tenantSchemaContext.run(normalizedSchema, fn);
}

export async function findTenantBySelector(selector: string | null | undefined) {
  const value = selector?.trim();
  if (!value) {
    const rows = await db.select()
      .from(saasSubscriptionLinkTable)
      .orderBy(desc(saasSubscriptionLinkTable.updatedAt))
      .limit(2);
    return rows.length === 1 ? rows[0] ?? null : null;
  }
  const normalizedSchema = normalizeSchemaName(value);

  const rows = normalizedSchema
    ? await db.select().from(saasSubscriptionLinkTable).where(eq(saasSubscriptionLinkTable.tenantSchemaName, normalizedSchema)).limit(1)
    : await db.select().from(saasSubscriptionLinkTable).where(eq(saasSubscriptionLinkTable.platrCustomerEmail, value)).limit(1);
  return rows[0] ?? null;
}

export async function enforceSaasAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const state = await getSaasAccessState((req as any).tenantSchemaName);
  if (state.allowed) {
    next();
    return;
  }

  const descriptionByReason: Record<Exclude<SaasAccessState["reason"], "disabled" | "active" | "trial" | "grace_period">, string> = {
    not_provisioned: "This Epicpoetry instance is not linked to a Platr subscription yet.",
    customer_disabled: "This customer account is disabled in Platr-Link.",
    subscription_inactive: "Your subscription is not active. Please renew or reactivate it in Platr-Link.",
    subscription_expired: "Your subscription has expired. Please renew it in Platr-Link.",
    subscription_canceled: "Your subscription has been canceled in Platr-Link.",
    payment_failed: "Your payment grace period has ended. Please renew in Platr-Link.",
  };

  res.status(402).json({
    error: descriptionByReason[state.reason as keyof typeof descriptionByReason] ?? "Subscription inactive",
    reason: state.reason,
  });
}

export function requirePlatrInternalSecret(req: Request, res: Response, next: NextFunction): void {
  if (!INTERNAL_SHARED_SECRET) {
    res.status(503).json({ error: "Platr-Link integration secret is not configured on this Epicpoetry instance." });
    return;
  }

  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
  const provided = bearer || String(req.headers["x-platr-link-secret"] || "").trim();

  if (!provided || !secureEquals(provided, INTERNAL_SHARED_SECRET)) {
    res.status(401).json({ error: "Unauthorized internal integration request" });
    return;
  }

  next();
}




