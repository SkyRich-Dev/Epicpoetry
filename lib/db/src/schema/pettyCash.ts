import { pgTable, text, serial, integer, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { expensesTable } from "./expenses";

export const pettyCashLedgerTable = pgTable("petty_cash_ledger", {
  id: serial("id").primaryKey(),
  transactionDate: text("transaction_date").notNull(),
  transactionType: text("transaction_type").notNull(),
  amount: doublePrecision("amount").notNull(),
  method: text("method"),
  counterpartyName: text("counterparty_name"),
  category: text("category"),
  linkedExpenseId: integer("linked_expense_id").references(() => expensesTable.id),
  description: text("description"),
  runningBalance: doublePrecision("running_balance").notNull().default(0),
  approvalStatus: text("approval_status").notNull().default("approved"),
  createdBy: integer("created_by"),
  approvedBy: integer("approved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPettyCashSchema = createInsertSchema(pettyCashLedgerTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPettyCash = z.infer<typeof insertPettyCashSchema>;
export type PettyCash = typeof pettyCashLedgerTable.$inferSelect;
