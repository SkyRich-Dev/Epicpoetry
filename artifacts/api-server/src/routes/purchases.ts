import { Router, type IRouter } from "express";
import { eq, and, gte, lte } from "drizzle-orm";
import { db, purchasesTable, purchaseLinesTable, vendorsTable, ingredientsTable, vendorLedgerTable } from "@workspace/db";
import { ListPurchasesResponse, CreatePurchaseBody, GetPurchaseParams, GetPurchaseResponse } from "@workspace/api-zod";
import { authMiddleware, adminOnly } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { generateCode } from "../lib/codeGenerator";
import { validateNotFutureDate } from "../lib/dateValidation";

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
      paidAmount: purchasesTable.paidAmount,
      pendingAmount: purchasesTable.pendingAmount,
      dueDate: purchasesTable.dueDate,
      vendorInvoiceNumber: purchasesTable.vendorInvoiceNumber,
      notes: purchasesTable.notes,
      verified: purchasesTable.verified,
      verifiedBy: purchasesTable.verifiedBy,
      verifiedAt: purchasesTable.verifiedAt,
      createdAt: purchasesTable.createdAt,
    })
    .from(purchasesTable)
    .leftJoin(vendorsTable, eq(purchasesTable.vendorId, vendorsTable.id));

  if (req.query.vendorId) conditions.push(eq(purchasesTable.vendorId, Number(req.query.vendorId)));
  if (req.query.paymentStatus) conditions.push(eq(purchasesTable.paymentStatus, req.query.paymentStatus as string));

  const finalWhere = conditions.length > 0 ? and(...conditions) : undefined;
  const purchases = finalWhere
    ? await query.where(finalWhere).orderBy(purchasesTable.createdAt)
    : await query.orderBy(purchasesTable.createdAt);
  res.json(purchases);
});

router.post("/purchases", authMiddleware, async (req, res): Promise<void> => {
  const parsed = CreatePurchaseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const dateErr = validateNotFutureDate(parsed.data.purchaseDate, "Purchase date");
  if (dateErr) { res.status(400).json({ error: dateErr }); return; }

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

  const paymentStatus = parsed.data.paymentStatus === "paid" ? "fully_paid" : "unpaid";
  await db.update(purchasesTable).set({
    totalAmount,
    grossAmount: totalAmount,
    pendingAmount: paymentStatus === "fully_paid" ? 0 : totalAmount,
    paidAmount: paymentStatus === "fully_paid" ? totalAmount : 0,
    paymentStatus,
    vendorInvoiceNumber: parsed.data.invoiceNumber || undefined,
    dueDate: parsed.data.dueDate || undefined,
  }).where(eq(purchasesTable.id, purchase.id));

  const lastLedger = await db.select().from(vendorLedgerTable)
    .where(eq(vendorLedgerTable.vendorId, parsed.data.vendorId))
    .orderBy(vendorLedgerTable.id)
    .limit(1);
  const prevBalance = lastLedger.length > 0 ? lastLedger[0].runningBalance : 0;

  await db.insert(vendorLedgerTable).values({
    vendorId: parsed.data.vendorId,
    transactionDate: parsed.data.purchaseDate,
    transactionType: "purchase",
    referenceType: "purchase",
    referenceId: purchase.id,
    debit: totalAmount,
    credit: 0,
    runningBalance: prevBalance + totalAmount,
    description: `Purchase ${purchaseNumber} - ${parsed.data.invoiceNumber || 'No invoice'}`,
  });

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

router.patch("/purchases/:id/verify", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [purchase] = await db.update(purchasesTable).set({ verified: true, verifiedBy: (req as any).userId, verifiedAt: new Date() }).where(eq(purchasesTable.id, id)).returning();
  if (!purchase) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("purchases", purchase.id, "verify", null, purchase);
  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, purchase.vendorId));
  res.json({ ...purchase, vendorName: vendor?.name ?? "" });
});

router.patch("/purchases/:id/unverify", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [purchase] = await db.update(purchasesTable).set({ verified: false, verifiedBy: null, verifiedAt: null }).where(eq(purchasesTable.id, id)).returning();
  if (!purchase) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("purchases", purchase.id, "unverify", null, purchase);
  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, purchase.vendorId));
  res.json({ ...purchase, vendorName: vendor?.name ?? "" });
});

router.delete("/purchases/:id", authMiddleware, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(purchasesTable).where(eq(purchasesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.verified && (req as any).userRole !== "admin") { res.status(403).json({ error: "Record is verified. Only admin can delete." }); return; }
  await db.delete(purchaseLinesTable).where(eq(purchaseLinesTable.purchaseId, id));
  await db.delete(purchasesTable).where(eq(purchasesTable.id, id));
  await createAuditLog("purchases", id, "delete", existing, null);
  res.json({ success: true });
});

export default router;
