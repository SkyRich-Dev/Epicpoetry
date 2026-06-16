/**
 * v2.0 Notification Triggers
 * Call these after mutations to fire in-app alerts for key events.
 */

import { db, ingredientsTable, inAppNotificationsTable, expenseBudgetsTable, expensesTable } from "@workspace/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";

async function insertNotification(
  title: string,
  body: string,
  type: "info" | "warning" | "critical",
  link?: string
) {
  try {
    await db.insert(inAppNotificationsTable).values({ title, body, type, link });
  } catch { /* non-fatal */ }
}

/** Check ingredient stock and fire low-stock / out-of-stock alerts */
export async function checkStockAlert(ingredientId: number) {
  try {
    const [ing] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, ingredientId));
    if (!ing) return;

    const stock = Number(ing.currentStock ?? 0);
    const reorder = Number(ing.reorderLevel ?? 0);

    if (stock <= 0) {
      await insertNotification(
        `🚨 Out of Stock: ${ing.name}`,
        `${ing.name} (${ing.code}) is out of stock. Reorder immediately.`,
        "critical",
        "/inventory"
      );
    } else if (reorder > 0 && stock <= reorder) {
      await insertNotification(
        `⚠️ Low Stock: ${ing.name}`,
        `${ing.name} is at ${stock} ${ing.stockUom} — below reorder level of ${reorder} ${ing.stockUom}.`,
        "warning",
        "/inventory"
      );
    }
  } catch { /* non-fatal */ }
}

/** Fire a waste pending approval notification */
export async function notifyWastePendingApproval(ingredientName: string, qty: number, uom: string, recordedBy: string) {
  await insertNotification(
    `Waste Pending Approval`,
    `${recordedBy} recorded ${qty} ${uom} waste for ${ingredientName} — awaiting admin verification.`,
    "warning",
    "/waste"
  );
}

/** Check expense budget thresholds after a new expense is added */
export async function checkBudgetAlert(categoryName: string, monthYear: string) {
  try {
    const [budget] = await db.select().from(expenseBudgetsTable)
      .where(and(
        eq(expenseBudgetsTable.monthYear, monthYear),
        sql`lower(category_name) = ${categoryName.toLowerCase()}`
      ));

    if (!budget) return;

    const monthStart = `${monthYear}-01`;
    const nextMonth = monthYear.replace(/(\d{4})-(\d{2})/, (_, y, m) => {
      const mo = parseInt(m) + 1;
      return mo > 12 ? `${parseInt(y) + 1}-01` : `${y}-${String(mo).padStart(2, "0")}`;
    });
    const monthEnd = `${nextMonth}-01`;

    const [spent] = await db.select({ total: sql<number>`COALESCE(SUM(total_amount),0)` })
      .from(expensesTable)
      .where(and(
        eq(expensesTable.verified, true),
        sql`lower(category_name) = ${categoryName.toLowerCase()}`,
        gte(expensesTable.expenseDate, monthStart),
        lte(expensesTable.expenseDate, monthEnd),
      ));

    const actual = Number(spent?.total ?? 0);
    const pct = budget.budgetAmount > 0 ? (actual / budget.budgetAmount) * 100 : 0;

    if (pct >= 100 && budget.alertAt100) {
      await insertNotification(
        `🚨 Budget Exceeded: ${categoryName}`,
        `${categoryName} expenses (RM${actual.toFixed(2)}) have exceeded the RM${budget.budgetAmount.toFixed(2)} monthly budget (${Math.round(pct)}%).`,
        "critical",
        "/expense-budgets"
      );
    } else if (pct >= 80 && budget.alertAt80) {
      await insertNotification(
        `⚠️ Budget Alert: ${categoryName}`,
        `${categoryName} expenses are at ${Math.round(pct)}% of the RM${budget.budgetAmount.toFixed(2)} monthly budget.`,
        "warning",
        "/expense-budgets"
      );
    }
  } catch { /* non-fatal */ }
}

/** Fire EOD not closed alert */
export async function notifyEodNotClosed(date: string) {
  await insertNotification(
    `EOD Not Closed`,
    `Daily closing for ${date} has not been completed. Please complete EOD before midnight.`,
    "warning",
    "/eod"
  );
}

/** Fire PO pending approval notification */
export async function notifyPoPendingApproval(poNumber: string, vendorName: string) {
  await insertNotification(
    `PO Pending Approval`,
    `Purchase Order ${poNumber} from ${vendorName} is awaiting admin approval.`,
    "info",
    "/purchase-orders"
  );
}
