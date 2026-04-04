import { Router, type IRouter } from "express";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { db, pettyCashLedgerTable, expensesTable, systemConfigTable } from "@workspace/db";
import { authMiddleware, adminOnly } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { generateCode } from "../lib/codeGenerator";
import { validateNotFutureDate } from "../lib/dateValidation";

const router: IRouter = Router();

async function getOpeningBalance(): Promise<number> {
  const [config] = await db.select().from(systemConfigTable);
  return Number(config?.pettyCashOpeningBalance || 0);
}

async function getCurrentBalance(): Promise<number> {
  const opening = await getOpeningBalance();
  const result = await db.select({
    balance: sql<number>`COALESCE(
      SUM(CASE WHEN transaction_type = 'receipt' THEN amount ELSE 0 END) -
      SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END) +
      SUM(CASE WHEN transaction_type = 'adjustment' THEN amount ELSE 0 END),
      0
    )`
  }).from(pettyCashLedgerTable);
  return opening + Number(result[0]?.balance || 0);
}

router.get("/petty-cash/summary", authMiddleware, async (req, res): Promise<void> => {
  const date = req.query.date as string;

  const result = await db.select({
    totalReceipts: sql<number>`COALESCE(SUM(CASE WHEN transaction_type = 'receipt' THEN amount ELSE 0 END), 0)`,
    totalExpenses: sql<number>`COALESCE(SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END), 0)`,
    totalAdjustments: sql<number>`COALESCE(SUM(CASE WHEN transaction_type = 'adjustment' THEN amount ELSE 0 END), 0)`,
    transactionCount: sql<number>`COUNT(*)`,
  }).from(pettyCashLedgerTable);

  const openingBalance = await getOpeningBalance();
  const totalReceipts = Number(result[0]?.totalReceipts || 0);
  const totalExpenses = Number(result[0]?.totalExpenses || 0);
  const totalAdjustments = Number(result[0]?.totalAdjustments || 0);
  const currentBalance = openingBalance + totalReceipts - totalExpenses + totalAdjustments;

  res.json({
    openingBalance,
    totalReceipts,
    totalExpenses,
    totalAdjustments,
    closingBalance: currentBalance,
    currentBalance,
    transactionCount: Number(result[0]?.transactionCount || 0),
  });
});

router.put("/petty-cash/opening-balance", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const { amount } = req.body;
  const parsedAmount = Number(amount);
  if (isNaN(parsedAmount) || parsedAmount < 0) {
    res.status(400).json({ error: "Amount must be a non-negative number" });
    return;
  }
  const [config] = await db.select().from(systemConfigTable);
  if (config) {
    await db.update(systemConfigTable).set({ pettyCashOpeningBalance: parsedAmount }).where(eq(systemConfigTable.id, config.id));
  } else {
    await db.insert(systemConfigTable).values({ pettyCashOpeningBalance: parsedAmount });
  }
  await createAuditLog("config", 1, "update", { pettyCashOpeningBalance: config?.pettyCashOpeningBalance || 0 }, { pettyCashOpeningBalance: parsedAmount });
  res.json({ openingBalance: parsedAmount });
});

router.get("/petty-cash", authMiddleware, async (req, res): Promise<void> => {
  const conditions = [];
  if (req.query.fromDate) conditions.push(gte(pettyCashLedgerTable.transactionDate, req.query.fromDate as string));
  if (req.query.toDate) conditions.push(lte(pettyCashLedgerTable.transactionDate, req.query.toDate as string));
  if (req.query.transactionType) conditions.push(eq(pettyCashLedgerTable.transactionType, req.query.transactionType as string));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const transactions = whereClause
    ? await db.select().from(pettyCashLedgerTable).where(whereClause).orderBy(desc(pettyCashLedgerTable.createdAt))
    : await db.select().from(pettyCashLedgerTable).orderBy(desc(pettyCashLedgerTable.createdAt));

  res.json(transactions);
});

