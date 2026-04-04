import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql, gt } from "drizzle-orm";
import { db, salesEntriesTable, expensesTable, wasteEntriesTable, ingredientsTable, menuItemsTable, recipeLinesTable, stockSnapshotsTable, dailySalesSettlementsTable, pettyCashLedgerTable, purchasesTable, vendorPaymentsTable, salesInvoicesTable } from "@workspace/db";
import { authMiddleware } from "../lib/auth";

const router: IRouter = Router();

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function getMonthStart(date: string): string {
  return date.substring(0, 7) + "-01";
}

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const fromDate = (req.query.fromDate as string) || (req.query.date as string) || getToday();
  const toDate = (req.query.toDate as string) || (req.query.date as string) || getToday();
  const isSingleDay = fromDate === toDate;
  const monthStart = getMonthStart(toDate);

  const rangeSales = await db.select().from(salesEntriesTable).where(and(gte(salesEntriesTable.salesDate, fromDate), lte(salesEntriesTable.salesDate, toDate)));
  const rangeExpenses = await db.select().from(expensesTable).where(and(gte(expensesTable.expenseDate, fromDate), lte(expensesTable.expenseDate, toDate)));
  const rangeWaste = await db.select().from(wasteEntriesTable).where(and(gte(wasteEntriesTable.wasteDate, fromDate), lte(wasteEntriesTable.wasteDate, toDate)));

  const mtdSales = await db.select().from(salesEntriesTable).where(and(gte(salesEntriesTable.salesDate, monthStart), lte(salesEntriesTable.salesDate, toDate)));
  const mtdExpenses = await db.select().from(expensesTable).where(and(gte(expensesTable.expenseDate, monthStart), lte(expensesTable.expenseDate, toDate)));
  const mtdWaste = await db.select().from(wasteEntriesTable).where(and(gte(wasteEntriesTable.wasteDate, monthStart), lte(wasteEntriesTable.wasteDate, toDate)));

  const yesterday = new Date(fromDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const lastWeekSameDay = new Date(fromDate);
  lastWeekSameDay.setDate(lastWeekSameDay.getDate() - 7);
  const lastWeekSameDayStr = lastWeekSameDay.toISOString().split("T")[0];

  const dayCount = Math.max(1, Math.round((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000) + 1);
  const prevRangeEnd = new Date(fromDate);
  prevRangeEnd.setDate(prevRangeEnd.getDate() - 1);
  const prevRangeStart = new Date(prevRangeEnd);
  prevRangeStart.setDate(prevRangeStart.getDate() - dayCount + 1);
  const prevRangeStartStr = prevRangeStart.toISOString().split("T")[0];
  const prevRangeEndStr = prevRangeEnd.toISOString().split("T")[0];

  let yesterdaySalesTotal = 0;
  let lastWeekSameDaySalesTotal = 0;
  if (isSingleDay) {
    const yesterdaySales = await db.select().from(salesEntriesTable).where(eq(salesEntriesTable.salesDate, yesterdayStr));
    const lastWeekSales = await db.select().from(salesEntriesTable).where(eq(salesEntriesTable.salesDate, lastWeekSameDayStr));
    yesterdaySalesTotal = yesterdaySales.reduce((s, e) => s + e.totalAmount, 0);
    lastWeekSameDaySalesTotal = lastWeekSales.reduce((s, e) => s + e.totalAmount, 0);
  } else {
    const prevSales = await db.select().from(salesEntriesTable).where(and(gte(salesEntriesTable.salesDate, prevRangeStartStr), lte(salesEntriesTable.salesDate, prevRangeEndStr)));
    yesterdaySalesTotal = prevSales.reduce((s, e) => s + e.totalAmount, 0);
    lastWeekSameDaySalesTotal = 0;
  }

  const todaySalesTotal = rangeSales.reduce((s, e) => s + e.totalAmount, 0);
  const todayExpensesTotal = rangeExpenses.reduce((s, e) => s + e.totalAmount, 0);
  const todayWasteTotal = rangeWaste.reduce((s, e) => s + e.costValue, 0);
  const todayProfit = todaySalesTotal - todayExpensesTotal - todayWasteTotal;

  const mtdSalesTotal = mtdSales.reduce((s, e) => s + e.totalAmount, 0);
  const mtdExpensesTotal = mtdExpenses.reduce((s, e) => s + e.totalAmount, 0);
  const mtdWasteTotal = mtdWaste.reduce((s, e) => s + e.costValue, 0);
  const mtdProfit = mtdSalesTotal - mtdExpensesTotal - mtdWasteTotal;

  const lowStockIngredients = await db.select().from(ingredientsTable).where(eq(ingredientsTable.active, true));
  const lowStockCount = lowStockIngredients.filter(i => i.currentStock <= i.reorderLevel).length;

  const itemRevenueMap = new Map<number, { menuItemId: number; menuItemName: string; quantity: number; revenue: number }>();
  for (const s of rangeSales) {
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

  const todaySettlement = await db.select().from(dailySalesSettlementsTable).where(and(gte(dailySalesSettlementsTable.settlementDate, fromDate), lte(dailySalesSettlementsTable.settlementDate, toDate)));
  const todaySettlementTotal = todaySettlement.reduce((s, e) => s + e.totalSettlementAmount, 0);
  const todaySettlementDiff = todaySettlement.reduce((s, e) => s + e.differenceAmount, 0);

  const pcResult = await db.select({
    totalReceipts: sql<number>`COALESCE(SUM(CASE WHEN transaction_type = 'receipt' THEN amount ELSE 0 END), 0)`,
    totalExpenses: sql<number>`COALESCE(SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END), 0)`,
    totalAdjustments: sql<number>`COALESCE(SUM(CASE WHEN transaction_type = 'adjustment' THEN amount ELSE 0 END), 0)`,
  }).from(pettyCashLedgerTable);
  const pettyCashBalance = Number(pcResult[0]?.totalReceipts || 0) - Number(pcResult[0]?.totalExpenses || 0) + Number(pcResult[0]?.totalAdjustments || 0);

  const todayPcExpenses = await db.select({
    total: sql<number>`COALESCE(SUM(amount), 0)`,
  }).from(pettyCashLedgerTable).where(and(gte(pettyCashLedgerTable.transactionDate, fromDate), lte(pettyCashLedgerTable.transactionDate, toDate), eq(pettyCashLedgerTable.transactionType, 'expense')));
  const pettyCashSpentToday = Number(todayPcExpenses[0]?.total || 0);

  const unsettledDays = await db.select({
    count: sql<number>`COUNT(*)`,
  }).from(dailySalesSettlementsTable).where(sql`${dailySalesSettlementsTable.differenceType} != 'matched' AND ${dailySalesSettlementsTable.status} != 'verified'`);

  const allPurchases = await db.select({
    totalAmount: purchasesTable.totalAmount,
    paidAmount: purchasesTable.paidAmount,
    pendingAmount: purchasesTable.pendingAmount,
    dueDate: purchasesTable.dueDate,
  }).from(purchasesTable);

  let vendorTotalPayable = 0;
  let vendorTotalOverdue = 0;
  let vendorOverdueBills = 0;
  const todayStr = getToday();
  for (const p of allPurchases) {
    vendorTotalPayable += p.pendingAmount ?? 0;
    if (p.dueDate && p.dueDate < todayStr && (p.pendingAmount ?? 0) > 0) {
      vendorTotalOverdue += p.pendingAmount ?? 0;
      vendorOverdueBills++;
    }
  }

  const rangeInvoices = await db.select({
    count: sql<number>`COUNT(*)`,
    grossTotal: sql<number>`COALESCE(SUM(gross_amount), 0)`,
    gstTotal: sql<number>`COALESCE(SUM(gst_amount), 0)`,
    discountTotal: sql<number>`COALESCE(SUM(total_discount), 0)`,
    netTotal: sql<number>`COALESCE(SUM(final_amount), 0)`,
  }).from(salesInvoicesTable).where(and(gte(salesInvoicesTable.salesDate, fromDate), lte(salesInvoicesTable.salesDate, toDate)));

  const invoiceStats = {
    count: Number(rangeInvoices[0]?.count || 0),
    grossTotal: Number(rangeInvoices[0]?.grossTotal || 0),
    gstCollected: Number(rangeInvoices[0]?.gstTotal || 0),
    discountTotal: Number(rangeInvoices[0]?.discountTotal || 0),
    netSales: Number(rangeInvoices[0]?.netTotal || 0),
  };

  const insights: string[] = [];
  if (todaySalesTotal > 0) insights.push(`Today's sales: ${todaySalesTotal.toFixed(0)}`);
  if (invoiceStats.count > 0) insights.push(`${invoiceStats.count} invoices, net ${invoiceStats.netSales.toFixed(0)}`);
  if (todayWasteTotal > 0) insights.push(`Today's waste value: ${todayWasteTotal.toFixed(0)}`);
  if (lowStockCount > 0) insights.push(`${lowStockCount} ingredients are below reorder level`);
  if (Number(unsettledDays[0]?.count || 0) > 0) insights.push(`${unsettledDays[0]?.count} unsettled/mismatched days`);
  if (vendorTotalOverdue > 0) insights.push(`${vendorOverdueBills} overdue vendor bills (${vendorTotalOverdue.toFixed(0)})`);

  res.json({
    fromDate,
    toDate,
    isSingleDay,
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
    todaySettlement: todaySettlementTotal,
    todaySettlementDiff,
    pettyCashBalance,
    pettyCashSpentToday,
    unsettledDaysCount: Number(unsettledDays[0]?.count || 0),
    yesterdaySales: yesterdaySalesTotal,
    lastWeekSameDaySales: lastWeekSameDaySalesTotal,
    vendorPayable: Math.round(vendorTotalPayable * 100) / 100,
    vendorOverdue: Math.round(vendorTotalOverdue * 100) / 100,
    vendorOverdueBills: vendorOverdueBills,
    invoiceStats,
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

router.get("/dashboard/trend", authMiddleware, async (req, res): Promise<void> => {
  const days = Number(req.query.days) || 7;
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days + 1);
  
  const fromStr = startDate.toISOString().split("T")[0];
  const toStr = endDate.toISOString().split("T")[0];
  
  const sales = await db.select().from(salesEntriesTable)
    .where(and(gte(salesEntriesTable.salesDate, fromStr), lte(salesEntriesTable.salesDate, toStr)));
  const expenses = await db.select().from(expensesTable)
    .where(and(gte(expensesTable.expenseDate, fromStr), lte(expensesTable.expenseDate, toStr)));
  const waste = await db.select().from(wasteEntriesTable)
    .where(and(gte(wasteEntriesTable.wasteDate, fromStr), lte(wasteEntriesTable.wasteDate, toStr)));
  
  const trend: { date: string; sales: number; expenses: number; waste: number; profit: number }[] = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    const daySales = sales.filter(s => s.salesDate === dateStr).reduce((sum, s) => sum + s.totalAmount, 0);
    const dayExpenses = expenses.filter(e => e.expenseDate === dateStr).reduce((sum, e) => sum + Number(e.totalAmount), 0);
    const dayWaste = waste.filter(w => w.wasteDate === dateStr).reduce((sum, w) => sum + Number(w.costValue), 0);
    trend.push({ date: dateStr, sales: daySales, expenses: dayExpenses, waste: dayWaste, profit: daySales - dayExpenses - dayWaste });
  }
  
  res.json(trend);
});

export default router;
