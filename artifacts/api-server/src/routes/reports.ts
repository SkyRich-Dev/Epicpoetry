import { Router, type IRouter } from "express";
import { eq, and, gte, lte } from "drizzle-orm";
import { db, purchasesTable, expensesTable, salesEntriesTable, wasteEntriesTable, ingredientsTable, vendorsTable, menuItemsTable, recipeLinesTable, salesInvoicesTable } from "@workspace/db";
import { authMiddleware } from "../lib/auth";

const router: IRouter = Router();

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function padDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseDateParts(dateStr: string): { y: number; m: number; d: number } | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { y: parseInt(match[1]), m: parseInt(match[2]), d: parseInt(match[3]) };
}

function isValidDate(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function getDateRange(period: string, fromDate?: string, toDate?: string): { from: string; to: string } {
  const today = getToday();
  const ref = (fromDate && isValidDate(fromDate)) ? fromDate : today;

  switch (period) {
    case "daily":
      return { from: ref, to: ref };
    case "weekly": {
      const parts = parseDateParts(ref);
      if (!parts) return { from: ref, to: ref };
      const d = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
      const dayOfWeek = d.getUTCDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + mondayOffset));
      const sunday = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + mondayOffset + 6));
      return {
        from: padDate(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate()),
        to: padDate(sunday.getUTCFullYear(), sunday.getUTCMonth() + 1, sunday.getUTCDate()),
      };
    }
    case "monthly": {
      const parts = parseDateParts(ref);
      if (!parts) return { from: ref, to: ref };
      const lastDay = new Date(Date.UTC(parts.y, parts.m, 0)).getUTCDate();
      return { from: padDate(parts.y, parts.m, 1), to: padDate(parts.y, parts.m, lastDay) };
    }
    case "custom":
      return {
        from: (fromDate && isValidDate(fromDate)) ? fromDate : today,
        to: (toDate && isValidDate(toDate)) ? toDate : today,
      };
    default:
      return { from: ref, to: (toDate && isValidDate(toDate)) ? toDate : today };
  }
}

async function computeUnitCost(menuItemId: number): Promise<number> {
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
  return unitCost;
}

router.get("/reports/item-profitability", authMiddleware, async (req, res): Promise<void> => {
  const period = (req.query.period as string) || "monthly";
  if (!["daily", "weekly", "monthly", "custom"].includes(period)) {
    res.status(400).json({ error: "Invalid period. Use: daily, weekly, monthly, or custom" }); return;
  }
  if (period === "custom" && (!req.query.fromDate || !req.query.toDate)) {
    res.status(400).json({ error: "Custom period requires fromDate and toDate" }); return;
  }
  const { from, to } = getDateRange(period, req.query.fromDate as string, req.query.toDate as string);

  const sales = await db
    .select({
      salesDate: salesEntriesTable.salesDate,
      menuItemId: salesEntriesTable.menuItemId,
      quantity: salesEntriesTable.quantity,
      sellingPrice: salesEntriesTable.sellingPrice,
      totalAmount: salesEntriesTable.totalAmount,
      discount: salesEntriesTable.discount,
    })
    .from(salesEntriesTable)
    .where(and(gte(salesEntriesTable.salesDate, from), lte(salesEntriesTable.salesDate, to)));

  const itemMap = new Map<number, { quantitySold: number; revenue: number; grossSales: number; totalDiscount: number }>();
  for (const s of sales) {
    const existing = itemMap.get(s.menuItemId) || { quantitySold: 0, revenue: 0, grossSales: 0, totalDiscount: 0 };
    existing.quantitySold += s.quantity;
    existing.revenue += s.totalAmount;
    existing.grossSales += s.quantity * s.sellingPrice;
    existing.totalDiscount += s.discount;
    itemMap.set(s.menuItemId, existing);
  }

  const allMenuItems = await db.select().from(menuItemsTable).where(eq(menuItemsTable.active, true));
  const result = [];

  for (const menuItem of allMenuItems) {
    const salesData = itemMap.get(menuItem.id);
    const unitCost = await computeUnitCost(menuItem.id);

    const quantitySold = salesData?.quantitySold || 0;
    const revenue = salesData?.revenue || 0;
    const totalProductionCost = unitCost * quantitySold;
    const grossProfit = revenue - totalProductionCost;
    const marginPercent = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

    result.push({
      menuItemId: menuItem.id,
      menuItemName: menuItem.name,
      sellingPrice: menuItem.sellingPrice,
      unitProductionCost: Math.round(unitCost * 100) / 100,
      quantitySold,
      grossSales: salesData?.grossSales || 0,
      totalDiscount: salesData?.totalDiscount || 0,
      netRevenue: revenue,
      totalProductionCost: Math.round(totalProductionCost * 100) / 100,
      grossProfit: Math.round(grossProfit * 100) / 100,
      marginPercent: Math.round(marginPercent * 10) / 10,
      costToSaleRatio: menuItem.sellingPrice > 0 ? Math.round((unitCost / menuItem.sellingPrice) * 1000) / 10 : 0,
    });
  }

  res.json({
    period,
    fromDate: from,
    toDate: to,
    items: result.sort((a, b) => b.netRevenue - a.netRevenue),
    summary: {
      totalRevenue: result.reduce((s, i) => s + i.netRevenue, 0),
      totalProductionCost: Math.round(result.reduce((s, i) => s + i.totalProductionCost, 0) * 100) / 100,
      totalGrossProfit: Math.round(result.reduce((s, i) => s + i.grossProfit, 0) * 100) / 100,
      avgMarginPercent: (() => {
        const totalRev = result.reduce((s, i) => s + i.netRevenue, 0);
        const totalProfit = result.reduce((s, i) => s + i.grossProfit, 0);
        return totalRev > 0 ? Math.round((totalProfit / totalRev) * 1000) / 10 : 0;
      })(),
      totalItemsSold: result.reduce((s, i) => s + i.quantitySold, 0),
    },
  });
});

