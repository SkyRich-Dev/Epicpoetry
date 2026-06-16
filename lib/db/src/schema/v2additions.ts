import { pgTable, text, serial, boolean, integer, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { employeesTable, shiftsTable } from "./employees";
import { customersTable } from "./customers";
import { salesInvoicesTable } from "./salesInvoices";

// ─── Expense Budgets ─────────────────────────────────────────────────────────
export const expenseBudgetsTable = pgTable("expense_budgets", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id"),
  categoryName: text("category_name").notNull(),
  monthYear: text("month_year").notNull(), // YYYY-MM
  budgetAmount: doublePrecision("budget_amount").notNull().default(0),
  alertAt80: boolean("alert_at_80").notNull().default(true),
  alertAt100: boolean("alert_at_100").notNull().default(true),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertExpenseBudgetSchema = createInsertSchema(expenseBudgetsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertExpenseBudget = z.infer<typeof insertExpenseBudgetSchema>;
export type ExpenseBudget = typeof expenseBudgetsTable.$inferSelect;

// ─── Loyalty Transactions ─────────────────────────────────────────────────────
export const loyaltyTransactionsTable = pgTable("loyalty_transactions", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  invoiceId: integer("invoice_id").references(() => salesInvoicesTable.id),
  transactionType: text("transaction_type").notNull(), // earn | redeem | expire | adjust
  points: doublePrecision("points").notNull(),
  balanceAfter: doublePrecision("balance_after").notNull().default(0),
  notes: text("notes"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLoyaltyTransactionSchema = createInsertSchema(loyaltyTransactionsTable).omit({ id: true, createdAt: true });
export type InsertLoyaltyTransaction = z.infer<typeof insertLoyaltyTransactionSchema>;

// ─── Time Clock ───────────────────────────────────────────────────────────────
export const timeClockTable = pgTable("time_clock", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  shiftId: integer("shift_id").references(() => shiftsTable.id),
  clockDate: text("clock_date").notNull(),
  clockIn: timestamp("clock_in", { withTimezone: true }),
  clockOut: timestamp("clock_out", { withTimezone: true }),
  lateFlag: boolean("late_flag").notNull().default(false),
  earlyDepartureFlag: boolean("early_departure_flag").notNull().default(false),
  overtimeMinutes: integer("overtime_minutes").notNull().default(0),
  overtimeApproved: boolean("overtime_approved").notNull().default(false),
  overtimeApprovedBy: integer("overtime_approved_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTimeClockSchema = createInsertSchema(timeClockTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTimeClock = z.infer<typeof insertTimeClockSchema>;
export type TimeClock = typeof timeClockTable.$inferSelect;

// ─── In-App Notifications (user-facing feed) ──────────────────────────────────
export const inAppNotificationsTable = pgTable("in_app_notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"), // null = broadcast to all
  role: text("role"), // target role, null = all
  type: text("type").notNull().default("info"), // info | warning | critical
  title: text("title").notNull(),
  body: text("body").notNull(),
  link: text("link"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInAppNotificationSchema = createInsertSchema(inAppNotificationsTable).omit({ id: true, createdAt: true });
export type InsertInAppNotification = z.infer<typeof insertInAppNotificationSchema>;
export type InAppNotification = typeof inAppNotificationsTable.$inferSelect;

// ─── Menu Modifiers ───────────────────────────────────────────────────────────
export const menuModifierGroupsTable = pgTable("menu_modifier_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  required: boolean("required").notNull().default(false),
  maxSelections: integer("max_selections").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const menuModifierOptionsTable = pgTable("menu_modifier_options", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => menuModifierGroupsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  priceAdjustment: doublePrecision("price_adjustment").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const menuItemModifierGroupsTable = pgTable("menu_item_modifier_groups", {
  id: serial("id").primaryKey(),
  menuItemId: integer("menu_item_id").notNull(),
  modifierGroupId: integer("modifier_group_id").notNull().references(() => menuModifierGroupsTable.id, { onDelete: "cascade" }),
});

export const insertMenuModifierGroupSchema = createInsertSchema(menuModifierGroupsTable).omit({ id: true, createdAt: true });
export type InsertMenuModifierGroup = z.infer<typeof insertMenuModifierGroupSchema>;
