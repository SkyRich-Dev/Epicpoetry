import { pgTable, text, serial, boolean, integer, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { categoriesTable } from "./categories";
import { vendorsTable } from "./vendors";

export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  expenseNumber: text("expense_number").notNull().unique(),
  expenseDate: text("expense_date").notNull(),
  categoryId: integer("category_id").references(() => categoriesTable.id),
  vendorId: integer("vendor_id").references(() => vendorsTable.id),
  amount: doublePrecision("amount").notNull(),
  taxAmount: doublePrecision("tax_amount").notNull().default(0),
  totalAmount: doublePrecision("total_amount").notNull().default(0),
  paymentMode: text("payment_mode"),
  paidBy: text("paid_by"),
  description: text("description"),
  costType: text("cost_type").notNull().default("variable"),
  recurring: boolean("recurring").notNull().default(false),
  recurringFrequency: text("recurring_frequency"),
  linkedPettyCashId: integer("linked_petty_cash_id"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertExpenseSchema = createInsertSchema(expensesTable).omit({ id: true, expenseNumber: true, totalAmount: true, createdAt: true, updatedAt: true });
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expensesTable.$inferSelect;
