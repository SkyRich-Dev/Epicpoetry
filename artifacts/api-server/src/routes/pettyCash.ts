import { Router, type IRouter } from "express";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { db, pettyCashLedgerTable } from "@workspace/db";
import { authMiddleware } from "../lib/auth";
import { createAuditLog } from "../lib/audit";

const router: IRouter = Router();

async function getCurrentBalance(): Promise<number> {
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

router.get("/petty-cash/summary", authMiddleware, async (req, res): Promise<void> => {
  const date = req.query.date as string;

  const result = await db.select({
    totalReceipts: sql<number>`COALESCE(SUM(CASE WHEN transaction_type = 'receipt' THEN amount ELSE 0 END), 0)`,
    totalExpenses: sql<number>`COALESCE(SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END), 0)`,
    totalAdjustments: sql<number>`COALESCE(SUM(CASE WHEN transaction_type = 'adjustment' THEN amount ELSE 0 END), 0)`,
    transactionCount: sql<number>`COUNT(*)`,
  }).from(pettyCashLedgerTable);

  const totalReceipts = Number(result[0]?.totalReceipts || 0);
  const totalExpenses = Number(result[0]?.totalExpenses || 0);
  const totalAdjustments = Number(result[0]?.totalAdjustments || 0);
  const currentBalance = totalReceipts - totalExpenses + totalAdjustments;

  res.json({
    openingBalance: 0,
    totalReceipts,
    totalExpenses,
    totalAdjustments,
    closingBalance: currentBalance,
    currentBalance,
    transactionCount: Number(result[0]?.transactionCount || 0),
  });
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

  const [txn] = await db.insert(pettyCashLedgerTable).values({
    transactionDate,
    transactionType,
    amount: parsedAmount,
    method: method || null,
    counterpartyName: counterpartyName || null,
    category: category || null,
    linkedExpenseId: linkedExpenseId || null,
    description: description || null,
    runningBalance: newBalance,
    approvalStatus: "approved",
    createdBy: userId,
  }).returning();

  await createAuditLog("petty_cash", txn.id, "create", null, txn);
  res.status(201).json(txn);
});

router.delete("/petty-cash/:id", authMiddleware, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(pettyCashLedgerTable).where(eq(pettyCashLedgerTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.linkedExpenseId) { res.status(400).json({ error: "Cannot delete linked petty cash entry. Delete the expense instead." }); return; }

  const [txn] = await db.delete(pettyCashLedgerTable).where(eq(pettyCashLedgerTable.id, id)).returning();
  await createAuditLog("petty_cash", id, "delete", txn, null);
  res.json({ success: true });
});

export default router;