router.post("/petty-cash", authMiddleware, async (req, res): Promise<void> => {
  const { transactionDate, transactionType, amount, method, counterpartyName, category, linkedExpenseId, description } = req.body;
  if (!transactionDate || !transactionType || amount === undefined) {
    res.status(400).json({ error: "transactionDate, transactionType and amount are required" });
    return;
  }
  const dateErr = validateNotFutureDate(transactionDate, "Transaction date");
  if (dateErr) { res.status(400).json({ error: dateErr }); return; }

  const parsedAmount = Number(amount);
  if (parsedAmount <= 0) { res.status(400).json({ error: "Amount must be positive" }); return; }

  if (transactionType === "expense") {
    const balance = await getCurrentBalance();
    if (balance < parsedAmount) {
      res.status(400).json({ error: `Insufficient petty cash balance. Available: ${balance.toFixed(2)}` });
      return;
    }
  }

  const balance = await getCurrentBalance();
  let newBalance = balance;
  if (transactionType === "receipt") newBalance += parsedAmount;
  else if (transactionType === "expense") newBalance -= parsedAmount;
  else if (transactionType === "adjustment") newBalance += parsedAmount;

  const userId = (req as any).userId || null;

  let expenseId: number | null = linkedExpenseId || null;

  if (transactionType === "expense" && !linkedExpenseId) {
    const expenseNumber = await generateCode("EXP", "expenses");
    const [expense] = await db.insert(expensesTable).values({
      expenseNumber,
      expenseDate: transactionDate,
      amount: parsedAmount,
      taxAmount: 0,
      totalAmount: parsedAmount,
      paymentMode: "Petty Cash",
      paidBy: counterpartyName || null,
      description: description || category || "Petty Cash Expense",
      costType: "variable",
      recurring: false,
      createdBy: userId,
    }).returning();
    expenseId = expense.id;
  }

  const [txn] = await db.insert(pettyCashLedgerTable).values({
    transactionDate,
    transactionType,
    amount: parsedAmount,
    method: method || null,
    counterpartyName: counterpartyName || null,
    category: category || null,
    linkedExpenseId: expenseId,
    description: description || null,
    runningBalance: newBalance,
    approvalStatus: "approved",
    createdBy: userId,
  }).returning();

  if (transactionType === "expense" && expenseId && !linkedExpenseId) {
    await db.update(expensesTable).set({ linkedPettyCashId: txn.id }).where(eq(expensesTable.id, expenseId));
  }

  await createAuditLog("petty_cash", txn.id, "create", null, txn);
  res.status(201).json(txn);
});

router.patch("/petty-cash/:id", authMiddleware, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(pettyCashLedgerTable).where(eq(pettyCashLedgerTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const { transactionDate, amount, method, counterpartyName, category, description } = req.body;
  if (transactionDate) { const dateErr = validateNotFutureDate(transactionDate, "Transaction date"); if (dateErr) { res.status(400).json({ error: dateErr }); return; } }
  const updates: any = {};
  if (transactionDate !== undefined) updates.transactionDate = transactionDate;
  if (amount !== undefined) {
    const a = Number(amount);
    if (a <= 0) { res.status(400).json({ error: "Amount must be positive" }); return; }
    if (existing.transactionType === "expense") {
      const balance = await getCurrentBalance();
      const headroom = balance + existing.amount;
      if (headroom < a) { res.status(400).json({ error: `Insufficient petty cash balance. Available: ${headroom.toFixed(2)}` }); return; }
    }
    updates.amount = a;
  }
  if (method !== undefined) updates.method = method || null;
  if (counterpartyName !== undefined) updates.counterpartyName = counterpartyName || null;
  if (category !== undefined) updates.category = category || null;
  if (description !== undefined) updates.description = description || null;

  if (Object.keys(updates).length === 0) { res.json(existing); return; }

  const [updated] = await db.update(pettyCashLedgerTable).set(updates).where(eq(pettyCashLedgerTable.id, id)).returning();

  if (existing.linkedExpenseId && (updates.amount !== undefined || updates.transactionDate !== undefined || updates.description !== undefined || updates.category !== undefined)) {
    const expenseUpdates: any = {};
    if (updates.amount !== undefined) { expenseUpdates.amount = updates.amount; expenseUpdates.totalAmount = updates.amount; }
    if (updates.transactionDate !== undefined) expenseUpdates.expenseDate = updates.transactionDate;
    if (updates.description !== undefined || updates.category !== undefined) expenseUpdates.description = updates.description || updates.category || existing.description || existing.category || "Petty Cash Expense";
    if (Object.keys(expenseUpdates).length > 0) {
      await db.update(expensesTable).set(expenseUpdates).where(eq(expensesTable.id, existing.linkedExpenseId));
    }
  }

  await createAuditLog("petty_cash", id, "update", existing, updated);
  res.json(updated);
});

router.delete("/petty-cash/:id", authMiddleware, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(pettyCashLedgerTable).where(eq(pettyCashLedgerTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const linkedExpenseId = existing.linkedExpenseId;

  const [txn] = await db.delete(pettyCashLedgerTable).where(eq(pettyCashLedgerTable.id, id)).returning();

  if (linkedExpenseId) {
    await db.delete(expensesTable).where(eq(expensesTable.id, linkedExpenseId));
  }
  await createAuditLog("petty_cash", id, "delete", txn, null);
  res.json({ success: true });
});

export default router;
