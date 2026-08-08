import { pgTable, text, serial, boolean, integer, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { categoriesTable } from "./categories";
import { vendorsTable } from "./vendors";

export const ingredientsTable = pgTable("ingredients", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  categoryId: integer("category_id").references(() => categoriesTable.id),
  description: text("description"),
  stockUom: text("stock_uom").notNull(),
  purchaseUom: text("purchase_uom").notNull(),
  recipeUom: text("recipe_uom").notNull(),
  conversionFactor: doublePrecision("conversion_factor").notNull().default(1),
  currentCost: doublePrecision("current_cost").notNull().default(0),
  latestCost: doublePrecision("latest_cost").notNull().default(0),
  weightedAvgCost: doublePrecision("weighted_avg_cost").notNull().default(0),
  reorderLevel: doublePrecision("reorder_level").notNull().default(0),
  currentStock: doublePrecision("current_stock").notNull().default(0),
  godownStock: doublePrecision("godown_stock").notNull().default(0),
  perishable: boolean("perishable").notNull().default(false),
  shelfLifeDays: integer("shelf_life_days"),
  active: boolean("active").notNull().default(true),
  verified: boolean("verified").notNull().default(false),
  verifiedBy: integer("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const ingredientVendorMappingTable = pgTable("ingredient_vendor_mapping", {
  id: serial("id").primaryKey(),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id),
  vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id),
  vendorItemName: text("vendor_item_name"),
  purchaseUom: text("purchase_uom").notNull(),
  conversionFactor: doublePrecision("conversion_factor").notNull().default(1),
  latestRate: doublePrecision("latest_rate").notNull().default(0),
  taxPercent: doublePrecision("tax_percent").notNull().default(0),
  landedCost: doublePrecision("landed_cost").notNull().default(0),
  leadTimeDays: integer("lead_time_days"),
  minOrderQty: doublePrecision("min_order_qty"),
  preferred: boolean("preferred").notNull().default(false),
  active: boolean("active").notNull().default(true),
});

export const insertIngredientSchema = createInsertSchema(ingredientsTable).omit({ id: true, code: true, createdAt: true, updatedAt: true });
export type InsertIngredient = z.infer<typeof insertIngredientSchema>;
export type Ingredient = typeof ingredientsTable.$inferSelect;

export const insertIngredientVendorMappingSchema = createInsertSchema(ingredientVendorMappingTable).omit({ id: true });
export type InsertIngredientVendorMapping = z.infer<typeof insertIngredientVendorMappingSchema>;
export type IngredientVendorMapping = typeof ingredientVendorMappingTable.$inferSelect;
