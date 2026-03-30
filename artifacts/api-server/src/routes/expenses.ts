import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, expensesTable, categoriesTable, vendorsTable } from "@workspace/db";
import { ListExpensesResponse, CreateExpenseBody, GetExpenseParams, GetExpenseResponse, UpdateExpenseParams, UpdateExpenseBody } from "@workspace/api-zod";
import { authMiddleware } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { generateCode } from "../lib/codeGenerator";

const router: IRouter = Router();

router.get("/expenses", async (_req, res): Promise<void> => {
  const expenses = await db
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
    .orderBy(expensesTable.createdAt);
  res.json(ListExpensesResponse.parse(expenses));
});

router.post("/expenses", authMiddleware, async (req, res): Promise<void> => {
  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const expenseNumber = await generateCode("EXP", "expenses");
  const totalAmount = parsed.data.amount + (parsed.data.taxAmount ?? 0);
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
  const [old] = await db.select().from(expensesTable).where(eq(expensesTable.id, params.data.id));
  if (!old) { res.status(404).json({ error: "Not found" }); return; }
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
  const [expense] = await db.delete(expensesTable).where(eq(expensesTable.id, params.data.id)).returning();
  if (!expense) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("expenses", expense.id, "delete", expense, null);
  res.json({ success: true });
});

export default router;
