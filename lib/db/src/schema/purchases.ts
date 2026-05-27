import { pgTable, text, serial, boolean, integer, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vendorsTable } from "./vendors";
import { ingredientsTable } from "./ingredients";

export const purchasesTable = pgTable("purchases", {
  id: serial("id").primaryKey(),
  purchaseNumber: text("purchase_number").notNull().unique(),
  purchaseDate: text("purchase_date").notNull(),
  vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id),
  invoiceNumber: text("invoice_number"),
  vendorInvoiceNumber: text("vendor_invoice_number"),
  dueDate: text("due_date"),
  grossAmount: doublePrecision("gross_amount").notNull().default(0),
  taxAmount: doublePrecision("tax_amount").notNull().default(0),
  discountAmount: doublePrecision("discount_amount").notNull().default(0),
  paymentMode: text("payment_mode"),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  totalAmount: doublePrecision("total_amount").notNull().default(0),
  paidAmount: doublePrecision("paid_amount").notNull().default(0),
  pendingAmount: doublePrecision("pending_amount").notNull().default(0),
  billAttachment: text("bill_attachment"),
  lastPaymentDate: text("last_payment_date"),
  linkedExpenseId: integer("linked_expense_id"),
  notes: text("notes"),
  remarks: text("remarks"),
  createdBy: integer("created_by"),
  verified: boolean("verified").notNull().default(false),
  verifiedBy: integer("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const purchaseLinesTable = pgTable("purchase_lines", {
  id: serial("id").primaryKey(),
  purchaseId: integer("purchase_id").notNull().references(() => purchasesTable.id),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id),
  quantity: doublePrecision("quantity").notNull(),
  purchaseUom: text("purchase_uom").notNull().default("unit"),
  unitRate: doublePrecision("unit_rate").notNull(),
  taxPercent: doublePrecision("tax_percent").notNull().default(0),
  lineTotal: doublePrecision("line_total").notNull().default(0),
  expiryDate: text("expiry_date"),
});

export const insertPurchaseSchema = createInsertSchema(purchasesTable).omit({ id: true, purchaseNumber: true, totalAmount: true, createdAt: true, updatedAt: true });
export type InsertPurchase = z.infer<typeof insertPurchaseSchema>;
export type Purchase = typeof purchasesTable.$inferSelect;

export const insertPurchaseLineSchema = createInsertSchema(purchaseLinesTable).omit({ id: true });
export type InsertPurchaseLine = z.infer<typeof insertPurchaseLineSchema>;
export type PurchaseLine = typeof purchaseLinesTable.$inferSelect;
