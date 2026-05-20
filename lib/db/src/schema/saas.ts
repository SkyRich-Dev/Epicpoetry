import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const saasSubscriptionLinkTable = pgTable("saas_subscription_link", {
  id: serial("id").primaryKey(),
  platrCustomerId: integer("platr_customer_id").notNull().unique(),
  platrSubscriptionId: integer("platr_subscription_id"),
  platrPackageId: integer("platr_package_id"),
  platrCustomerEmail: text("platr_customer_email"),
  platrCustomerName: text("platr_customer_name"),
  companyName: text("company_name"),
  packageSlug: text("package_slug"),
  packageName: text("package_name"),
  plan: text("plan"),
  subscriptionStatus: text("subscription_status").notNull().default("pending"),
  customerStatus: text("customer_status").notNull().default("active"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
  paymentFailedAt: timestamp("payment_failed_at", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  epicpoetryInstanceKey: text("epicpoetry_instance_key"),
  tenantStrategy: text("tenant_strategy").notNull().default("single_instance"),
  tenantExternalId: text("tenant_external_id"),
  tenantSchemaName: text("tenant_schema_name"),
  featuresJson: jsonb("features_json").$type<Record<string, unknown> | string[]>().notNull().default({}),
  billingMeta: jsonb("billing_meta").$type<Record<string, unknown>>(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncSource: text("last_sync_source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSaasSubscriptionLinkSchema = createInsertSchema(saasSubscriptionLinkTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSaasSubscriptionLink = z.infer<typeof insertSaasSubscriptionLinkSchema>;
export type SaasSubscriptionLink = typeof saasSubscriptionLinkTable.$inferSelect;

