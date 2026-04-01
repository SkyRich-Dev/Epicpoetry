import { Router, type IRouter } from "express";
import { eq, and, gte, lte } from "drizzle-orm";
import { db, purchasesTable, purchaseLinesTable, vendorsTable, ingredientsTable } from "@workspace/db";
import { ListPurchasesResponse, CreatePurchaseBody, GetPurchaseParams, GetPurchaseResponse } from "@workspace/api-zod";
import { authMiddleware } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { generateCode } from "../lib/codeGenerator";

const router: IRouter = Router();

router.get("/purchases", async (req, res): Promise<void> => {
  const conditions = [];
  if (req.query.fromDate) conditions.push(gte(purchasesTable.purchaseDate, req.query.fromDate as string));
  if (req.query.toDate) conditions.push(lte(purchasesTable.purchaseDate, req.query.toDate as string));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const query = db
    .select({
      id: purchasesTable.id,
      purchaseNumber: purchasesTable.purchaseNumber,
      purchaseDate: purchasesTable.purchaseDate,
      vendorId: purchasesTable.vendorId,
      vendorName: vendorsTable.name,
      invoiceNumber: purchasesTable.invoiceNumber,
      paymentMode: purchasesTable.paymentMode,
      paymentStatus: purchasesTable.paymentStatus,
      totalAmount: purchasesTable.totalAmount,
      notes: purchasesTable.notes,
      createdAt: purchasesTable.createdAt,
    })
    .from(purchasesTable)
    .leftJoin(vendorsTable, eq(purchasesTable.vendorId, vendorsTable.id));

  const purchases = whereClause
    ? await query.where(whereClause).orderBy(purchasesTable.createdAt)
    : await query.orderBy(purchasesTable.createdAt);
  res.json(ListPurchasesResponse.parse(purchases));
});

router.post("/purchases", authMiddleware, async (req, res): Promise<void> => {
  const parsed = CreatePurchaseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const purchaseNumber = await generateCode("PUR", "purchases");
  let totalAmount = 0;

  const [purchase] = await db.insert(purchasesTable).values({
    purchaseNumber,
    purchaseDate: parsed.data.purchaseDate,
    vendorId: parsed.data.vendorId,
    invoiceNumber: parsed.data.invoiceNumber,
    paymentMode: parsed.data.paymentMode,
    paymentStatus: parsed.data.paymentStatus ?? "pending",
    notes: parsed.data.notes,
    totalAmount: 0,
  }).returning();

  for (const line of parsed.data.lines) {
    const lineTotal = line.quantity * line.unitRate * (1 + (line.taxPercent ?? 0) / 100);
    totalAmount += lineTotal;
    await db.insert(purchaseLinesTable).values({
      purchaseId: purchase.id,
      ingredientId: line.ingredientId,
      quantity: line.quantity,
      purchaseUom: line.purchaseUom ?? "unit",
      unitRate: line.unitRate,
      taxPercent: line.taxPercent ?? 0,
      lineTotal,
    });

    const [ing] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, line.ingredientId));
    if (ing) {
      const newStock = ing.currentStock + line.quantity;
      const oldTotal = ing.weightedAvgCost * ing.currentStock;
      const newTotal = oldTotal + line.unitRate * line.quantity;
      const newAvg = newStock > 0 ? newTotal / newStock : line.unitRate;
      await db.update(ingredientsTable).set({
        currentStock: newStock,
        latestCost: line.unitRate,
        weightedAvgCost: newAvg,
      }).where(eq(ingredientsTable.id, line.ingredientId));
    }
  }

  await db.update(purchasesTable).set({ totalAmount }).where(eq(purchasesTable.id, purchase.id));
  await createAuditLog("purchases", purchase.id, "create", null, { purchaseNumber, totalAmount });

  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, parsed.data.vendorId));
  res.status(201).json({
    ...purchase,
    totalAmount,
    vendorName: vendor?.name ?? "",
  });
});

router.get("/purchases/:id", async (req, res): Promise<void> => {
  const params = GetPurchaseParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [purchase] = await db
    .select({
      id: purchasesTable.id,
      purchaseNumber: purchasesTable.purchaseNumber,
      purchaseDate: purchasesTable.purchaseDate,
      vendorId: purchasesTable.vendorId,
      vendorName: vendorsTable.name,
      invoiceNumber: purchasesTable.invoiceNumber,
      paymentMode: purchasesTable.paymentMode,
      paymentStatus: purchasesTable.paymentStatus,
      totalAmount: purchasesTable.totalAmount,
      notes: purchasesTable.notes,
      createdAt: purchasesTable.createdAt,
    })
    .from(purchasesTable)
    .leftJoin(vendorsTable, eq(purchasesTable.vendorId, vendorsTable.id))
    .where(eq(purchasesTable.id, params.data.id));

  if (!purchase) { res.status(404).json({ error: "Not found" }); return; }

  const lines = await db
    .select({
      id: purchaseLinesTable.id,
      purchaseId: purchaseLinesTable.purchaseId,
      ingredientId: purchaseLinesTable.ingredientId,
      ingredientName: ingredientsTable.name,
      quantity: purchaseLinesTable.quantity,
      purchaseUom: purchaseLinesTable.purchaseUom,
      unitRate: purchaseLinesTable.unitRate,
      taxPercent: purchaseLinesTable.taxPercent,
      lineTotal: purchaseLinesTable.lineTotal,
    })
    .from(purchaseLinesTable)
    .leftJoin(ingredientsTable, eq(purchaseLinesTable.ingredientId, ingredientsTable.id))
    .where(eq(purchaseLinesTable.purchaseId, params.data.id));

  res.json(GetPurchaseResponse.parse({ purchase, lines }));
});

export default router;
