import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db, salesEntriesTable, expensesTable, wasteEntriesTable, ingredientsTable, menuItemsTable, recipeLinesTable, stockSnapshotsTable } from "@workspace/db";

const router: IRouter = Router();

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function getMonthStart(date: string): string {
  return date.substring(0, 7) + "-01";
}

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const date = (req.query.date as string) || getToday();
  const monthStart = getMonthStart(date);

  const todaySales = await db.select().from(salesEntriesTable).where(eq(salesEntriesTable.salesDate, date));
  const todayExpenses = await db.select().from(expensesTable).where(eq(expensesTable.expenseDate, date));
  const todayWaste = await db.select().from(wasteEntriesTable).where(eq(wasteEntriesTable.wasteDate, date));

  const mtdSales = await db.select().from(salesEntriesTable).where(and(gte(salesEntriesTable.salesDate, monthStart), lte(salesEntriesTable.salesDate, date)));
  const mtdExpenses = await db.select().from(expensesTable).where(and(gte(expensesTable.expenseDate, monthStart), lte(expensesTable.expenseDate, date)));
  const mtdWaste = await db.select().from(wasteEntriesTable).where(and(gte(wasteEntriesTable.wasteDate, monthStart), lte(wasteEntriesTable.wasteDate, date)));

  const todaySalesTotal = todaySales.reduce((s, e) => s + e.totalAmount, 0);
  const todayExpensesTotal = todayExpenses.reduce((s, e) => s + e.totalAmount, 0);
  const todayWasteTotal = todayWaste.reduce((s, e) => s + e.costValue, 0);
  const todayProfit = todaySalesTotal - todayExpensesTotal - todayWasteTotal;

  const mtdSalesTotal = mtdSales.reduce((s, e) => s + e.totalAmount, 0);
  const mtdExpensesTotal = mtdExpenses.reduce((s, e) => s + e.totalAmount, 0);
  const mtdWasteTotal = mtdWaste.reduce((s, e) => s + e.costValue, 0);
  const mtdProfit = mtdSalesTotal - mtdExpensesTotal - mtdWasteTotal;

  const lowStockIngredients = await db.select().from(ingredientsTable).where(eq(ingredientsTable.active, true));
  const lowStockCount = lowStockIngredients.filter(i => i.currentStock <= i.reorderLevel).length;

  const itemRevenueMap = new Map<number, { menuItemId: number; menuItemName: string; quantity: number; revenue: number }>();
  for (const s of mtdSales) {
    const existing = itemRevenueMap.get(s.menuItemId) || { menuItemId: s.menuItemId, menuItemName: "", quantity: 0, revenue: 0 };
    existing.quantity += s.quantity;
    existing.revenue += s.totalAmount;
    itemRevenueMap.set(s.menuItemId, existing);
  }

  const menuItems = await db.select().from(menuItemsTable);
  const menuMap = new Map(menuItems.map(m => [m.id, m]));
  for (const [id, item] of itemRevenueMap) {
    item.menuItemName = menuMap.get(id)?.name ?? "";
  }

  const topByRevenue = Array.from(itemRevenueMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  const topByProfit = [];
  for (const item of topByRevenue) {
    const recipeLines = await db.select().from(recipeLinesTable).where(eq(recipeLinesTable.menuItemId, item.menuItemId));
    let unitCost = 0;
    for (const line of recipeLines) {
      const [ing] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, line.ingredientId));
      if (ing) {
        const netQty = line.quantity * (1 + (line.wastagePercent || 0) / 100);
        const costPerRecipeUnit = ing.weightedAvgCost / (ing.conversionFactor || 1);
        unitCost += costPerRecipeUnit * netQty;
      }
    }
    const productionCost = unitCost * item.quantity;
    const grossProfit = item.revenue - productionCost;
    const marginPercent = item.revenue > 0 ? (grossProfit / item.revenue) * 100 : 0;
    topByProfit.push({
      menuItemId: item.menuItemId,
      menuItemName: item.menuItemName,
      quantitySold: item.quantity,
      revenue: item.revenue,
      productionCost,
      grossProfit,
      marginPercent,
    });
  }

  const alerts: any[] = [];
  lowStockIngredients.filter(i => i.currentStock <= i.reorderLevel).forEach(i => {
    alerts.push({ type: "low_stock", severity: "warning", message: `${i.name} stock is low (${i.currentStock} ${i.stockUom})`, relatedId: i.id });
  });

  const insights: string[] = [];
  if (todaySalesTotal > 0) insights.push(`Today's sales: ${todaySalesTotal.toFixed(0)}`);
  if (todayWasteTotal > 0) insights.push(`Today's waste value: ${todayWasteTotal.toFixed(0)}`);
  if (lowStockCount > 0) insights.push(`${lowStockCount} ingredients are below reorder level`);

  res.json({
    todaySales: todaySalesTotal,
    todayExpenses: todayExpensesTotal,
    todayWaste: todayWasteTotal,
    todayEstimatedProfit: todayProfit,
    mtdSales: mtdSalesTotal,
    mtdExpenses: mtdExpensesTotal,
    mtdWaste: mtdWasteTotal,
    mtdProfit,
    lowStockCount,
    pendingRecurringExpenses: 0,
    topItemsByRevenue: topByRevenue,
    topItemsByProfit: topByProfit,
    topWasteItems: [],
    alerts,
    insights,
  });
});

