import { pgTable, text, serial, boolean, integer, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { salesInvoicesTable } from "./salesInvoices";

export const restaurantTablesTable = pgTable("restaurant_tables", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  section: text("section").notNull().default("Indoor"),
  capacity: integer("capacity").notNull().default(4),
  tableType: text("table_type").notNull().default("square"),
  displayX: integer("display_x").notNull().default(0),
  displayY: integer("display_y").notNull().default(0),
  status: text("status").notNull().default("free"), // free | occupied | reserved | cleaning
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const tableSessionsTable = pgTable("table_sessions", {
  id: serial("id").primaryKey(),
  tableId: integer("table_id").notNull().references(() => restaurantTablesTable.id),
  invoiceId: integer("invoice_id").references(() => salesInvoicesTable.id),
  coverCount: integer("cover_count").notNull().default(1),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  openedBy: integer("opened_by"),
  notes: text("notes"),
});

export const tableReservationsTable = pgTable("table_reservations", {
  id: serial("id").primaryKey(),
  tableId: integer("table_id").references(() => restaurantTablesTable.id),
  guestName: text("guest_name").notNull(),
  guestPhone: text("guest_phone"),
  partySize: integer("party_size").notNull().default(1),
  reservedAt: text("reserved_at").notNull(), // ISO date-time string
  notes: text("notes"),
  status: text("status").notNull().default("pending"), // pending | confirmed | seated | cancelled | no-show
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const kotOrdersTable = pgTable("kot_orders", {
  id: serial("id").primaryKey(),
  kotNumber: text("kot_number").notNull().unique(),
  invoiceId: integer("invoice_id").references(() => salesInvoicesTable.id),
  tableId: integer("table_id").references(() => restaurantTablesTable.id),
  tableName: text("table_name"),
  status: text("status").notNull().default("new"), // new | preparing | ready | served | cancelled
  expedite: boolean("expedite").notNull().default(false),
  notes: text("notes"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const kotItemsTable = pgTable("kot_items", {
  id: serial("id").primaryKey(),
  kotId: integer("kot_id").notNull().references(() => kotOrdersTable.id, { onDelete: "cascade" }),
  menuItemId: integer("menu_item_id").notNull(),
  menuItemName: text("menu_item_name").notNull(),
  quantity: doublePrecision("quantity").notNull().default(1),
  modifiers: text("modifiers"),
  notes: text("notes"),
  status: text("status").notNull().default("new"), // new | preparing | ready | served | cancelled
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRestaurantTableSchema = createInsertSchema(restaurantTablesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRestaurantTable = z.infer<typeof insertRestaurantTableSchema>;
export type RestaurantTable = typeof restaurantTablesTable.$inferSelect;

export const insertTableSessionSchema = createInsertSchema(tableSessionsTable).omit({ id: true });
export type InsertTableSession = z.infer<typeof insertTableSessionSchema>;

export const insertReservationSchema = createInsertSchema(tableReservationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReservation = z.infer<typeof insertReservationSchema>;

export const insertKotOrderSchema = createInsertSchema(kotOrdersTable).omit({ id: true, kotNumber: true, createdAt: true, updatedAt: true });
export type InsertKotOrder = z.infer<typeof insertKotOrderSchema>;
