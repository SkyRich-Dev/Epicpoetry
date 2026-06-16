import { pgTable, text, serial, boolean, integer, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ingredientsTable } from "./ingredients";

export const stocktakesTable = pgTable("stocktakes", {
  id: serial("id").primaryKey(),
  stocktakeNumber: text("stocktake_number").notNull().unique(),
  scope: text("scope").notNull().default("full"), // full | category | custom
  scopeDetail: text("scope_detail"),
  status: text("status").notNull().default("in_progress"), // in_progress | pending_approval | approved | rejected
  frozenAt: timestamp("frozen_at", { withTimezone: true }).notNull().defaultNow(),
  totalVarianceCost: doublePrecision("total_variance_cost").notNull().default(0),
  initiatedBy: integer("initiated_by"),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const stocktakeLinesTable = pgTable("stocktake_lines", {
  id: serial("id").primaryKey(),
  stocktakeId: integer("stocktake_id").notNull().references(() => stocktakesTable.id, { onDelete: "cascade" }),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id),
  expectedQty: doublePrecision("expected_qty").notNull().default(0),
  actualQty: doublePrecision("actual_qty"),
  variance: doublePrecision("variance"),
  varianceCost: doublePrecision("variance_cost").notNull().default(0),
  uom: text("uom").notNull().default("unit"),
  counted: boolean("counted").notNull().default(false),
});

export const insertStocktakeSchema = createInsertSchema(stocktakesTable).omit({ id: true, stocktakeNumber: true, createdAt: true, updatedAt: true });
export type InsertStocktake = z.infer<typeof insertStocktakeSchema>;
export type Stocktake = typeof stocktakesTable.$inferSelect;

export const insertStocktakeLineSchema = createInsertSchema(stocktakeLinesTable).omit({ id: true });
export type InsertStocktakeLine = z.infer<typeof insertStocktakeLineSchema>;
