import { pgTable, text, serial, boolean, integer, doublePrecision, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const eodRecordsTable = pgTable("eod_records", {
  id: serial("id").primaryKey(),
  eodDate: text("eod_date").notNull().unique(),
  status: text("status").notNull().default("open"), // open | pending | approved | locked
  // Sales
  totalSalesSystem: doublePrecision("total_sales_system").notNull().default(0),
  totalInvoices: integer("total_invoices").notNull().default(0),
  // Cash
  cashSalesSystem: doublePrecision("cash_sales_system").notNull().default(0),
  cashPhysical: doublePrecision("cash_physical").notNull().default(0),
  cashVariance: doublePrecision("cash_variance").notNull().default(0),
  denominations: jsonb("denominations").$type<Record<string, number>>(),
  // Card/UPI
  cardSalesSystem: doublePrecision("card_sales_system").notNull().default(0),
  cardPhysical: doublePrecision("card_physical").notNull().default(0),
  upiSalesSystem: doublePrecision("upi_sales_system").notNull().default(0),
  upiPhysical: doublePrecision("upi_physical").notNull().default(0),
  // Petty cash
  pettyCashExpected: doublePrecision("petty_cash_expected").notNull().default(0),
  pettyCashPhysical: doublePrecision("petty_cash_physical").notNull().default(0),
  // Expenses
  totalExpenses: doublePrecision("total_expenses").notNull().default(0),
  // Meta
  notes: text("notes"),
  checklist: jsonb("checklist").$type<Record<string, boolean>>(),
  closedBy: integer("closed_by"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  unlockedBy: integer("unlocked_by"),
  unlockReason: text("unlock_reason"),
  unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const lockedDatesTable = pgTable("locked_dates", {
  id: serial("id").primaryKey(),
  lockedDate: text("locked_date").notNull().unique(),
  lockedBy: integer("locked_by"),
  lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
  unlocked: boolean("unlocked").notNull().default(false),
  unlockReason: text("unlock_reason"),
});

export const insertEodRecordSchema = createInsertSchema(eodRecordsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEodRecord = z.infer<typeof insertEodRecordSchema>;
export type EodRecord = typeof eodRecordsTable.$inferSelect;
