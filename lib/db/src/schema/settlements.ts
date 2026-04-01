import { pgTable, text, serial, integer, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dailySalesSettlementsTable = pgTable("daily_sales_settlements", {
  id: serial("id").primaryKey(),
  settlementDate: text("settlement_date").notNull(),
  grossSalesAmount: doublePrecision("gross_sales_amount").notNull().default(0),
  discountAmount: doublePrecision("discount_amount").notNull().default(0),
  netSalesAmount: doublePrecision("net_sales_amount").notNull().default(0),
  totalSettlementAmount: doublePrecision("total_settlement_amount").notNull().default(0),
  differenceAmount: doublePrecision("difference_amount").notNull().default(0),
  differenceType: text("difference_type").notNull().default("matched"),
  status: text("status").notNull().default("draft"),
  remarks: text("remarks"),
  createdBy: integer("created_by"),
  verifiedBy: integer("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const settlementLinesTable = pgTable("settlement_lines", {
  id: serial("id").primaryKey(),
  settlementId: integer("settlement_id").notNull().references(() => dailySalesSettlementsTable.id, { onDelete: "cascade" }),
  paymentMode: text("payment_mode").notNull(),
  amount: doublePrecision("amount").notNull().default(0),
  referenceNote: text("reference_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSettlementSchema = createInsertSchema(dailySalesSettlementsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSettlement = z.infer<typeof insertSettlementSchema>;
export type Settlement = typeof dailySalesSettlementsTable.$inferSelect;

export const insertSettlementLineSchema = createInsertSchema(settlementLinesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSettlementLine = z.infer<typeof insertSettlementLineSchema>;
export type SettlementLine = typeof settlementLinesTable.$inferSelect;
