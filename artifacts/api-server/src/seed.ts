import { db, usersTable, categoriesTable, uomTable, systemConfigTable, vendorsTable, ingredientsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { seedBuiltInRoles } from "./routes/roles";

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

export async function seed() {
  // Always (idempotently) ensure built-in roles + their default
  // permission sets are present, even on already-seeded databases.
  // This lets us ship new permissions in code and have them applied
  // on the next boot without a separate migration.
  await seedBuiltInRoles();

  const existingUsers = await db.select().from(usersTable);
  if (existingUsers.length > 0) {
    console.log("Seed: Database already has data, skipping seed.");
    return;
  }

  console.log("Seeding database...");

  await db.insert(usersTable).values([
    {
      username: "admin",
      passwordHash: hashPassword("admin123"),
      fullName: "Admin User",
      email: "admin@epicpoetrycafe.com",
      role: "admin",
      active: true,
    },
    {
      username: "manager",
      passwordHash: hashPassword("manager123"),
      fullName: "Cafe Manager",
      email: "manager@epicpoetrycafe.com",
      role: "manager",
      active: true,
    },
  ]);

  await db.insert(systemConfigTable).values({
    costingMethod: "weighted_average",
    currency: "INR",
    decimalPrecision: 2,
    businessDayCloseTime: "23:00",
    wasteThresholdPercent: 5,
    lowStockAlertDays: 3,
  });

  const catData = [
    { name: "Hot Beverages", type: "menu", sortOrder: 1 },
    { name: "Cold Beverages", type: "menu", sortOrder: 2 },
    { name: "Food - Snacks", type: "menu", sortOrder: 3 },
    { name: "Food - Main", type: "menu", sortOrder: 4 },
    { name: "Desserts", type: "menu", sortOrder: 5 },
    { name: "Dairy", type: "ingredient", sortOrder: 1 },
    { name: "Dry Goods", type: "ingredient", sortOrder: 2 },
    { name: "Produce", type: "ingredient", sortOrder: 3 },
    { name: "Beverages Raw", type: "ingredient", sortOrder: 4 },
    { name: "Packaging", type: "ingredient", sortOrder: 5 },
    { name: "Rent", type: "expense", sortOrder: 1 },
    { name: "Utilities", type: "expense", sortOrder: 2 },
    { name: "Staff Salary", type: "expense", sortOrder: 3 },
    { name: "Maintenance", type: "expense", sortOrder: 4 },
    { name: "Marketing", type: "expense", sortOrder: 5 },
    { name: "Dairy Suppliers", type: "vendor", sortOrder: 1 },
    { name: "Grocery Suppliers", type: "vendor", sortOrder: 2 },
    { name: "Coffee Suppliers", type: "vendor", sortOrder: 3 },
    { name: "Spoilage", type: "waste", sortOrder: 1 },
    { name: "Preparation", type: "waste", sortOrder: 2 },
    { name: "Customer Return", type: "waste", sortOrder: 3 },
  ];

  for (const cat of catData) {
    await db.insert(categoriesTable).values(cat);
  }

  const uomData = [
    { name: "Kilogram", abbreviation: "kg" },
    { name: "Gram", abbreviation: "g", baseUomId: null, conversionFactor: 0.001 },
    { name: "Litre", abbreviation: "L" },
    { name: "Millilitre", abbreviation: "ml", baseUomId: null, conversionFactor: 0.001 },
    { name: "Piece", abbreviation: "pc" },
    { name: "Dozen", abbreviation: "dz", baseUomId: null, conversionFactor: 12 },
    { name: "Packet", abbreviation: "pkt" },
    { name: "Box", abbreviation: "box" },
  ];

  for (const uom of uomData) {
    await db.insert(uomTable).values(uom);
  }

  console.log("Seed complete!");
}
