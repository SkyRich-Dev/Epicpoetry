import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db, expensesTable, categoriesTable, vendorsTable, pettyCashLedgerTable } from "@workspace/db";
import { ListExpensesResponse, CreateExpenseBody, GetExpenseParams, GetExpenseResponse, UpdateExpenseParams, UpdateExpenseBody } from "@workspace/api-zod";
import { authMiddleware, adminOnly } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { generateCode } from "../lib/codeGenerator";
import { validateNotFutureDate } from "../lib/dateValidation";

async function getPettyCashBalance(): Promise<number> {
  const result = await db.select({
    balance: sql<number>`COALESCE(
      SUM(CASE WHEN transaction_type = 'receipt' THEN amount ELSE 0 END) -
      SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END) +
      SUM(CASE WHEN transaction_type = 'adjustment' THEN amount ELSE 0 END),
      0
    )`
  }).from(pettyCashLedgerTable);
  return Number(result[0]?.balance || 0);
}

const router: IRouter = Router();

router.get("/expenses", async (req, res): Promise<void> => {
  const conditions = [];
  if (req.query.fromDate) conditions.push(gte(expensesTable.expenseDate, req.query.fromDate as string));
  if (req.query.toDate) conditions.push(lte(expensesTable.expenseDate, req.query.toDate as string));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const query = db
    .select({
      id: expensesTable.id,
      expenseNumber: expensesTable.expenseNumber,
      expenseDate: expensesTable.expenseDate,
      categoryId: expensesTable.categoryId,
      categoryName: categoriesTable.name,
      vendorId: expensesTable.vendorId,
      vendorName: vendorsTable.name,
      amount: expensesTable.amount,
      taxAmount: expensesTable.taxAmount,
      totalAmount: expensesTable.totalAmount,
      paymentMode: expensesTable.paymentMode,
      paidBy: expensesTable.paidBy,
      description: expensesTable.description,
      costType: expensesTable.costType,
      recurring: expensesTable.recurring,
      recurringFrequency: expensesTable.recurringFrequency,
      verified: expensesTable.verified,
      verifiedBy: expensesTable.verifiedBy,
      verifiedAt: expensesTable.verifiedAt,
      createdAt: expensesTable.createdAt,
    })
    .from(expensesTable)
    .leftJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
    .leftJoin(vendorsTable, eq(expensesTable.vendorId, vendorsTable.id));

  const expenses = whereClause
    ? await query.where(whereClause).orderBy(expensesTable.createdAt)
    : await query.orderBy(expensesTable.createdAt);
  res.json(expenses);
});

router.post("/expenses", authMiddleware, async (req, res): Promise<void> => {
  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const dateErr = validateNotFutureDate(parsed.data.expenseDate, "Expense date");
  if (dateErr) { res.status(400).json({ error: dateErr }); return; }
  const expenseNumber = await generateCode("EXP", "expenses");
  const totalAmount = parsed.data.amount + (parsed.data.taxAmount ?? 0);
  const isPettyCash = parsed.data.paymentMode?.toLowerCase() === "petty cash";

  if (isPettyCash) {
    const balance = await getPettyCashBalance();
    if (balance < totalAmount) {
      res.status(400).json({ error: `Insufficient petty cash balance. Available: ₹${balance.toFixed(2)}` });
      return;
    }
  }

  const [expense] = await db.insert(expensesTable).values({
    expenseNumber,
    expenseDate: parsed.data.expenseDate,
    categoryId: parsed.data.categoryId,
    vendorId: parsed.data.vendorId,
    amount: parsed.data.amount,
    taxAmount: parsed.data.taxAmount ?? 0,
    totalAmount,
    paymentMode: parsed.data.paymentMode,
    paidBy: parsed.data.paidBy,
    description: parsed.data.description,
    costType: parsed.data.costType,
    recurring: parsed.data.recurring ?? false,
    recurringFrequency: parsed.data.recurringFrequency,
  }).returning();

  if (isPettyCash) {
    const pcBalance = await getPettyCashBalance();
    const [pcEntry] = await db.insert(pettyCashLedgerTable).values({
      transactionDate: parsed.data.expenseDate,
      transactionType: "expense",
      amount: totalAmount,
      method: "petty cash",
      counterpartyName: parsed.data.paidBy || null,
      category: "Expense",
      linkedExpenseId: expense.id,
      description: `Expense ${expenseNumber}: ${parsed.data.description || ""}`.trim(),
      runningBalance: pcBalance - totalAmount,
      approvalStatus: "approved",
      createdBy: (req as any).userId || null,
    }).returning();

    await db.update(expensesTable).set({ linkedPettyCashId: pcEntry.id }).where(eq(expensesTable.id, expense.id));
  }

  await createAuditLog("expenses", expense.id, "create", null, expense);
  res.status(201).json({ ...expense, categoryName: null, vendorName: null });
});

