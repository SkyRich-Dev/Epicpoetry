import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { db, expensesTable, categoriesTable, vendorsTable, pettyCashLedgerTable, vendorLedgerTable, vendorPaymentAllocationsTable } from "@workspace/db";
import { ListExpensesResponse, CreateExpenseBody, GetExpenseParams, GetExpenseResponse, UpdateExpenseParams, UpdateExpenseBody } from "@workspace/api-zod";
import { authMiddleware, adminOnly, requirePermission } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { generateCode } from "../lib/codeGenerator";
import { validateNotFutureDate } from "../lib/dateValidation";
import { isPettyCashMode } from "../lib/paymentMode";

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
      postedToVendor: expensesTable.postedToVendor,
      vendorPaymentStatus: expensesTable.vendorPaymentStatus,
      paidAmount: expensesTable.paidAmount,
      pendingAmount: expensesTable.pendingAmount,
      dueDate: expensesTable.dueDate,
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

router.post("/expenses", authMiddleware, requirePermission("expenses.create"), async (req, res): Promise<void> => {
  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const dateErr = validateNotFutureDate(parsed.data.expenseDate, "Expense date");
  if (dateErr) { res.status(400).json({ error: dateErr }); return; }

  // Read non-zod fields from raw body — these aren't in the generated schema.
  const postToVendorPortal = req.body?.postToVendorPortal === true && parsed.data.vendorId != null;
  const dueDate = typeof req.body?.dueDate === "string" ? req.body.dueDate : null;

  const expenseNumber = await generateCode("EXP", "expenses");
  const totalAmount = parsed.data.amount + (parsed.data.taxAmount ?? 0);
  // Posted-to-vendor expenses are credit purchases, not cash outflows now,
  // so they bypass petty cash entirely regardless of paymentMode.
  const isPettyCash = !postToVendorPortal && isPettyCashMode(parsed.data.paymentMode);

  if (isPettyCash) {
    const balance = await getPettyCashBalance();
    if (balance < totalAmount) {
      res.status(400).json({ error: `Insufficient petty cash balance. Available: ₹${balance.toFixed(2)}` });
      return;
    }
  }

  // All side effects (expense insert + petty-cash ledger + vendor ledger debit)
  // run in one transaction so a partial failure cannot leave the books in an
  // inconsistent state. The vendor ledger row is computed inside the tx using
  // a serialized last-row read, which under transaction isolation prevents
  // concurrent inserts from clobbering the running balance.
  const expense = await db.transaction(async (tx) => {
    const [created] = await tx.insert(expensesTable).values({
      expenseNumber,
      expenseDate: parsed.data.expenseDate,
      categoryId: parsed.data.categoryId,
      vendorId: parsed.data.vendorId,
      amount: parsed.data.amount,
      taxAmount: parsed.data.taxAmount ?? 0,
      totalAmount,
      paymentMode: postToVendorPortal ? "credit" : parsed.data.paymentMode,
      paidBy: parsed.data.paidBy,
      description: parsed.data.description,
      costType: parsed.data.costType,
      recurring: parsed.data.recurring ?? false,
      recurringFrequency: parsed.data.recurringFrequency,
      postedToVendor: postToVendorPortal,
      vendorPaymentStatus: "unpaid",
      paidAmount: 0,
      pendingAmount: postToVendorPortal ? totalAmount : 0,
      dueDate,
    }).returning();

    if (isPettyCash) {
      const pcBalance = await getPettyCashBalance();
      const [pcEntry] = await tx.insert(pettyCashLedgerTable).values({
        transactionDate: parsed.data.expenseDate,
        transactionType: "expense",
        amount: totalAmount,
        method: "petty cash",
        counterpartyName: parsed.data.paidBy || null,
        category: "Expense",
        linkedExpenseId: created.id,
        description: `Expense ${expenseNumber}: ${parsed.data.description || ""}`.trim(),
        runningBalance: pcBalance - totalAmount,
        approvalStatus: "approved",
        createdBy: (req as any).userId || null,
      }).returning();

      await tx.update(expensesTable).set({ linkedPettyCashId: pcEntry.id }).where(eq(expensesTable.id, created.id));
    }

    if (postToVendorPortal && parsed.data.vendorId != null) {
      // Lock the vendor row first so concurrent vendor-payment / posted-expense
      // transactions for this vendor serialize. Without this two transactions
      // could read the same prior runningBalance and write inconsistent values.
      await tx.select({ id: vendorsTable.id }).from(vendorsTable)
        .where(eq(vendorsTable.id, parsed.data.vendorId))
        .for("update");

      const lastLedger = await tx.select().from(vendorLedgerTable)
        .where(eq(vendorLedgerTable.vendorId, parsed.data.vendorId))
        .orderBy(desc(vendorLedgerTable.id))
        .limit(1);
      const prevBalance = lastLedger.length > 0 ? lastLedger[0].runningBalance : 0;
      await tx.insert(vendorLedgerTable).values({
        vendorId: parsed.data.vendorId,
        transactionDate: parsed.data.expenseDate,
        transactionType: "purchase",
        referenceType: "expense",
        referenceId: created.id,
        debit: totalAmount,
        credit: 0,
        runningBalance: prevBalance + totalAmount,
        description: `Expense ${expenseNumber}${parsed.data.description ? ` - ${parsed.data.description}` : ""}`,
      });
    }

    return created;
  });

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

router.patch("/expenses/:id", authMiddleware, requirePermission("expenses.edit"), async (req, res): Promise<void> => {
  const params = UpdateExpenseParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateExpenseBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (parsed.data.expenseDate) { const dateErr = validateNotFutureDate(parsed.data.expenseDate, "Expense date"); if (dateErr) { res.status(400).json({ error: dateErr }); return; } }
  const [old] = await db.select().from(expensesTable).where(eq(expensesTable.id, params.data.id));
  if (!old) { res.status(404).json({ error: "Not found" }); return; }
  if (old.verified && (req as any).userRole !== "admin") { res.status(403).json({ error: "Record is verified. Only admin can modify." }); return; }

  // Posted-to-vendor expenses are tracked liabilities with a ledger row and
  // potentially partial payments. Mutating the financial fields would silently
  // desynchronize the vendor ledger and bill totals. Block those edits and
  // require the caller to delete + re-create if they really need to change them.
  if (old.postedToVendor) {
    const financialChanged =
      (parsed.data.amount !== undefined && parsed.data.amount !== old.amount) ||
      (parsed.data.taxAmount !== undefined && parsed.data.taxAmount !== old.taxAmount) ||
      (parsed.data.vendorId !== undefined && parsed.data.vendorId !== old.vendorId) ||
      (parsed.data.expenseDate !== undefined && parsed.data.expenseDate !== old.expenseDate) ||
      (parsed.data.paymentMode !== undefined && parsed.data.paymentMode !== old.paymentMode);
    if (financialChanged) {
      res.status(409).json({ error: "Cannot change amount, vendor, date or payment mode on an expense posted to vendor portal. Delete and re-create instead." });
      return;
    }
  }

  // Allow the dueDate (raw body field, not in zod schema) to be edited freely
  // — it's display-only and doesn't affect ledger.
  const updates: any = { ...parsed.data };
  if (typeof req.body?.dueDate === "string" || req.body?.dueDate === null) {
    updates.dueDate = req.body.dueDate;
  }
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

router.delete("/expenses/:id", authMiddleware, requirePermission("expenses.delete"), async (req, res): Promise<void> => {
  const params = UpdateExpenseParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [existing] = await db.select().from(expensesTable).where(eq(expensesTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.verified && (req as any).userRole !== "admin") { res.status(403).json({ error: "Record is verified. Only admin can delete." }); return; }

  // Posted-to-vendor expenses need extra care: if any vendor payment has been
  // allocated to it the deletion would orphan accounting; if it's still
  // unpaid we have to write a compensating ledger credit so the vendor's
  // outstanding balance stays consistent.
  if (existing.postedToVendor) {
    const allocs = await db.select({ id: vendorPaymentAllocationsTable.id })
      .from(vendorPaymentAllocationsTable)
      .where(eq(vendorPaymentAllocationsTable.expenseId, existing.id));
    if (allocs.length > 0 || existing.paidAmount > 0) {
      res.status(409).json({ error: "Cannot delete: this expense has vendor payments allocated to it. Delete those payments first." });
      return;
    }

    if (existing.vendorId != null) {
      const vendorId = existing.vendorId;
      await db.transaction(async (tx) => {
        // Lock vendor to serialize ledger writes for this vendor.
        await tx.select({ id: vendorsTable.id }).from(vendorsTable)
          .where(eq(vendorsTable.id, vendorId)).for("update");

        const lastLedger = await tx.select().from(vendorLedgerTable)
          .where(eq(vendorLedgerTable.vendorId, vendorId))
          .orderBy(desc(vendorLedgerTable.id)).limit(1);
        const prevBalance = lastLedger.length > 0 ? lastLedger[0].runningBalance : 0;
        await tx.insert(vendorLedgerTable).values({
          vendorId,
          transactionDate: new Date().toISOString().split('T')[0],
          transactionType: "reversal",
          referenceType: "expense",
          referenceId: existing.id,
          debit: 0,
          credit: existing.totalAmount,
          runningBalance: prevBalance - existing.totalAmount,
          description: `Reversal of expense ${existing.expenseNumber} (deleted)`,
        });

        await tx.delete(expensesTable).where(eq(expensesTable.id, existing.id));
      });

      await createAuditLog("expenses", existing.id, "delete", existing, null);
      res.json({ success: true });
      return;
    }
  }

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
