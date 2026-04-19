import { pgTable, serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const mailConfigTable = pgTable("mail_config", {
  id: serial("id").primaryKey(),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port").notNull().default(587),
  smtpUser: text("smtp_user"),
  smtpPass: text("smtp_pass"),
  fromEmail: text("from_email"),
  fromName: text("from_name").notNull().default("Platr"),
  secure: boolean("secure").notNull().default(false),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const notificationRulesTable = pgTable("notification_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  schedule: text("schedule").notNull().default("daily_morning"),
  recipients: jsonb("recipients").notNull().$type<string[]>().default([]),
  threshold: jsonb("threshold").$type<Record<string, number | string>>(),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastStatus: text("last_status"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const notificationLogsTable = pgTable("notification_logs", {
  id: serial("id").primaryKey(),
  ruleId: integer("rule_id").references(() => notificationRulesTable.id, { onDelete: "set null" }),
  ruleName: text("rule_name").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  subject: text("subject"),
  recipientsCount: integer("recipients_count").notNull().default(0),
  recipients: jsonb("recipients").$type<string[]>(),
  error: text("error"),
  trigger: text("trigger").notNull().default("scheduler"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MailConfig = typeof mailConfigTable.$inferSelect;
export type NotificationRule = typeof notificationRulesTable.$inferSelect;
export type NotificationLog = typeof notificationLogsTable.$inferSelect;
