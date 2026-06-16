import { pgTable, text, serial, boolean, integer, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vendorsTable } from "./vendors";
import { ingredientsTable } from "./ingredients";
import { purchasesTable } from "./purchases";

export const purchaseOrdersTable = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  poNumber: text("po_number").notNull().unique(),
  vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id),
  status: text("status").notNull().default("draft"), // draft | submitted | approved | sent | partially_received | received | cancelled
  requiredBy: text("required_by"),
  notes: text("notes"),
  totalAmount: doublePrecision("total_amount").notNull().default(0),
  createdBy: integer("created_by"),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const purchaseOrderLinesTable = pgTable("purchase_order_lines", {
  id: serial("id").primaryKey(),
  poId: integer("po_id").notNull().references(() => purchaseOrdersTable.id, { onDelete: "cascade" }),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id),
  qtyOrdered: doublePrecision("qty_ordered").notNull(),
  unitPrice: doublePrecision("unit_price").notNull().default(0),
  qtyReceived: doublePrecision("qty_received").notNull().default(0),
  uom: text("uom").notNull().default("unit"),
});

export const grnRecordsTable = pgTable("grn_records", {
  id: serial("id").primaryKey(),
  grnNumber: text("grn_number").notNull().unique(),
  poId: integer("po_id").references(() => purchaseOrdersTable.id),
  purchaseId: integer("purchase_id").references(() => purchasesTable.id),
  receivedBy: integer("received_by"),
  notes: text("notes"),
  discrepancyFlag: boolean("discrepancy_flag").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrdersTable).omit({ id: true, poNumber: true, createdAt: true, updatedAt: true });
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrder = typeof purchaseOrdersTable.$inferSelect;

export const insertPurchaseOrderLineSchema = createInsertSchema(purchaseOrderLinesTable).omit({ id: true });
export type InsertPurchaseOrderLine = z.infer<typeof insertPurchaseOrderLineSchema>;