router.get("/dashboard/profitability", async (req, res): Promise<void> => {
  const fromDate = (req.query.fromDate as string) || getMonthStart(getToday());
  const toDate = (req.query.toDate as string) || getToday();

  const sales = await db.select().from(salesEntriesTable).where(and(gte(salesEntriesTable.salesDate, fromDate), lte(salesEntriesTable.salesDate, toDate)));

  const itemMap = new Map<number, { menuItemId: number; quantitySold: number; revenue: number }>();
  for (const s of sales) {
    const existing = itemMap.get(s.menuItemId) || { menuItemId: s.menuItemId, quantitySold: 0, revenue: 0 };
    existing.quantitySold += s.quantity;
    existing.revenue += s.totalAmount;
    itemMap.set(s.menuItemId, existing);
  }

  const result = [];
  for (const [menuItemId, data] of itemMap) {
    const [menuItem] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, menuItemId));
    if (!menuItem) continue;

    const recipeLines = await db.select().from(recipeLinesTable).where(eq(recipeLinesTable.menuItemId, menuItemId));
    let unitCost = 0;
    for (const line of recipeLines) {
      const [ing] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, line.ingredientId));
      if (ing) {
        const netQty = line.quantity * (1 + (line.wastagePercent || 0) / 100);
        const costPerRecipeUnit = ing.weightedAvgCost / (ing.conversionFactor || 1);
        unitCost += costPerRecipeUnit * netQty;
      }
    }

    const productionCost = unitCost * data.quantitySold;
    const grossProfit = data.revenue - productionCost;
    const marginPercent = data.revenue > 0 ? (grossProfit / data.revenue) * 100 : 0;

    result.push({
      menuItemId,
      menuItemName: menuItem.name,
      quantitySold: data.quantitySold,
      revenue: data.revenue,
      productionCost,
      grossProfit,
      marginPercent,
    });
  }

  res.json(result.sort((a, b) => b.grossProfit - a.grossProfit));
});

router.get("/dashboard/daily-pl", async (req, res): Promise<void> => {
  const date = req.query.date as string;
  if (!date) { res.status(400).json({ error: "date is required" }); return; }

  const sales = await db.select().from(salesEntriesTable).where(eq(salesEntriesTable.salesDate, date));
  const expenses = await db.select().from(expensesTable).where(eq(expensesTable.expenseDate, date));
  const waste = await db.select().from(wasteEntriesTable).where(eq(wasteEntriesTable.wasteDate, date));

  const totalSales = sales.reduce((s, e) => s + e.totalAmount, 0);
  const wasteCost = waste.reduce((s, e) => s + e.costValue, 0);
  const allocatedExpenses = expenses.reduce((s, e) => s + e.totalAmount, 0);

  let materialCost = 0;
  for (const s of sales) {
    const recipeLines = await db.select().from(recipeLinesTable).where(eq(recipeLinesTable.menuItemId, s.menuItemId));
    for (const line of recipeLines) {
      const [ing] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, line.ingredientId));
      if (ing) {
        const netQty = line.quantity * (1 + (line.wastagePercent || 0) / 100);
        const costPerRecipeUnit = ing.weightedAvgCost / (ing.conversionFactor || 1);
        materialCost += costPerRecipeUnit * netQty * s.quantity;
      }
    }
  }

  const grossProfit = totalSales - materialCost;
  const operatingProfit = grossProfit - wasteCost - allocatedExpenses;

  res.json({
    date,
    totalSales,
    materialCost,
    wasteCost,
    trialCost: 0,
    allocatedExpenses,
    allocatedUtilities: 0,
    grossProfit,
    operatingProfit,
    grossMarginPercent: totalSales > 0 ? (grossProfit / totalSales) * 100 : 0,
    operatingMarginPercent: totalSales > 0 ? (operatingProfit / totalSales) * 100 : 0,
  });
});