router.get("/reports/item-wastage", authMiddleware, async (req, res): Promise<void> => {
  const period = (req.query.period as string) || "monthly";
  if (!["daily", "weekly", "monthly", "custom"].includes(period)) {
    res.status(400).json({ error: "Invalid period. Use: daily, weekly, monthly, or custom" }); return;
  }
  if (period === "custom" && (!req.query.fromDate || !req.query.toDate)) {
    res.status(400).json({ error: "Custom period requires fromDate and toDate" }); return;
  }
  const { from, to } = getDateRange(period, req.query.fromDate as string, req.query.toDate as string);

  const wasteEntries = await db.select().from(wasteEntriesTable)
    .where(and(gte(wasteEntriesTable.wasteDate, from), lte(wasteEntriesTable.wasteDate, to)));

  const allIngredients = await db.select().from(ingredientsTable);
  const ingMap = new Map(allIngredients.map(i => [i.id, i]));

  const allMenuItems = await db.select().from(menuItemsTable);
  const menuMap = new Map(allMenuItems.map(m => [m.id, m]));

  const ingWasteMap = new Map<number, { name: string; entries: number; totalQty: number; totalCost: number; uom: string; reasons: Map<string, number> }>();
  const menuWasteMap = new Map<number, { name: string; entries: number; totalQty: number; totalCost: number; uom: string; reasons: Map<string, number> }>();

  for (const w of wasteEntries) {
    if (w.ingredientId) {
      const ing = ingMap.get(w.ingredientId);
      const key = w.ingredientId;
      const existing = ingWasteMap.get(key) || { name: ing?.name || "Unknown", entries: 0, totalQty: 0, totalCost: 0, uom: w.uom, reasons: new Map() };
      existing.entries++;
      existing.totalQty += w.quantity;
      existing.totalCost += w.costValue;
      const reason = w.reason || "Unspecified";
      existing.reasons.set(reason, (existing.reasons.get(reason) || 0) + 1);
      ingWasteMap.set(key, existing);
    }

    if (w.menuItemId) {
      const mi = menuMap.get(w.menuItemId);
      const key = w.menuItemId;
      const existing = menuWasteMap.get(key) || { name: mi?.name || "Unknown", entries: 0, totalQty: 0, totalCost: 0, uom: w.uom, reasons: new Map() };
      existing.entries++;
      existing.totalQty += w.quantity;
      existing.totalCost += w.costValue;
      const reason = w.reason || "Unspecified";
      existing.reasons.set(reason, (existing.reasons.get(reason) || 0) + 1);
      menuWasteMap.set(key, existing);
    }
  }

  const ingredientWaste = Array.from(ingWasteMap.entries()).map(([id, data]) => ({
    type: "ingredient" as const,
    id,
    name: data.name,
    entries: data.entries,
    totalQuantity: data.totalQty,
    uom: data.uom,
    totalCostValue: Math.round(data.totalCost * 100) / 100,
    topReasons: Array.from(data.reasons.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, count]) => ({ reason, count })),
  })).sort((a, b) => b.totalCostValue - a.totalCostValue);

  const menuItemWaste = Array.from(menuWasteMap.entries()).map(([id, data]) => ({
    type: "menu_item" as const,
    id,
    name: data.name,
    entries: data.entries,
    totalQuantity: data.totalQty,
    uom: data.uom,
    totalCostValue: Math.round(data.totalCost * 100) / 100,
    topReasons: Array.from(data.reasons.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, count]) => ({ reason, count })),
  })).sort((a, b) => b.totalCostValue - a.totalCostValue);

  const dailyTrend = new Map<string, number>();
  for (const w of wasteEntries) {
    dailyTrend.set(w.wasteDate, (dailyTrend.get(w.wasteDate) || 0) + w.costValue);
  }

  const salesInPeriod = await db.select().from(salesEntriesTable)
    .where(and(gte(salesEntriesTable.salesDate, from), lte(salesEntriesTable.salesDate, to)));
  const totalSalesRevenue = salesInPeriod.reduce((s, e) => s + e.totalAmount, 0);
  const totalWasteCost = wasteEntries.reduce((s, e) => s + e.costValue, 0);

  res.json({
    period,
    fromDate: from,
    toDate: to,
    ingredientWaste,
    menuItemWaste,
    dailyTrend: Array.from(dailyTrend.entries()).map(([date, value]) => ({ date, value: Math.round(value * 100) / 100 })).sort((a, b) => a.date.localeCompare(b.date)),
    summary: {
      totalWasteEntries: wasteEntries.length,
      totalWasteCost: Math.round(totalWasteCost * 100) / 100,
      totalSalesRevenue,
      wasteToSalesPercent: totalSalesRevenue > 0 ? Math.round((totalWasteCost / totalSalesRevenue) * 1000) / 10 : 0,
      uniqueIngredientsWasted: ingWasteMap.size,
      uniqueMenuItemsWasted: menuWasteMap.size,
    },
  });
});

