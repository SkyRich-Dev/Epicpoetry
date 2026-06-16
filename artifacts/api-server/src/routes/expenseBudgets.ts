import { Router, type IRouter } from "express";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { db, expenseBudgetsTable, expensesTable } from "@workspace/db";
import { authMiddleware, adminOnly, managerOrAdmin } from "../lib/auth";

const router: IRouter = Router();
function round2(n: number) { return Math.round((n || 0) * 100) / 100; }

// ─── List budgets ─────────────────────────────────────────────────────────────

router.get("/expense-budgets", authMiddleware, async (req, res): Promise<void> => {
  try {
    const { monthYear } = req.query as any;
    const budgets = await db.select().from(expenseBudgetsTable)
      .orderBy(desc(expenseBudgetsTable.createdAt));
    
    // Attach actual spend
    const result = await Promise.all(budgets
      .filter(b => !monthYear || b.monthYear === monthYear)
      .map(async (b) => {
        // Get expenses for this category and month
        const monthStart = `${b.monthYear}-01`;
        const nextMonth = b.monthYear.replace(/(\d{4})-(\d{2})/, (_, y, m) => {
          const mo = parseInt(m) + 1;
          return mo > 12 ? `${parseInt(y) + 1}-01` : `${y}-${String(mo).padStart(2, "0")}`;
        });
        const monthEnd = `${nextMonth}-01`;
        const spent = await db.select({ total: sql<number>`COALESCE(SUM(total_amount),0)` })
          .from(expensesTable)
          .where(and(
            eq(expensesTable.verified, true),
            b.categoryName ? sql`lower(category_name) = ${b.categoryName.toLowerCase()}` : sql`1=1`,
            gte(expensesTable.expenseDate, monthStart),
            lte(expensesTable.expenseDate, monthEnd),
          ));
        const actualSpend = round2(Number(spent[0]?.total || 0));
        const pct = b.budgetAmount > 0 ? round2((actualSpend / b.budgetAmount) * 100) : 0;
        return { ...b, actualSpend, spendPct: pct, overBudget: actualSpend > b.budgetAmount };
      }));
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Create budget ────────────────────────────────────────────────────────────

router.post("/expense-budgets", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  try {
    const { categoryName, monthYear, budgetAmount, alertAt80 = true, alertAt100 = true } = req.body;
    if (!categoryName || !monthYear || !budgetAmount) {
      res.status(400).json({ error: "categoryName, monthYear, and budgetAmount are required" }); return;
    }
    const [budget] = await db.insert(expenseBudgetsTable).values({
      categoryName, monthYear, budgetAmount, alertAt80, alertAt100,
      createdBy: (req as any).userId,
    }).returning();
    res.status(201).json(budget);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Update budget ────────────────────────────────────────────────────────────

router.patch("/expense-budgets/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { budgetAmount, alertAt80, alertAt100 } = req.body;
    const update: any = {};
    if (budgetAmount !== undefined) update.budgetAmount = budgetAmount;
    if (alertAt80 !== undefined) update.alertAt80 = alertAt80;
    if (alertAt100 !== undefined) update.alertAt100 = alertAt100;
    const [updated] = await db.update(expenseBudgetsTable).set(update).where(eq(expenseBudgetsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Budget not found" }); return; }
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Delete budget ────────────────────────────────────────────────────────────

router.delete("/expense-budgets/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  try {
    await db.delete(expenseBudgetsTable).where(eq(expenseBudgetsTable.id, Number(req.params.id)));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
