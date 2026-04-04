import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db, salesEntriesTable, menuItemsTable } from "@workspace/db";
import { ListSalesResponse, CreateSalesEntryBody, UpdateSalesEntryParams, UpdateSalesEntryBody, DeleteSalesEntryParams, GetDailySalesSummaryQueryParams } from "@workspace/api-zod";
import { authMiddleware, adminOnly } from "../lib/auth";
import { validateNotFutureDate } from "../lib/dateValidation";
import { createAuditLog } from "../lib/audit";

const router: IRouter = Router();

router.get("/sales", async (req, res): Promise<void> => {
  const conditions = [];
  if (req.query.fromDate) conditions.push(gte(salesEntriesTable.salesDate, req.query.fromDate as string));
  if (req.query.toDate) conditions.push(lte(salesEntriesTable.salesDate, req.query.toDate as string));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const query = db
    .select({
      id: salesEntriesTable.id,
      salesDate: salesEntriesTable.salesDate,
      menuItemId: salesEntriesTable.menuItemId,
      menuItemName: menuItemsTable.name,
      quantity: salesEntriesTable.quantity,
      sellingPrice: salesEntriesTable.sellingPrice,
      totalAmount: salesEntriesTable.totalAmount,
      discount: salesEntriesTable.discount,
      channel: salesEntriesTable.channel,
      notes: salesEntriesTable.notes,
      verified: salesEntriesTable.verified,
      verifiedBy: salesEntriesTable.verifiedBy,
      verifiedAt: salesEntriesTable.verifiedAt,
      createdAt: salesEntriesTable.createdAt,
    })
    .from(salesEntriesTable)
    .leftJoin(menuItemsTable, eq(salesEntriesTable.menuItemId, menuItemsTable.id));

  const sales = whereClause
    ? await query.where(whereClause).orderBy(salesEntriesTable.createdAt)
    : await query.orderBy(salesEntriesTable.createdAt);
  res.json(sales);
});

router.post("/sales", authMiddleware, async (req, res): Promise<void> => {
  const parsed = CreateSalesEntryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const dateErr = validateNotFutureDate(parsed.data.salesDate, "Sales date");
  if (dateErr) { res.status(400).json({ error: dateErr }); return; }
  const [menuItem] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, parsed.data.menuItemId));
  if (!menuItem) { res.status(400).json({ error: "Invalid menu item" }); return; }
  const sellingPrice = menuItem.sellingPrice;
  const discount = parsed.data.discount ?? 0;
  const totalAmount = parsed.data.quantity * sellingPrice - discount;
  const [entry] = await db.insert(salesEntriesTable).values({
    salesDate: parsed.data.salesDate,
    menuItemId: parsed.data.menuItemId,
    quantity: parsed.data.quantity,
    sellingPrice,
    totalAmount,
    discount,
    channel: parsed.data.channel,
    notes: parsed.data.notes,
  }).returning();

  await createAuditLog("sales", entry.id, "create", null, entry);
  res.status(201).json({ ...entry, menuItemName: menuItem?.name ?? "" });
});

router.patch("/sales/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = UpdateSalesEntryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateSalesEntryBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (parsed.data.salesDate) { const dateErr = validateNotFutureDate(parsed.data.salesDate, "Sales date"); if (dateErr) { res.status(400).json({ error: dateErr }); return; } }
  const [existing] = await db.select().from(salesEntriesTable).where(eq(salesEntriesTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.verified && (req as any).userRole !== "admin") { res.status(403).json({ error: "Record is verified. Only admin can modify." }); return; }
  const updates: any = { ...parsed.data };
  if (parsed.data.menuItemId && parsed.data.menuItemId !== existing.menuItemId) {
    const [newItem] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, parsed.data.menuItemId));
    if (!newItem) { res.status(400).json({ error: "Invalid menu item" }); return; }
    updates.sellingPrice = newItem.sellingPrice;
  }
  delete updates.sellingPrice;
  const [currentMenuItem] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, parsed.data.menuItemId ?? existing.menuItemId));
  const price = currentMenuItem?.sellingPrice ?? existing.sellingPrice;
  updates.sellingPrice = price;
  const qty = parsed.data.quantity ?? existing.quantity;
  const disc = parsed.data.discount ?? existing.discount;
  updates.totalAmount = qty * price - disc;
  const [entry] = await db.update(salesEntriesTable).set(updates).where(eq(salesEntriesTable.id, params.data.id)).returning();
  if (!entry) { res.status(404).json({ error: "Not found" }); return; }
  const [menuItem] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, entry.menuItemId));
  res.json({ ...entry, menuItemName: menuItem?.name ?? "" });
});

router.delete("/sales/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = DeleteSalesEntryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [existing] = await db.select().from(salesEntriesTable).where(eq(salesEntriesTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.verified && (req as any).userRole !== "admin") { res.status(403).json({ error: "Record is verified. Only admin can delete." }); return; }
  await db.delete(salesEntriesTable).where(eq(salesEntriesTable.id, params.data.id));
  res.sendStatus(204);
});

router.patch("/sales/:id/verify", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [entry] = await db.update(salesEntriesTable).set({ verified: true, verifiedBy: (req as any).userId, verifiedAt: new Date() }).where(eq(salesEntriesTable.id, id)).returning();
  if (!entry) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("sales", entry.id, "verify", null, entry);
  const [menuItem] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, entry.menuItemId));
  res.json({ ...entry, menuItemName: menuItem?.name ?? "" });
});

router.patch("/sales/:id/unverify", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [entry] = await db.update(salesEntriesTable).set({ verified: false, verifiedBy: null, verifiedAt: null }).where(eq(salesEntriesTable.id, id)).returning();
  if (!entry) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("sales", entry.id, "unverify", null, entry);
  const [menuItem] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, entry.menuItemId));
  res.json({ ...entry, menuItemName: menuItem?.name ?? "" });
});

router.get("/sales/daily-summary", async (req, res): Promise<void> => {
  const query = GetDailySalesSummaryQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const sales = await db
    .select({
      menuItemId: salesEntriesTable.menuItemId,
      menuItemName: menuItemsTable.name,
      quantity: salesEntriesTable.quantity,
      totalAmount: salesEntriesTable.totalAmount,
    })
    .from(salesEntriesTable)
    .leftJoin(menuItemsTable, eq(salesEntriesTable.menuItemId, menuItemsTable.id))
    .where(eq(salesEntriesTable.salesDate, query.data.date));

  const totalSales = sales.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalQuantity = sales.reduce((sum, s) => sum + s.quantity, 0);

  const itemMap = new Map<number, { menuItemId: number; menuItemName: string; quantity: number; revenue: number }>();
  for (const s of sales) {
    const existing = itemMap.get(s.menuItemId) || { menuItemId: s.menuItemId, menuItemName: s.menuItemName ?? "", quantity: 0, revenue: 0 };
    existing.quantity += s.quantity;
    existing.revenue += s.totalAmount;
    itemMap.set(s.menuItemId, existing);
  }

  const topItems = Array.from(itemMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  res.json({
    date: query.data.date,
    totalSales,
    totalQuantity,
    itemCount: itemMap.size,
    topItems,
  });
});

export default router;