router.get("/expenses/:id", async (req, res): Promise<void> => {
  const params = GetExpenseParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [expense] = await db
    .select({
      id: expensesTable.id,
      expenseNumber: expensesTable.expenseNumber,
      expenseDate: expensesTable.expenseDate,
      categoryId: expensesTable.categoryId,
      categoryName: categoriesTable.name,
      vendorId: expensesTable.vendorId,
      vendorName: vendorsTable.name,
      amount: expensesTable.amount,
      taxAmount: expensesTable.taxAmount,
      totalAmount: expensesTable.totalAmount,
      paymentMode: expensesTable.paymentMode,
      paidBy: expensesTable.paidBy,
      description: expensesTable.description,
      costType: expensesTable.costType,
      recurring: expensesTable.recurring,
      recurringFrequency: expensesTable.recurringFrequency,
      createdAt: expensesTable.createdAt,
    })
    .from(expensesTable)
    .leftJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
    .leftJoin(vendorsTable, eq(expensesTable.vendorId, vendorsTable.id))
    .where(eq(expensesTable.id, params.data.id));
  if (!expense) { res.status(404).json({ error: "Not found" }); return; }
  res.json(GetExpenseResponse.parse(expense));
});

router.patch("/expenses/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = UpdateExpenseParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateExpenseBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (parsed.data.expenseDate) { const dateErr = validateNotFutureDate(parsed.data.expenseDate, "Expense date"); if (dateErr) { res.status(400).json({ error: dateErr }); return; } }
  const [old] = await db.select().from(expensesTable).where(eq(expensesTable.id, params.data.id));
  if (!old) { res.status(404).json({ error: "Not found" }); return; }
  if (old.verified && (req as any).userRole !== "admin") { res.status(403).json({ error: "Record is verified. Only admin can modify." }); return; }
  const updates: any = { ...parsed.data };
  const newAmount = parsed.data.amount ?? old.amount;
  const newTax = parsed.data.taxAmount ?? old.taxAmount;
  if (parsed.data.amount !== undefined || parsed.data.taxAmount !== undefined) {
    updates.totalAmount = newAmount + newTax;
  }
  const [expense] = await db.update(expensesTable).set(updates).where(eq(expensesTable.id, params.data.id)).returning();
  if (!expense) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("expenses", expense.id, "update", old, expense);
  res.json({ ...expense, categoryName: null, vendorName: null });
});

router.delete("/expenses/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = UpdateExpenseParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [existing] = await db.select().from(expensesTable).where(eq(expensesTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.verified && (req as any).userRole !== "admin") { res.status(403).json({ error: "Record is verified. Only admin can delete." }); return; }

  if (existing.linkedPettyCashId) {
    await db.delete(pettyCashLedgerTable).where(eq(pettyCashLedgerTable.id, existing.linkedPettyCashId));
  }

  const [expense] = await db.delete(expensesTable).where(eq(expensesTable.id, params.data.id)).returning();
  await createAuditLog("expenses", expense.id, "delete", expense, null);
  res.json({ success: true });
});

router.patch("/expenses/:id/verify", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [expense] = await db.update(expensesTable).set({ verified: true, verifiedBy: (req as any).userId, verifiedAt: new Date() }).where(eq(expensesTable.id, id)).returning();
  if (!expense) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("expenses", expense.id, "verify", null, expense);
  res.json({ ...expense, categoryName: null, vendorName: null });
});

router.patch("/expenses/:id/unverify", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [expense] = await db.update(expensesTable).set({ verified: false, verifiedBy: null, verifiedAt: null }).where(eq(expensesTable.id, id)).returning();
  if (!expense) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("expenses", expense.id, "unverify", null, expense);
  res.json({ ...expense, categoryName: null, vendorName: null });
});

export default router;