router.get("/dashboard/consumption-variance", async (req, res): Promise<void> => {
  const fromDate = (req.query.fromDate as string) || getMonthStart(getToday());
  const toDate = (req.query.toDate as string) || getToday();

  const sales = await db.select().from(salesEntriesTable).where(and(gte(salesEntriesTable.salesDate, fromDate), lte(salesEntriesTable.salesDate, toDate)));
  const snapshots = await db.select().from(stockSnapshotsTable).where(and(gte(stockSnapshotsTable.snapshotDate, fromDate), lte(stockSnapshotsTable.snapshotDate, toDate)));

  const theoreticalMap = new Map<number, number>();
  for (const s of sales) {
    const recipeLines = await db.select().from(recipeLinesTable).where(eq(recipeLinesTable.menuItemId, s.menuItemId));
    for (const line of recipeLines) {
      const [ing] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, line.ingredientId));
      const conversionFactor = ing?.conversionFactor || 1;
      const netQty = line.quantity * (1 + (line.wastagePercent || 0) / 100);
      const consumedInStockUom = (netQty * s.quantity) / conversionFactor;
      theoreticalMap.set(line.ingredientId, (theoreticalMap.get(line.ingredientId) || 0) + consumedInStockUom);
    }
  }

  const actualMap = new Map<number, number>();
  for (const snap of snapshots) {
    actualMap.set(snap.ingredientId, (actualMap.get(snap.ingredientId) || 0) + snap.consumedQty);
  }

  const allIngredientIds = new Set([...theoreticalMap.keys(), ...actualMap.keys()]);
  const result = [];
  for (const id of allIngredientIds) {
    const [ing] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, id));
    if (!ing) continue;
    const actual = actualMap.get(id) || 0;
    const theoretical = theoreticalMap.get(id) || 0;
    const variance = actual - theoretical;
    const variancePercent = theoretical > 0 ? (variance / theoretical) * 100 : 0;
    result.push({
      ingredientId: id,
      ingredientName: ing.name,
      actualConsumed: actual,
      theoreticalConsumed: theoretical,
      variance,
      variancePercent,
      uom: ing.stockUom,
    });
  }

  res.json(result);
});

router.get("/dashboard/sales-trend", async (req, res): Promise<void> => {
  const fromDate = (req.query.fromDate as string) || getMonthStart(getToday());
  const toDate = (req.query.toDate as string) || getToday();

  const sales = await db.select().from(salesEntriesTable).where(and(gte(salesEntriesTable.salesDate, fromDate), lte(salesEntriesTable.salesDate, toDate)));
  const byDate = new Map<string, number>();
  for (const s of sales) {
    byDate.set(s.salesDate, (byDate.get(s.salesDate) || 0) + s.totalAmount);
  }

  res.json(Array.from(byDate.entries()).map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date)));
});

router.get("/dashboard/expense-breakdown", async (req, res): Promise<void> => {
  const fromDate = (req.query.fromDate as string) || getMonthStart(getToday());
  const toDate = (req.query.toDate as string) || getToday();

  const expenses = await db.select().from(expensesTable).where(and(gte(expensesTable.expenseDate, fromDate), lte(expensesTable.expenseDate, toDate)));

  const byCategory = new Map<string, { name: string; value: number; count: number }>();
  for (const e of expenses) {
    const catName = e.costType || "Other";
    const cat = byCategory.get(catName) || { name: catName, value: 0, count: 0 };
    cat.value += e.totalAmount;
    cat.count++;
    byCategory.set(catName, cat);
  }

  res.json(Array.from(byCategory.values()));
});

router.get("/dashboard/vendor-spend", async (req, res): Promise<void> => {
  const { purchasesTable, vendorsTable } = await import("@workspace/db");
  const fromDate = (req.query.fromDate as string) || getMonthStart(getToday());
  const toDate = (req.query.toDate as string) || getToday();

  const purchases = await db
    .select({
      vendorId: purchasesTable.vendorId,
      vendorName: vendorsTable.name,
      totalAmount: purchasesTable.totalAmount,
    })
    .from(purchasesTable)
    .leftJoin(vendorsTable, eq(purchasesTable.vendorId, vendorsTable.id))
    .where(and(gte(purchasesTable.purchaseDate, fromDate), lte(purchasesTable.purchaseDate, toDate)));

  const byVendor = new Map<number, { vendorId: number; vendorName: string; totalSpend: number; purchaseCount: number }>();
  for (const p of purchases) {
    const existing = byVendor.get(p.vendorId) || { vendorId: p.vendorId, vendorName: p.vendorName ?? "", totalSpend: 0, purchaseCount: 0 };
    existing.totalSpend += p.totalAmount;
    existing.purchaseCount++;
    byVendor.set(p.vendorId, existing);
  }

  res.json(Array.from(byVendor.values()));
});

export default router;