router.get("/reports/export", authMiddleware, async (req, res): Promise<void> => {
  const reportType = req.query.reportType as string;
  const fromDate = req.query.fromDate as string;
  const toDate = req.query.toDate as string;

  let csvContent = "";

  switch (reportType) {
    case "purchases": {
      const data = await db
        .select({
          purchaseNumber: purchasesTable.purchaseNumber,
          purchaseDate: purchasesTable.purchaseDate,
          vendorName: vendorsTable.name,
          totalAmount: purchasesTable.totalAmount,
          paymentStatus: purchasesTable.paymentStatus,
        })
        .from(purchasesTable)
        .leftJoin(vendorsTable, eq(purchasesTable.vendorId, vendorsTable.id));
      csvContent = "Purchase Number,Date,Vendor,Amount,Status\n" + data.map(d => `${d.purchaseNumber},${d.purchaseDate},${d.vendorName},${d.totalAmount},${d.paymentStatus}`).join("\n");
      break;
    }
    case "expenses": {
      const data = await db.select().from(expensesTable);
      csvContent = "Expense Number,Date,Amount,Type,Description\n" + data.map(d => `${d.expenseNumber},${d.expenseDate},${d.totalAmount},${d.costType},${d.description || ""}`).join("\n");
      break;
    }
    case "sales": {
      const data = await db
        .select({
          salesDate: salesEntriesTable.salesDate,
          menuItemName: menuItemsTable.name,
          quantity: salesEntriesTable.quantity,
          totalAmount: salesEntriesTable.totalAmount,
          channel: salesEntriesTable.channel,
        })
        .from(salesEntriesTable)
        .leftJoin(menuItemsTable, eq(salesEntriesTable.menuItemId, menuItemsTable.id));
      csvContent = "Date,Item,Quantity,Amount,Channel\n" + data.map(d => `${d.salesDate},${d.menuItemName},${d.quantity},${d.totalAmount},${d.channel}`).join("\n");
      break;
    }
    case "waste": {
      const data = await db
        .select({
          wasteNumber: wasteEntriesTable.wasteNumber,
          wasteDate: wasteEntriesTable.wasteDate,
          wasteType: wasteEntriesTable.wasteType,
          quantity: wasteEntriesTable.quantity,
          costValue: wasteEntriesTable.costValue,
          reason: wasteEntriesTable.reason,
        })
        .from(wasteEntriesTable);
      csvContent = "Waste Number,Date,Type,Quantity,Cost,Reason\n" + data.map(d => `${d.wasteNumber},${d.wasteDate},${d.wasteType},${d.quantity},${d.costValue},${d.reason || ""}`).join("\n");
      break;
    }
    case "ingredients": {
      const data = await db.select().from(ingredientsTable);
      csvContent = "Code,Name,Stock UOM,Current Stock,Cost,Active\n" + data.map(d => `${d.code},${d.name},${d.stockUom},${d.currentStock},${d.weightedAvgCost},${d.active}`).join("\n");
      break;
    }
    case "sales-invoices": {
      const data = await db.select().from(salesInvoicesTable);
      csvContent = "Invoice No,Date,Customer,Gross Amount,Discount,GST,Final Amount,Payment Mode,Match Status,Verified\n" + data.map(d => `${d.invoiceNo},${d.salesDate},"${d.customerName || ''}",${d.grossAmount},${d.totalDiscount},${d.gstAmount},${d.finalAmount},${d.paymentMode},${d.matchStatus},${d.verified}`).join("\n");
      break;
    }
    default:
      csvContent = "No data available for this report type";
  }

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=${reportType}_report.csv`);
  res.send(csvContent);
});

export default router;
