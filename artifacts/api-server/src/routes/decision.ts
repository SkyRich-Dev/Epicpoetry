import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql, isNotNull, desc, inArray } from "drizzle-orm";
import {
  db,
  salesInvoicesTable,
  salesInvoiceLinesTable,
  menuItemsTable,
  customersTable,
  ingredientsTable,
  recipeLinesTable,
  stockSnapshotsTable,
  wasteEntriesTable,
  purchasesTable,
  purchaseLinesTable,
  vendorsTable,
  expensesTable,
  dailySalesSettlementsTable,
  settlementLinesTable,
  usersTable,
} from "@workspace/db";
import { authMiddleware } from "../lib/auth";

const router: IRouter = Router();

// ----------------------------- helpers -----------------------------
function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}
function getRange(req: any, defaultDays = 30): { fromDate: string; toDate: string } {
  const toDate = (req.query.toDate as string) || fmtDate(new Date());
  const fromDate = (req.query.fromDate as string) || fmtDate(addDays(new Date(toDate), -(defaultDays - 1)));
  return { fromDate, toDate };
}
function r2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Compute theoretical recipe cost for a single menu item (₹ per sold unit)
async function getRecipeCostMap(): Promise<Map<number, number>> {
  const lines = await db.select({
    menuItemId: recipeLinesTable.menuItemId,
    ingredientId: recipeLinesTable.ingredientId,
    quantity: recipeLinesTable.quantity,
    wastagePercent: recipeLinesTable.wastagePercent,
  }).from(recipeLinesTable);
  const ings = await db.select({
    id: ingredientsTable.id,
    latestCost: ingredientsTable.latestCost,
    conversionFactor: ingredientsTable.conversionFactor,
  }).from(ingredientsTable);
  const ingMap = new Map(ings.map(i => [i.id, i]));
  const costMap = new Map<number, number>();
  for (const l of lines) {
    const ing = ingMap.get(l.ingredientId);
    if (!ing) continue;
    const cf = ing.conversionFactor || 1;
    const netQty = l.quantity * (1 + (l.wastagePercent || 0) / 100);
    const costPerUnit = (ing.latestCost || 0) / (cf || 1);
    const cost = netQty * costPerUnit;
    costMap.set(l.menuItemId, (costMap.get(l.menuItemId) || 0) + cost);
  }
  return costMap;
}

// ============================ REVENUE ==============================

// 5.1 Revenue Leakage Detection
router.get("/decision/revenue/leakage", authMiddleware, async (req, res): Promise<void> => {
  const { fromDate, toDate } = getRange(req, 30);
  const HIGH_DISCOUNT_PCT = Number(req.query.highDiscountPct) || 15;

  const invoices = await db.select().from(salesInvoicesTable)
    .where(and(gte(salesInvoicesTable.salesDate, fromDate), lte(salesInvoicesTable.salesDate, toDate)));

  const totalGross = invoices.reduce((s, i) => s + (i.grossAmount || 0), 0);
  const totalDiscount = invoices.reduce((s, i) => s + (i.totalDiscount || 0), 0);
  const avgDiscountPct = totalGross > 0 ? (totalDiscount / totalGross) * 100 : 0;

  const highDiscountInvoices = invoices
    .map(i => ({ ...i, discountPct: i.grossAmount > 0 ? (i.totalDiscount / i.grossAmount) * 100 : 0 }))
    .filter(i => i.discountPct >= HIGH_DISCOUNT_PCT)
    .sort((a, b) => b.discountPct - a.discountPct)
    .slice(0, 20)
    .map(i => ({
      id: i.id, invoiceNo: i.invoiceNo, salesDate: i.salesDate, invoiceTime: i.invoiceTime,
      grossAmount: r2(i.grossAmount), discount: r2(i.totalDiscount),
      discountPct: r2(i.discountPct), finalAmount: r2(i.finalAmount),
    }));

  // Discount by hour
  const byHour = new Map<number, { hour: number; gross: number; discount: number; count: number }>();
  for (let h = 0; h < 24; h++) byHour.set(h, { hour: h, gross: 0, discount: 0, count: 0 });
  for (const i of invoices) {
    if (!i.invoiceTime) continue;
    const h = parseInt(i.invoiceTime.split(":")[0], 10);
    if (isNaN(h) || h < 0 || h > 23) continue;
    const e = byHour.get(h);
    if (!e) continue;
    e.gross += i.grossAmount; e.discount += i.totalDiscount; e.count++;
  }
  const discountByHour = [...byHour.values()]
    .map(h => ({ ...h, discountPct: h.gross > 0 ? (h.discount / h.gross) * 100 : 0 }))
    .filter(h => h.count > 0)
    .map(h => ({ hour: h.hour, count: h.count, discount: r2(h.discount), discountPct: r2(h.discountPct) }));
  const peakDiscountHour = discountByHour.length
    ? discountByHour.reduce((m, x) => x.discountPct > m.discountPct ? x : m)
    : null;

  // Items realized below standard (avg realized price < sellingPrice * 0.95)
  const invIds = invoices.map(i => i.id);
  let belowPriceItems: any[] = [];
  if (invIds.length > 0) {
    const lines = await db.select({
      menuItemId: salesInvoiceLinesTable.menuItemId,
      itemName: menuItemsTable.name,
      sellingPrice: menuItemsTable.sellingPrice,
      qty: salesInvoiceLinesTable.quantity,
      gross: salesInvoiceLinesTable.grossLineAmount,
      finalAmt: salesInvoiceLinesTable.finalLineAmount,
    }).from(salesInvoiceLinesTable)
      .leftJoin(menuItemsTable, eq(salesInvoiceLinesTable.menuItemId, menuItemsTable.id))
      .where(inArray(salesInvoiceLinesTable.invoiceId, invIds));

    const itemMap = new Map<number, any>();
    for (const l of lines) {
      const e = itemMap.get(l.menuItemId) || { menuItemId: l.menuItemId, itemName: l.itemName || "—", sellingPrice: l.sellingPrice || 0, qty: 0, gross: 0, final: 0 };
      e.qty += l.qty; e.gross += l.gross; e.final += l.finalAmt;
      itemMap.set(l.menuItemId, e);
    }
    belowPriceItems = [...itemMap.values()]
      .map(x => ({
        ...x,
        avgRealizedPrice: x.qty > 0 ? x.final / x.qty : 0,
        priceGapPct: x.sellingPrice > 0 && x.qty > 0
          ? ((x.sellingPrice - x.final / x.qty) / x.sellingPrice) * 100 : 0,
      }))
      .filter(x => x.qty >= 5 && x.sellingPrice > 0 && x.priceGapPct >= 5)
      .sort((a, b) => b.priceGapPct - a.priceGapPct)
      .slice(0, 15)
      .map(x => ({
        menuItemId: x.menuItemId, itemName: x.itemName,
        qty: r2(x.qty), sellingPrice: r2(x.sellingPrice),
        avgRealizedPrice: r2(x.avgRealizedPrice), priceGapPct: r2(x.priceGapPct),
        revenueLossEst: r2((x.sellingPrice - x.final / x.qty) * x.qty),
      }));
  }

  res.json({
    fromDate, toDate,
    summary: {
      totalGross: r2(totalGross), totalDiscount: r2(totalDiscount),
      avgDiscountPct: r2(avgDiscountPct), invoiceCount: invoices.length,
      highDiscountThreshold: HIGH_DISCOUNT_PCT,
      highDiscountCount: highDiscountInvoices.length,
    },
    highDiscountInvoices,
    discountByHour,
    peakDiscountHour,
    belowPriceItems,
  });
});

// 5.2 Real Profit vs Theoretical Profit
router.get("/decision/revenue/profit-comparison", authMiddleware, async (req, res): Promise<void> => {
  const { fromDate, toDate } = getRange(req, 30);
  const invoices = await db.select().from(salesInvoicesTable)
    .where(and(gte(salesInvoicesTable.salesDate, fromDate), lte(salesInvoicesTable.salesDate, toDate)));
  const invIds = invoices.map(i => i.id);
  const totalRevenue = invoices.reduce((s, i) => s + i.finalAmount, 0);
  const grossRevenue = invoices.reduce((s, i) => s + (i.grossAmount || 0), 0);
  const totalDiscount = invoices.reduce((s, i) => s + (i.totalDiscount || 0), 0);

  const recipeCost = await getRecipeCostMap();
  let theoreticalCogs = 0;
  if (invIds.length > 0) {
    const lines = await db.select({
      menuItemId: salesInvoiceLinesTable.menuItemId,
      qty: salesInvoiceLinesTable.quantity,
    }).from(salesInvoiceLinesTable)
      .where(inArray(salesInvoiceLinesTable.invoiceId, invIds));
    for (const l of lines) {
      theoreticalCogs += (recipeCost.get(l.menuItemId) || 0) * l.qty;
    }
  }

  // Waste cost in window
  const wasteRows = await db.select({
    cost: sql<number>`COALESCE(SUM(${wasteEntriesTable.costValue}), 0)`,
  }).from(wasteEntriesTable)
    .where(and(gte(wasteEntriesTable.wasteDate, fromDate), lte(wasteEntriesTable.wasteDate, toDate)));
  const wasteCost = Number(wasteRows[0]?.cost || 0);

  // Stock-based variance: actual consumedQty cost - theoretical
  const snaps = await db.select({
    ingredientId: stockSnapshotsTable.ingredientId,
    consumed: sql<number>`COALESCE(SUM(${stockSnapshotsTable.consumedQty}), 0)`,
  }).from(stockSnapshotsTable)
    .where(and(gte(stockSnapshotsTable.snapshotDate, fromDate), lte(stockSnapshotsTable.snapshotDate, toDate)))
    .groupBy(stockSnapshotsTable.ingredientId);
  const ings = await db.select({
    id: ingredientsTable.id, latestCost: ingredientsTable.latestCost, conversionFactor: ingredientsTable.conversionFactor,
  }).from(ingredientsTable);
  const ingMap = new Map(ings.map(i => [i.id, i]));
  let actualCogs = 0;
  for (const s of snaps) {
    const ing = ingMap.get(s.ingredientId);
    if (!ing) continue;
    actualCogs += (Number(s.consumed) || 0) * ((ing.latestCost || 0) / (ing.conversionFactor || 1));
  }

  // Expense allocation in window (operating expenses)
  const exp = await db.select({
    sum: sql<number>`COALESCE(SUM(${expensesTable.totalAmount}), 0)`,
  }).from(expensesTable)
    .where(and(gte(expensesTable.expenseDate, fromDate), lte(expensesTable.expenseDate, toDate)));
  const expensesTotal = Number(exp[0]?.sum || 0);

  // theoreticalProfit = revenue − theoretical COGS (no waste, no opex)
  // actualOperatingContribution = revenue − actualCogs − waste − opex
  // variance = theoreticalProfit − actualOperatingContribution
  //          = (actualCogs − theoreticalCogs) + waste + opex
  // Discount is already netted into revenue, so it is NOT listed as a variance driver here.
  const effectiveActualCogs = actualCogs > 0 ? actualCogs : theoreticalCogs;
  const theoreticalProfit = totalRevenue - theoreticalCogs;
  const actualOperatingContribution = totalRevenue - effectiveActualCogs - wasteCost - expensesTotal;
  const variance = theoreticalProfit - actualOperatingContribution;

  const drivers: { name: string; amount: number }[] = [
    { name: "Cost variance (actual − theoretical COGS)", amount: r2(effectiveActualCogs - theoreticalCogs) },
    { name: "Waste cost", amount: r2(wasteCost) },
    { name: "Operating expenses", amount: r2(expensesTotal) },
  ].sort((a, b) => b.amount - a.amount);

  res.json({
    fromDate, toDate,
    revenue: { gross: r2(grossRevenue), net: r2(totalRevenue), discount: r2(totalDiscount) },
    cogs: { theoretical: r2(theoreticalCogs), actual: r2(actualCogs), wasteCost: r2(wasteCost) },
    expenses: { total: r2(expensesTotal) },
    theoreticalProfit: r2(theoreticalProfit),
    actualOperatingContribution: r2(actualOperatingContribution),
    variance: r2(variance),
    drivers,
    note: actualCogs === 0 ? "No stock-snapshot consumption recorded in this window — variance falls back to theoretical only." : null,
  });
});

// 5.3 High Margin vs High Volume Items (BCG-style matrix)
router.get("/decision/revenue/item-matrix", authMiddleware, async (req, res): Promise<void> => {
  const { fromDate, toDate } = getRange(req, 30);
  const invoices = await db.select({ id: salesInvoicesTable.id })
    .from(salesInvoicesTable)
    .where(and(gte(salesInvoicesTable.salesDate, fromDate), lte(salesInvoicesTable.salesDate, toDate)));
  const invIds = invoices.map(i => i.id);
  if (invIds.length === 0) { res.json({ fromDate, toDate, items: [], thresholds: {} }); return; }

  const lines = await db.select({
    menuItemId: salesInvoiceLinesTable.menuItemId,
    itemName: menuItemsTable.name,
    qty: salesInvoiceLinesTable.quantity,
    revenue: salesInvoiceLinesTable.finalLineAmount,
  }).from(salesInvoiceLinesTable)
    .leftJoin(menuItemsTable, eq(salesInvoiceLinesTable.menuItemId, menuItemsTable.id))
    .where(inArray(salesInvoiceLinesTable.invoiceId, invIds));

  const recipeCost = await getRecipeCostMap();

  const map = new Map<number, any>();
  for (const l of lines) {
    const e = map.get(l.menuItemId) || { menuItemId: l.menuItemId, itemName: l.itemName || "—", qty: 0, revenue: 0, cost: 0 };
    e.qty += l.qty;
    e.revenue += l.revenue;
    e.cost += (recipeCost.get(l.menuItemId) || 0) * l.qty;
    map.set(l.menuItemId, e);
  }
  const items = [...map.values()].map(x => {
    const margin = x.revenue - x.cost;
    const marginPct = x.revenue > 0 ? (margin / x.revenue) * 100 : 0;
    return { ...x, qty: r2(x.qty), revenue: r2(x.revenue), cost: r2(x.cost), margin: r2(margin), marginPct: r2(marginPct) };
  });

  if (items.length === 0) { res.json({ fromDate, toDate, items: [], thresholds: {} }); return; }
  const sortedQty = [...items].map(i => i.qty).sort((a, b) => a - b);
  const sortedMargin = [...items].map(i => i.marginPct).sort((a, b) => a - b);
  const median = (arr: number[]) => arr.length ? arr[Math.floor(arr.length / 2)] : 0;
  const qtyThreshold = median(sortedQty);
  const marginThreshold = median(sortedMargin);

  const enriched = items.map(it => {
    const isHighVol = it.qty >= qtyThreshold;
    const isHighMargin = it.marginPct >= marginThreshold;
    let quadrant = "low_vol_low_margin";
    let action = "Review retention or discontinue";
    if (isHighVol && isHighMargin) { quadrant = "star"; action = "Push more — top performer"; }
    else if (isHighVol && !isHighMargin) { quadrant = "workhorse"; action = "Review costing or pricing — high volume, thin margin"; }
    else if (!isHighVol && isHighMargin) { quadrant = "hidden_gem"; action = "Promote — high margin, low volume"; }
    return { ...it, quadrant, action };
  });

  res.json({
    fromDate, toDate,
    thresholds: { qty: r2(qtyThreshold), marginPct: r2(marginThreshold) },
    counts: {
      star: enriched.filter(i => i.quadrant === "star").length,
      workhorse: enriched.filter(i => i.quadrant === "workhorse").length,
      hidden_gem: enriched.filter(i => i.quadrant === "hidden_gem").length,
      low_vol_low_margin: enriched.filter(i => i.quadrant === "low_vol_low_margin").length,
    },
    items: enriched.sort((a, b) => b.revenue - a.revenue),
  });
});

// ============================ CUSTOMER =============================

// 6.1 CLV
router.get("/decision/customer/clv", authMiddleware, async (_req, res): Promise<void> => {
  const customers = await db.select().from(customersTable);
  if (customers.length === 0) {
    res.json({ totalCustomers: 0, totalCLV: 0, top: [], concentration: { top10Pct: 0, top20Pct: 0 } });
    return;
  }
  const today = new Date();
  const enriched = customers.map(c => {
    const tenureDays = c.firstVisitDate ? Math.max(1, daysBetween(c.firstVisitDate, fmtDate(today))) : 1;
    const visitFreq = c.totalVisits / Math.max(1, tenureDays / 30); // visits/month
    const avgSpend = c.totalVisits > 0 ? c.totalSpent / c.totalVisits : 0;
    // Simple CLV score: total spent + projected 6-month future spend
    const clvScore = c.totalSpent + (avgSpend * visitFreq * 6);
    return {
      id: c.id, name: c.name, phone: c.phone,
      totalVisits: c.totalVisits, totalSpent: r2(c.totalSpent),
      avgSpend: r2(avgSpend), visitFreqPerMonth: r2(visitFreq),
      tenureDays, clvScore: r2(clvScore),
    };
  }).sort((a, b) => b.clvScore - a.clvScore);

  const totalCLV = enriched.reduce((s, e) => s + e.clvScore, 0);
  const top10n = Math.max(1, Math.ceil(enriched.length * 0.1));
  const top20n = Math.max(1, Math.ceil(enriched.length * 0.2));
  const top10CLV = enriched.slice(0, top10n).reduce((s, e) => s + e.clvScore, 0);
  const top20CLV = enriched.slice(0, top20n).reduce((s, e) => s + e.clvScore, 0);

  res.json({
    totalCustomers: enriched.length,
    totalCLV: r2(totalCLV),
    concentration: {
      top10Pct: totalCLV > 0 ? r2((top10CLV / totalCLV) * 100) : 0,
      top20Pct: totalCLV > 0 ? r2((top20CLV / totalCLV) * 100) : 0,
    },
    top: enriched.slice(0, 25),
  });
});

// 6.2 + 6.3 Visit Prediction & Churn
router.get("/decision/customer/churn", authMiddleware, async (_req, res): Promise<void> => {
  const customers = await db.select().from(customersTable);
  const today = new Date();
  const buckets = { hot: 0, watch: 0, at_risk: 0, churned: 0 };
  const list: any[] = [];

  for (const c of customers) {
    if (!c.lastVisitDate || c.totalVisits === 0) continue;
    const daysSince = daysBetween(c.lastVisitDate, fmtDate(today));
    let bucket = "hot";
    if (daysSince > 60) bucket = "churned";
    else if (daysSince > 30) bucket = "at_risk";
    else if (daysSince > 14) bucket = "watch";
    (buckets as any)[bucket]++;

    let segment = "regular";
    if (c.totalSpent >= 5000 || c.totalVisits >= 10) segment = "high_value";
    else if (c.totalVisits >= 4) segment = "frequent";
    else if (c.totalVisits === 1) segment = "new";

    // Avg interval & next-visit estimate
    const tenure = c.firstVisitDate ? daysBetween(c.firstVisitDate, c.lastVisitDate) : 0;
    const avgInterval = c.totalVisits > 1 ? tenure / (c.totalVisits - 1) : 0;
    const expectedNextVisitInDays = avgInterval > 0 ? Math.max(0, Math.round(avgInterval - daysSince)) : null;

    list.push({
      id: c.id, name: c.name, phone: c.phone, segment,
      lastVisitDate: c.lastVisitDate, daysSinceLastVisit: daysSince,
      totalVisits: c.totalVisits, totalSpent: r2(c.totalSpent),
      avgIntervalDays: r2(avgInterval),
      expectedNextVisitInDays,
      bucket,
    });
  }

  const churnList = list
    .filter(c => c.bucket === "at_risk" || c.bucket === "churned")
    .sort((a, b) => {
      const segScore: any = { high_value: 3, frequent: 2, regular: 1, new: 0 };
      return (segScore[b.segment] || 0) - (segScore[a.segment] || 0) || b.totalSpent - a.totalSpent;
    })
    .slice(0, 50);

  const watchlist = list
    .filter(c => c.bucket === "watch" && (c.segment === "high_value" || c.segment === "frequent"))
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 25);

  const dueSoon = list
    .filter(c => c.expectedNextVisitInDays !== null && c.expectedNextVisitInDays <= 3 && c.bucket !== "churned")
    .sort((a, b) => (a.expectedNextVisitInDays! - b.expectedNextVisitInDays!))
    .slice(0, 25);

  res.json({ buckets, churnList, watchlist, dueSoon });
});

// =========================== OPERATIONAL ===========================

// 7.1 Staff Efficiency (uses createdBy on invoice)
router.get("/decision/operational/staff-efficiency", authMiddleware, async (req, res): Promise<void> => {
  const { fromDate, toDate } = getRange(req, 30);
  const invoices = await db.select().from(salesInvoicesTable)
    .where(and(gte(salesInvoicesTable.salesDate, fromDate), lte(salesInvoicesTable.salesDate, toDate)));

  const users = await db.select({ id: usersTable.id, fullName: usersTable.fullName, username: usersTable.username, role: usersTable.role })
    .from(usersTable);
  const userMap = new Map(users.map(u => [u.id, u]));

  const map = new Map<number, any>();
  for (const i of invoices) {
    if (!i.createdBy) continue;
    const e = map.get(i.createdBy) || {
      userId: i.createdBy, name: userMap.get(i.createdBy)?.fullName || userMap.get(i.createdBy)?.username || `User ${i.createdBy}`,
      role: userMap.get(i.createdBy)?.role || "—",
      invoices: 0, revenue: 0, discount: 0, gross: 0,
    };
    e.invoices++;
    e.revenue += i.finalAmount;
    e.discount += i.totalDiscount;
    e.gross += i.grossAmount;
    map.set(i.createdBy, e);
  }
  const staff = [...map.values()].map(s => ({
    ...s,
    revenue: r2(s.revenue), discount: r2(s.discount), gross: r2(s.gross),
    avgBill: s.invoices > 0 ? r2(s.revenue / s.invoices) : 0,
    discountPct: s.gross > 0 ? r2((s.discount / s.gross) * 100) : 0,
  })).sort((a, b) => b.revenue - a.revenue);

  const overallDiscountPct = staff.length
    ? staff.reduce((s, x) => s + x.discount, 0) / Math.max(1, staff.reduce((s, x) => s + x.gross, 0)) * 100
    : 0;
  const flags = staff
    .filter(s => s.discountPct > overallDiscountPct + 5 && s.invoices >= 5)
    .map(s => ({ userId: s.userId, name: s.name, discountPct: s.discountPct, reason: `Discount % ${s.discountPct.toFixed(1)}% vs avg ${overallDiscountPct.toFixed(1)}%` }));

  res.json({ fromDate, toDate, staff, overallDiscountPct: r2(overallDiscountPct), flags });
});

// 7.4 Kitchen Load Analysis (uses invoiceTime + line counts)
router.get("/decision/operational/kitchen-load", authMiddleware, async (req, res): Promise<void> => {
  const { fromDate, toDate } = getRange(req, 14);
  const invoices = await db.select().from(salesInvoicesTable)
    .where(and(
      gte(salesInvoicesTable.salesDate, fromDate),
      lte(salesInvoicesTable.salesDate, toDate),
      isNotNull(salesInvoicesTable.invoiceTime),
    ));
  const invIds = invoices.map(i => i.id);
  if (invIds.length === 0) {
    res.json({ fromDate, toDate, hourly: [], peakHour: null, topLoadItems: [], avgItemsPerOrder: 0, totalOrders: 0 });
    return;
  }
  const lines = await db.select({
    invoiceId: salesInvoiceLinesTable.invoiceId,
    menuItemId: salesInvoiceLinesTable.menuItemId,
    itemName: menuItemsTable.name,
    qty: salesInvoiceLinesTable.quantity,
  }).from(salesInvoiceLinesTable)
    .leftJoin(menuItemsTable, eq(salesInvoiceLinesTable.menuItemId, menuItemsTable.id))
    .where(inArray(salesInvoiceLinesTable.invoiceId, invIds));

  const linesByInvoice = new Map<number, { count: number; qty: number }>();
  for (const l of lines) {
    const e = linesByInvoice.get(l.invoiceId) || { count: 0, qty: 0 };
    e.count++; e.qty += l.qty;
    linesByInvoice.set(l.invoiceId, e);
  }

  const hourly = new Map<number, { hour: number; orders: number; items: number; complexitySum: number }>();
  for (let h = 0; h < 24; h++) hourly.set(h, { hour: h, orders: 0, items: 0, complexitySum: 0 });
  for (const inv of invoices) {
    const h = parseInt((inv.invoiceTime || "").split(":")[0], 10);
    if (isNaN(h) || h < 0 || h > 23) continue;
    const e = hourly.get(h);
    if (!e) continue;
    const li = linesByInvoice.get(inv.id) || { count: 0, qty: 0 };
    e.orders++;
    e.items += li.qty;
    e.complexitySum += li.count;
  }
  const hourlyArr = [...hourly.values()].map(h => ({
    hour: h.hour, orders: h.orders, items: r2(h.items),
    avgItemsPerOrder: h.orders > 0 ? r2(h.items / h.orders) : 0,
    avgComplexity: h.orders > 0 ? r2(h.complexitySum / h.orders) : 0,
    loadScore: r2(h.items + h.complexitySum * 1.5),
  }));
  const withLoad = hourlyArr.filter(h => h.orders > 0);
  const peakHour = withLoad.length ? withLoad.reduce((m, x) => x.loadScore > m.loadScore ? x : m) : null;
  const totalItems = lines.reduce((s, l) => s + l.qty, 0);
  const avgItemsPerOrder = invoices.length > 0 ? r2(totalItems / invoices.length) : 0;

  // Top load-contributing items
  const itemMap = new Map<number, { menuItemId: number; itemName: string; qty: number; orders: Set<number> }>();
  for (const l of lines) {
    const e = itemMap.get(l.menuItemId) || { menuItemId: l.menuItemId, itemName: l.itemName || "—", qty: 0, orders: new Set() };
    e.qty += l.qty; e.orders.add(l.invoiceId);
    itemMap.set(l.menuItemId, e);
  }
  const topLoadItems = [...itemMap.values()]
    .map(x => ({ menuItemId: x.menuItemId, itemName: x.itemName, qty: r2(x.qty), orderCount: x.orders.size }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  res.json({ fromDate, toDate, hourly: hourlyArr, peakHour, topLoadItems, avgItemsPerOrder, totalOrders: invoices.length });
});

// =========================== INVENTORY =============================

// 8.1 Real vs Expected Consumption
router.get("/decision/inventory/consumption-variance", authMiddleware, async (req, res): Promise<void> => {
  const { fromDate, toDate } = getRange(req, 30);

  // Theoretical consumption per ingredient from sold lines × recipes
  const invoices = await db.select({ id: salesInvoicesTable.id })
    .from(salesInvoicesTable)
    .where(and(gte(salesInvoicesTable.salesDate, fromDate), lte(salesInvoicesTable.salesDate, toDate)));
  const invIds = invoices.map(i => i.id);

  const recipes = await db.select().from(recipeLinesTable);
  const recipesByItem = new Map<number, typeof recipes>();
  for (const r of recipes) {
    const arr = recipesByItem.get(r.menuItemId) || [];
    arr.push(r);
    recipesByItem.set(r.menuItemId, arr);
  }

  const theoretical = new Map<number, number>(); // ingredientId -> qty in stockUom
  if (invIds.length > 0) {
    const lines = await db.select({
      menuItemId: salesInvoiceLinesTable.menuItemId,
      qty: salesInvoiceLinesTable.quantity,
    }).from(salesInvoiceLinesTable)
      .where(inArray(salesInvoiceLinesTable.invoiceId, invIds));
    for (const l of lines) {
      const recs = recipesByItem.get(l.menuItemId) || [];
      for (const r of recs) {
        const need = r.quantity * (1 + (r.wastagePercent || 0) / 100) * l.qty;
        theoretical.set(r.ingredientId, (theoretical.get(r.ingredientId) || 0) + need);
      }
    }
  }

  // Actual from snapshots
  const snaps = await db.select({
    ingredientId: stockSnapshotsTable.ingredientId,
    consumed: sql<number>`COALESCE(SUM(${stockSnapshotsTable.consumedQty}), 0)`,
    waste: sql<number>`COALESCE(SUM(${stockSnapshotsTable.wasteQty}), 0)`,
  }).from(stockSnapshotsTable)
    .where(and(gte(stockSnapshotsTable.snapshotDate, fromDate), lte(stockSnapshotsTable.snapshotDate, toDate)))
    .groupBy(stockSnapshotsTable.ingredientId);

  const ings = await db.select().from(ingredientsTable);
  const ingMap = new Map(ings.map(i => [i.id, i]));

  const allIngIds = new Set([...theoretical.keys(), ...snaps.map(s => s.ingredientId)]);
  const rows = [...allIngIds].map(id => {
    const ing = ingMap.get(id);
    const th = theoretical.get(id) || 0;
    const snap = snaps.find(s => s.ingredientId === id);
    const actual = Number(snap?.consumed || 0);
    const wasteQ = Number(snap?.waste || 0);
    const variance = actual - th;
    const variancePct = th > 0 ? (variance / th) * 100 : (actual > 0 ? 100 : 0);
    const costPerUnit = ing ? (ing.latestCost || 0) / (ing.conversionFactor || 1) : 0;
    return {
      ingredientId: id, name: ing?.name || `Ingredient ${id}`,
      stockUom: ing?.stockUom || "—",
      theoretical: r2(th), actual: r2(actual), waste: r2(wasteQ),
      variance: r2(variance), variancePct: r2(variancePct),
      costImpact: r2(variance * costPerUnit),
    };
  });
  const significant = rows.filter(r => Math.abs(r.variancePct) >= 10 || Math.abs(r.costImpact) >= 100)
    .sort((a, b) => Math.abs(b.costImpact) - Math.abs(a.costImpact))
    .slice(0, 25);

  const totalTheoreticalCost = rows.reduce((s, r) => {
    const ing = ingMap.get(r.ingredientId);
    return s + r.theoretical * (ing ? (ing.latestCost || 0) / (ing.conversionFactor || 1) : 0);
  }, 0);
  const totalActualCost = rows.reduce((s, r) => {
    const ing = ingMap.get(r.ingredientId);
    return s + r.actual * (ing ? (ing.latestCost || 0) / (ing.conversionFactor || 1) : 0);
  }, 0);

  res.json({
    fromDate, toDate,
    summary: {
      ingredientsTracked: rows.length,
      totalTheoreticalCost: r2(totalTheoreticalCost),
      totalActualCost: r2(totalActualCost),
      totalVarianceCost: r2(totalActualCost - totalTheoreticalCost),
    },
    significant,
    note: snaps.length === 0 ? "No stock snapshots in window. Variance shown is theoretical-only." : null,
  });
});

// 8.3 Dead Stock Detection
router.get("/decision/inventory/dead-stock", authMiddleware, async (req, res): Promise<void> => {
  const days = Math.max(7, Number(req.query.days) || 30);
  const fromDate = fmtDate(addDays(new Date(), -days));
  const toDate = fmtDate(new Date());

  const ings = await db.select().from(ingredientsTable);
  const snaps = await db.select({
    ingredientId: stockSnapshotsTable.ingredientId,
    consumed: sql<number>`COALESCE(SUM(${stockSnapshotsTable.consumedQty}), 0)`,
    waste: sql<number>`COALESCE(SUM(${stockSnapshotsTable.wasteQty}), 0)`,
  }).from(stockSnapshotsTable)
    .where(and(gte(stockSnapshotsTable.snapshotDate, fromDate), lte(stockSnapshotsTable.snapshotDate, toDate)))
    .groupBy(stockSnapshotsTable.ingredientId);
  const snapMap = new Map(snaps.map(s => [s.ingredientId, s]));

  const dead: any[] = [];
  const slow: any[] = [];
  let totalBlockedValue = 0;

  for (const ing of ings) {
    if (!ing.currentStock || ing.currentStock <= 0) continue;
    const s = snapMap.get(ing.id);
    const consumed = Number(s?.consumed || 0);
    const value = (ing.currentStock || 0) * ((ing.latestCost || 0) / (ing.conversionFactor || 1));
    const turnover = consumed / Math.max(0.0001, ing.currentStock);
    const row = {
      ingredientId: ing.id, name: ing.name, code: ing.code,
      currentStock: r2(ing.currentStock), stockUom: ing.stockUom,
      consumedInWindow: r2(consumed),
      blockedValue: r2(value),
      turnoverRatio: r2(turnover),
    };
    if (consumed === 0) { dead.push(row); totalBlockedValue += value; }
    else if (turnover < 0.2) slow.push(row);
  }
  dead.sort((a, b) => b.blockedValue - a.blockedValue);
  slow.sort((a, b) => a.turnoverRatio - b.turnoverRatio);

  res.json({
    windowDays: days,
    deadCount: dead.length, slowCount: slow.length,
    totalBlockedValue: r2(totalBlockedValue),
    dead: dead.slice(0, 30), slow: slow.slice(0, 30),
  });
});

// 8.4 Cost Increase Impact
router.get("/decision/inventory/cost-impact", authMiddleware, async (req, res): Promise<void> => {
  const days = Math.max(14, Number(req.query.days) || 60);
  const cutoff = fmtDate(addDays(new Date(), -days));

  // Compare earliest vs latest purchase rate within the window per ingredient
  // (only ingredients with ≥2 purchases in the window are included)
  const lines = await db.select({
    purchaseId: purchaseLinesTable.purchaseId,
    ingredientId: purchaseLinesTable.ingredientId,
    unitRate: purchaseLinesTable.unitRate,
    qty: purchaseLinesTable.quantity,
    purchaseDate: purchasesTable.purchaseDate,
  }).from(purchaseLinesTable)
    .leftJoin(purchasesTable, eq(purchaseLinesTable.purchaseId, purchasesTable.id))
    .where(gte(purchasesTable.purchaseDate, cutoff));

  const byIng = new Map<number, any[]>();
  for (const l of lines) {
    const arr = byIng.get(l.ingredientId) || [];
    arr.push(l);
    byIng.set(l.ingredientId, arr);
  }

  const ings = await db.select().from(ingredientsTable);
  const ingMap = new Map(ings.map(i => [i.id, i]));

  const changes: any[] = [];
  for (const [ingId, arr] of byIng.entries()) {
    if (arr.length < 2) continue;
    const sorted = arr.sort((a, b) => (a.purchaseDate || "").localeCompare(b.purchaseDate || ""));
    const earliest = sorted[0];
    const latest = sorted[sorted.length - 1];
    const pct = earliest.unitRate > 0 ? ((latest.unitRate - earliest.unitRate) / earliest.unitRate) * 100 : 0;
    if (Math.abs(pct) < 5) continue;
    const ing = ingMap.get(ingId);
    changes.push({
      ingredientId: ingId, name: ing?.name || `Ingredient ${ingId}`,
      earliestRate: r2(earliest.unitRate), latestRate: r2(latest.unitRate),
      changePct: r2(pct), purchasesInWindow: arr.length,
      from: earliest.purchaseDate, to: latest.purchaseDate,
    });
  }
  changes.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

  // Find affected menu items
  const affectedIngs = new Set(changes.map(c => c.ingredientId));
  const recipes = await db.select({
    menuItemId: recipeLinesTable.menuItemId,
    ingredientId: recipeLinesTable.ingredientId,
    quantity: recipeLinesTable.quantity,
    wastagePercent: recipeLinesTable.wastagePercent,
    itemName: menuItemsTable.name,
    sellingPrice: menuItemsTable.sellingPrice,
  }).from(recipeLinesTable)
    .leftJoin(menuItemsTable, eq(recipeLinesTable.menuItemId, menuItemsTable.id));
  const affectedItems = new Map<number, any>();
  for (const r of recipes) {
    if (!affectedIngs.has(r.ingredientId)) continue;
    const c = changes.find(x => x.ingredientId === r.ingredientId);
    if (!c) continue;
    const ing = ingMap.get(r.ingredientId);
    const cf = ing?.conversionFactor || 1;
    const oldCost = r.quantity * (1 + (r.wastagePercent || 0) / 100) * (c.earliestRate / cf);
    const newCost = r.quantity * (1 + (r.wastagePercent || 0) / 100) * (c.latestRate / cf);
    const e = affectedItems.get(r.menuItemId) || {
      menuItemId: r.menuItemId, itemName: r.itemName || "—", sellingPrice: r.sellingPrice || 0,
      oldCost: 0, newCost: 0, drivers: [] as string[],
    };
    e.oldCost += oldCost; e.newCost += newCost;
    e.drivers.push(`${ing?.name} ${c.changePct > 0 ? "+" : ""}${c.changePct.toFixed(1)}%`);
    affectedItems.set(r.menuItemId, e);
  }
  const itemsImpact = [...affectedItems.values()].map(x => {
    const oldMargin = x.sellingPrice - x.oldCost;
    const newMargin = x.sellingPrice - x.newCost;
    const oldMarginPct = x.sellingPrice > 0 ? (oldMargin / x.sellingPrice) * 100 : 0;
    const newMarginPct = x.sellingPrice > 0 ? (newMargin / x.sellingPrice) * 100 : 0;
    return {
      menuItemId: x.menuItemId, itemName: x.itemName,
      sellingPrice: r2(x.sellingPrice),
      oldCost: r2(x.oldCost), newCost: r2(x.newCost),
      oldMarginPct: r2(oldMarginPct), newMarginPct: r2(newMarginPct),
      marginDropPct: r2(oldMarginPct - newMarginPct),
      drivers: x.drivers,
    };
  }).sort((a, b) => b.marginDropPct - a.marginDropPct);

  res.json({
    windowDays: days,
    note: "Compares each ingredient's earliest vs latest purchase rate within the window.",
    changes: changes.slice(0, 25),
    itemsImpact: itemsImpact.slice(0, 25),
  });
});

// =========================== FINANCIAL =============================

// 9.1 Cash vs Digital Trend
router.get("/decision/financial/payment-trend", authMiddleware, async (req, res): Promise<void> => {
  const { fromDate, toDate } = getRange(req, 30);
  const invoices = await db.select().from(salesInvoicesTable)
    .where(and(gte(salesInvoicesTable.salesDate, fromDate), lte(salesInvoicesTable.salesDate, toDate)));

  const totals = new Map<string, number>();
  const byDay = new Map<string, Map<string, number>>();
  for (const i of invoices) {
    const mode = (i.paymentMode || "other").toLowerCase();
    const cat = mode === "cash" ? "cash" : (["card", "qr", "upi", "wallet", "online"].some(k => mode.includes(k)) ? "digital" : "other");
    totals.set(cat, (totals.get(cat) || 0) + i.finalAmount);
    if (!byDay.has(i.salesDate)) byDay.set(i.salesDate, new Map());
    const m = byDay.get(i.salesDate)!;
    m.set(cat, (m.get(cat) || 0) + i.finalAmount);
  }
  const total = [...totals.values()].reduce((s, x) => s + x, 0);
  const share = ["cash", "digital", "other"].map(k => ({ mode: k, amount: r2(totals.get(k) || 0), pct: total > 0 ? r2(((totals.get(k) || 0) / total) * 100) : 0 }));
  const trend = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, m]) => ({
    date,
    cash: r2(m.get("cash") || 0),
    digital: r2(m.get("digital") || 0),
    other: r2(m.get("other") || 0),
  }));
  res.json({ fromDate, toDate, totalSales: r2(total), share, trend });
});

// 9.2 Settlement Mismatch Intelligence
router.get("/decision/financial/settlement-mismatch", authMiddleware, async (req, res): Promise<void> => {
  const { fromDate, toDate } = getRange(req, 60);
  const settlements = await db.select().from(dailySalesSettlementsTable)
    .where(and(gte(dailySalesSettlementsTable.settlementDate, fromDate), lte(dailySalesSettlementsTable.settlementDate, toDate)))
    .orderBy(desc(dailySalesSettlementsTable.settlementDate));

  const counts = { matched: 0, short: 0, excess: 0 };
  let shortSum = 0, excessSum = 0;
  for (const s of settlements) {
    counts[s.differenceType as keyof typeof counts] = (counts[s.differenceType as keyof typeof counts] || 0) + 1;
    if (s.differenceType === "short") shortSum += s.differenceAmount;
    else if (s.differenceType === "excess") excessSum += Math.abs(s.differenceAmount);
  }
  const mismatchDays = settlements
    .filter(s => s.differenceType !== "matched")
    .map(s => ({ id: s.id, settlementDate: s.settlementDate, type: s.differenceType, amount: r2(Math.abs(s.differenceAmount)), netSales: r2(s.netSalesAmount), settlement: r2(s.totalSettlementAmount), status: s.status }));

  // Cash mode mismatch trend per day (from settlement_lines + invoices)
  res.json({
    fromDate, toDate,
    counts,
    totalShort: r2(shortSum),
    totalExcess: r2(excessSum),
    mismatchDays: mismatchDays.slice(0, 30),
    mismatchRate: settlements.length > 0 ? r2(((counts.short + counts.excess) / settlements.length) * 100) : 0,
  });
});

// 9.3 Vendor Risk Insight
router.get("/decision/financial/vendor-risk", authMiddleware, async (_req, res): Promise<void> => {
  const today = fmtDate(new Date());
  const vendors = await db.select().from(vendorsTable);

  // Aggregate purchases by vendor
  const purchases = await db.select().from(purchasesTable);
  const purchaseLines = await db.select({
    purchaseId: purchaseLinesTable.purchaseId,
    ingredientId: purchaseLinesTable.ingredientId,
  }).from(purchaseLinesTable);

  const vendorAgg = new Map<number, any>();
  for (const v of vendors) {
    vendorAgg.set(v.id, {
      vendorId: v.id, name: v.name, preferred: v.preferred,
      pendingAmount: 0, overdueAmount: 0, overdueCount: 0,
      ingredientsSupplied: new Set<number>(), purchaseCount: 0,
      lastPurchaseDate: null as string | null,
    });
  }
  for (const p of purchases) {
    const e = vendorAgg.get(p.vendorId);
    if (!e) continue;
    e.pendingAmount += p.pendingAmount || 0;
    if (p.dueDate && (p.pendingAmount || 0) > 0 && p.dueDate < today) {
      e.overdueAmount += p.pendingAmount || 0;
      e.overdueCount++;
    }
    e.purchaseCount++;
    if (!e.lastPurchaseDate || p.purchaseDate > e.lastPurchaseDate) e.lastPurchaseDate = p.purchaseDate;
  }
  const purchaseToVendor = new Map(purchases.map(p => [p.id, p.vendorId]));
  for (const pl of purchaseLines) {
    const vid = purchaseToVendor.get(pl.purchaseId);
    if (!vid) continue;
    const e = vendorAgg.get(vid);
    if (e) e.ingredientsSupplied.add(pl.ingredientId);
  }

  // Single-source ingredients
  const ingToVendors = new Map<number, Set<number>>();
  for (const pl of purchaseLines) {
    const vid = purchaseToVendor.get(pl.purchaseId);
    if (!vid) continue;
    if (!ingToVendors.has(pl.ingredientId)) ingToVendors.set(pl.ingredientId, new Set());
    ingToVendors.get(pl.ingredientId)!.add(vid);
  }
  const singleSourceIngs = new Set<number>();
  for (const [ingId, set] of ingToVendors.entries()) if (set.size === 1) singleSourceIngs.add(ingId);

  const list = [...vendorAgg.values()]
    .filter(v => v.purchaseCount > 0 || v.pendingAmount > 0)
    .map(v => {
      const ingredientCount = v.ingredientsSupplied.size;
      const singleSourceCount = [...v.ingredientsSupplied].filter((i: number) => singleSourceIngs.has(i)).length;
      let riskScore = 0;
      const flags: string[] = [];
      if (v.overdueAmount > 0) { riskScore += Math.min(40, v.overdueAmount / 1000); flags.push(`Overdue ₹${r2(v.overdueAmount)}`); }
      if (singleSourceCount > 0) { riskScore += singleSourceCount * 5; flags.push(`Sole supplier of ${singleSourceCount} item(s)`); }
      if (v.lastPurchaseDate && daysBetween(v.lastPurchaseDate, today) > 60) { riskScore += 10; flags.push(`No purchase in ${daysBetween(v.lastPurchaseDate, today)} days`); }
      return {
        vendorId: v.vendorId, name: v.name, preferred: v.preferred,
        purchaseCount: v.purchaseCount, lastPurchaseDate: v.lastPurchaseDate,
        ingredientCount, singleSourceCount,
        pendingAmount: r2(v.pendingAmount), overdueAmount: r2(v.overdueAmount), overdueCount: v.overdueCount,
        riskScore: r2(riskScore), flags,
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore);

  res.json({
    totalVendors: list.length,
    overdueTotal: r2(list.reduce((s, x) => s + x.overdueAmount, 0)),
    pendingTotal: r2(list.reduce((s, x) => s + x.pendingAmount, 0)),
    singleSourceIngredients: singleSourceIngs.size,
    vendors: list,
  });
});

// 9.4 Expense Efficiency
router.get("/decision/financial/expense-efficiency", authMiddleware, async (req, res): Promise<void> => {
  const days = Math.max(14, Number(req.query.days) || 30);
  const toDate = fmtDate(new Date());
  const fromDate = fmtDate(addDays(new Date(), -(days - 1)));
  const prevTo = fmtDate(addDays(new Date(), -days));
  const prevFrom = fmtDate(addDays(new Date(), -(2 * days - 1)));

  async function rangeData(f: string, t: string) {
    const exp = await db.select({
      categoryId: expensesTable.categoryId,
      total: sql<number>`COALESCE(SUM(${expensesTable.totalAmount}), 0)`,
    }).from(expensesTable)
      .where(and(gte(expensesTable.expenseDate, f), lte(expensesTable.expenseDate, t)))
      .groupBy(expensesTable.categoryId);
    const sales = await db.select({
      sum: sql<number>`COALESCE(SUM(${salesInvoicesTable.finalAmount}), 0)`,
    }).from(salesInvoicesTable)
      .where(and(gte(salesInvoicesTable.salesDate, f), lte(salesInvoicesTable.salesDate, t)));
    return { exp, sales: Number(sales[0]?.sum || 0) };
  }
  const cur = await rangeData(fromDate, toDate);
  const prev = await rangeData(prevFrom, prevTo);

  const curMap = new Map(cur.exp.map(e => [e.categoryId, Number(e.total) || 0]));
  const prevMap = new Map(prev.exp.map(e => [e.categoryId, Number(e.total) || 0]));
  const allCats = new Set([...curMap.keys(), ...prevMap.keys()]);
  const cats = [...allCats].map(id => {
    const c = curMap.get(id) || 0;
    const p = prevMap.get(id) || 0;
    const growthPct = p > 0 ? ((c - p) / p) * 100 : (c > 0 ? 100 : 0);
    return { categoryId: id, current: r2(c), previous: r2(p), growthPct: r2(growthPct) };
  }).sort((a, b) => b.current - a.current);

  // Add category names
  const catIds = cats.map(c => c.categoryId).filter((x): x is number => x != null);
  const cnames = catIds.length ? await db.execute<{ id: number; name: string }>(sql`select id, name from categories where id in (${sql.join(catIds.map(i => sql`${i}`), sql`, `)})`) : { rows: [] as any[] };
  const cmap = new Map((cnames as any).rows?.map((r: any) => [r.id, r.name]) || []);
  for (const c of cats) (c as any).categoryName = (cmap.get(c.categoryId as number) || "Uncategorized");

  const totalCur = cats.reduce((s, c) => s + c.current, 0);
  const totalPrev = cats.reduce((s, c) => s + c.previous, 0);
  const salesGrowth = prev.sales > 0 ? ((cur.sales - prev.sales) / prev.sales) * 100 : 0;
  const expGrowth = totalPrev > 0 ? ((totalCur - totalPrev) / totalPrev) * 100 : 0;

  const inefficiencies = cats.filter(c => c.growthPct >= 20 && c.current >= 1000).slice(0, 10);

  res.json({
    fromDate, toDate, prevFrom, prevTo,
    sales: { current: r2(cur.sales), previous: r2(prev.sales), growthPct: r2(salesGrowth) },
    expenses: { current: r2(totalCur), previous: r2(totalPrev), growthPct: r2(expGrowth) },
    expenseToSalesPct: cur.sales > 0 ? r2((totalCur / cur.sales) * 100) : 0,
    cats,
    inefficiencies,
    flag: expGrowth - salesGrowth >= 10
      ? `Expenses grew ${r2(expGrowth)}% vs sales ${r2(salesGrowth)}% — efficiency declining.`
      : null,
  });
});

// =========================== PREDICTIVE ============================

// 11.1 Predictive Sales — moving avg + same-weekday adjustment
router.get("/decision/predictive/sales", authMiddleware, async (_req, res): Promise<void> => {
  const today = new Date();
  const fromDate = fmtDate(addDays(today, -28));
  const toDate = fmtDate(today);

  const invoices = await db.select({
    salesDate: salesInvoicesTable.salesDate,
    finalAmount: salesInvoicesTable.finalAmount,
  }).from(salesInvoicesTable)
    .where(and(gte(salesInvoicesTable.salesDate, fromDate), lte(salesInvoicesTable.salesDate, toDate)));

  const byDay = new Map<string, number>();
  for (const i of invoices) byDay.set(i.salesDate, (byDay.get(i.salesDate) || 0) + i.finalAmount);

  const series: { date: string; sales: number; dow: number }[] = [];
  for (let d = 0; d < 28; d++) {
    const date = fmtDate(addDays(today, -27 + d));
    series.push({ date, sales: byDay.get(date) || 0, dow: new Date(date).getDay() });
  }
  const last7 = series.slice(-7);
  const ma7 = last7.reduce((s, x) => s + x.sales, 0) / 7;

  // Tomorrow forecast
  const tomorrow = addDays(today, 1);
  const tomorrowDow = tomorrow.getDay();
  const sameDow = series.filter(s => s.dow === tomorrowDow && s.sales > 0);
  const dowAvg = sameDow.length ? sameDow.reduce((s, x) => s + x.sales, 0) / sameDow.length : ma7;
  const forecastTomorrow = (ma7 * 0.4) + (dowAvg * 0.6);

  // Trend
  const firstHalf = series.slice(0, 14).reduce((s, x) => s + x.sales, 0) / 14;
  const secondHalf = series.slice(-14).reduce((s, x) => s + x.sales, 0) / 14;
  const trendPct = firstHalf > 0 ? ((secondHalf - firstHalf) / firstHalf) * 100 : 0;
  const trendDirection = trendPct >= 5 ? "up" : trendPct <= -5 ? "down" : "stable";

  // Confidence: based on data density + variance
  const nonZero = series.filter(s => s.sales > 0).length;
  const mean = series.reduce((s, x) => s + x.sales, 0) / series.length;
  const variance = series.reduce((s, x) => s + Math.pow(x.sales - mean, 2), 0) / series.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
  let confidence = "low";
  if (nonZero >= 14 && cv < 0.5) confidence = "high";
  else if (nonZero >= 7 && cv < 0.8) confidence = "medium";

  // Next 7 days
  const next7: any[] = [];
  let weekTotal = 0;
  for (let d = 1; d <= 7; d++) {
    const fd = addDays(today, d);
    const dw = fd.getDay();
    const dwSeries = series.filter(s => s.dow === dw && s.sales > 0);
    const fAvg = dwSeries.length ? dwSeries.reduce((s, x) => s + x.sales, 0) / dwSeries.length : ma7;
    const f = r2((ma7 * 0.4) + (fAvg * 0.6));
    next7.push({ date: fmtDate(fd), forecast: f, dow: dw });
    weekTotal += f;
  }

  res.json({
    last28Days: series.map(s => ({ date: s.date, sales: r2(s.sales) })),
    movingAvg7: r2(ma7),
    forecastTomorrow: r2(forecastTomorrow),
    weekForecast: r2(weekTotal),
    next7Days: next7,
    trendPct: r2(trendPct), trendDirection,
    confidence,
    dataPoints: nonZero,
  });
});

// 11.2 Demand Forecasting (ingredient requirement based on predictive sales)
router.get("/decision/predictive/demand", authMiddleware, async (_req, res): Promise<void> => {
  const today = new Date();
  const fromDate = fmtDate(addDays(today, -14));
  const toDate = fmtDate(today);

  // Avg daily item sales (last 14 days)
  const invoices = await db.select({ id: salesInvoicesTable.id })
    .from(salesInvoicesTable)
    .where(and(gte(salesInvoicesTable.salesDate, fromDate), lte(salesInvoicesTable.salesDate, toDate)));
  const invIds = invoices.map(i => i.id);
  if (invIds.length === 0) {
    res.json({ topIngredients: [], shortfalls: [], note: "No sales in last 14 days for demand forecast." });
    return;
  }
  const lines = await db.select({
    menuItemId: salesInvoiceLinesTable.menuItemId,
    qty: salesInvoiceLinesTable.quantity,
  }).from(salesInvoiceLinesTable)
    .where(inArray(salesInvoiceLinesTable.invoiceId, invIds));

  const itemDailyAvg = new Map<number, number>();
  for (const l of lines) itemDailyAvg.set(l.menuItemId, (itemDailyAvg.get(l.menuItemId) || 0) + l.qty);
  for (const [k, v] of itemDailyAvg.entries()) itemDailyAvg.set(k, v / 14);

  const recipes = await db.select().from(recipeLinesTable);
  const ings = await db.select().from(ingredientsTable);
  const ingMap = new Map(ings.map(i => [i.id, i]));

  // Predicted ingredient need for tomorrow (1 day)
  const ingNeed = new Map<number, number>();
  for (const r of recipes) {
    const itemAvg = itemDailyAvg.get(r.menuItemId) || 0;
    if (itemAvg <= 0) continue;
    const need = r.quantity * (1 + (r.wastagePercent || 0) / 100) * itemAvg;
    ingNeed.set(r.ingredientId, (ingNeed.get(r.ingredientId) || 0) + need);
  }

  const top = [...ingNeed.entries()].map(([id, need]) => {
    const ing = ingMap.get(id);
    const tomorrowNeed = need;
    const weekNeed = need * 7;
    const stock = ing?.currentStock || 0;
    const daysUntilStockOut = need > 0 ? stock / need : 999;
    return {
      ingredientId: id, name: ing?.name || `Ingredient ${id}`,
      stockUom: ing?.stockUom || "—",
      currentStock: r2(stock),
      reorderLevel: r2(ing?.reorderLevel || 0),
      tomorrowNeed: r2(tomorrowNeed),
      weekNeed: r2(weekNeed),
      daysOfStock: r2(daysUntilStockOut),
      shortfall: r2(Math.max(0, weekNeed - stock)),
    };
  }).sort((a, b) => b.weekNeed - a.weekNeed);

  const shortfalls = top.filter(x => x.daysOfStock < 7 || (x.reorderLevel > 0 && x.currentStock < x.reorderLevel))
    .sort((a, b) => a.daysOfStock - b.daysOfStock);

  res.json({ topIngredients: top.slice(0, 25), shortfalls: shortfalls.slice(0, 25) });
});

// ============================== ALERTS =============================

router.get("/decision/alerts", authMiddleware, async (_req, res): Promise<void> => {
  const today = fmtDate(new Date());
  const last30 = fmtDate(addDays(new Date(), -30));
  const last7 = fmtDate(addDays(new Date(), -7));
  const alerts: { id: string; severity: "critical" | "warning" | "info"; category: string; title: string; detail: string; link?: string }[] = [];

  // Low stock
  const lowStock = await db.select().from(ingredientsTable)
    .where(sql`${ingredientsTable.currentStock} <= ${ingredientsTable.reorderLevel} AND ${ingredientsTable.reorderLevel} > 0`);
  for (const i of lowStock.slice(0, 20)) {
    alerts.push({
      id: `low-stock-${i.id}`, severity: i.currentStock <= 0 ? "critical" : "warning",
      category: "Inventory", title: `Low stock: ${i.name}`,
      detail: `Stock ${r2(i.currentStock)} ${i.stockUom} (reorder at ${r2(i.reorderLevel)})`,
      link: "/inventory",
    });
  }

  // High waste in last 30d
  const wasteSum = await db.select({
    sum: sql<number>`COALESCE(SUM(${wasteEntriesTable.costValue}), 0)`,
  }).from(wasteEntriesTable)
    .where(and(gte(wasteEntriesTable.wasteDate, last30), lte(wasteEntriesTable.wasteDate, today)));
  const wasteCost = Number(wasteSum[0]?.sum || 0);
  if (wasteCost > 5000) {
    alerts.push({
      id: "high-waste", severity: wasteCost > 20000 ? "critical" : "warning",
      category: "Inventory", title: "High wastage in last 30 days",
      detail: `Total waste cost: ₹${r2(wasteCost)}`, link: "/waste",
    });
  }

  // Overdue vendor payments
  const overdue = await db.select().from(purchasesTable)
    .where(and(sql`${purchasesTable.pendingAmount} > 0`, sql`${purchasesTable.dueDate} < ${today}`));
  if (overdue.length > 0) {
    const tot = overdue.reduce((s, p) => s + (p.pendingAmount || 0), 0);
    alerts.push({
      id: "vendor-overdue", severity: tot > 50000 ? "critical" : "warning",
      category: "Financial", title: `${overdue.length} overdue purchase(s)`,
      detail: `Total overdue ₹${r2(tot)}`, link: "/purchases",
    });
  }

  // Repeated settlement mismatches
  const stl = await db.select().from(dailySalesSettlementsTable)
    .where(gte(dailySalesSettlementsTable.settlementDate, last30));
  const mismatchN = stl.filter(s => s.differenceType !== "matched").length;
  if (mismatchN >= 3) {
    alerts.push({
      id: "settlement-mismatch", severity: mismatchN >= 7 ? "critical" : "warning",
      category: "Financial", title: `${mismatchN} settlement mismatches in 30 days`,
      detail: `Investigate cash handling.`, link: "/settlements",
    });
  }

  // Lapsed high-value customers (no visit > 30d, totalSpent >= 5000)
  const customers = await db.select().from(customersTable);
  const lapsedHV = customers.filter(c => c.lastVisitDate && c.totalSpent >= 5000 && daysBetween(c.lastVisitDate, today) > 30);
  if (lapsedHV.length > 0) {
    alerts.push({
      id: "lapsed-hv-customers", severity: "warning", category: "Customer",
      title: `${lapsedHV.length} high-value customer(s) inactive >30 days`,
      detail: `Top: ${lapsedHV.sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 3).map(c => c.name).join(", ")}`,
      link: "/customers",
    });
  }

  // Sales drop (last 7d vs prev 7d)
  const r1 = await db.select({ sum: sql<number>`COALESCE(SUM(${salesInvoicesTable.finalAmount}), 0)` })
    .from(salesInvoicesTable)
    .where(and(gte(salesInvoicesTable.salesDate, last7), lte(salesInvoicesTable.salesDate, today)));
  const r2sum = await db.select({ sum: sql<number>`COALESCE(SUM(${salesInvoicesTable.finalAmount}), 0)` })
    .from(salesInvoicesTable)
    .where(and(gte(salesInvoicesTable.salesDate, fmtDate(addDays(new Date(), -14))), lte(salesInvoicesTable.salesDate, fmtDate(addDays(new Date(), -7)))));
  const cur = Number(r1[0]?.sum || 0); const prv = Number(r2sum[0]?.sum || 0);
  if (prv > 0 && cur < prv * 0.7) {
    alerts.push({
      id: "sales-drop", severity: "critical", category: "Revenue",
      title: "Sharp sales drop detected",
      detail: `Last 7d: ₹${r2(cur)} vs prev 7d: ₹${r2(prv)} (${r2(((cur - prv) / prv) * 100)}%)`,
      link: "/insights",
    });
  }

  // High discount usage
  const recentInv = await db.select().from(salesInvoicesTable).where(gte(salesInvoicesTable.salesDate, last7));
  const totalGr = recentInv.reduce((s, i) => s + (i.grossAmount || 0), 0);
  const totalDc = recentInv.reduce((s, i) => s + (i.totalDiscount || 0), 0);
  const dcPct = totalGr > 0 ? (totalDc / totalGr) * 100 : 0;
  if (dcPct > 15) {
    alerts.push({
      id: "high-discount", severity: dcPct > 25 ? "critical" : "warning", category: "Revenue",
      title: "Unusually high discount activity",
      detail: `Discount ratio ${r2(dcPct)}% of gross sales (last 7 days)`,
      link: "/decision",
    });
  }

  alerts.sort((a, b) => {
    const order: any = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });

  res.json({
    counts: {
      critical: alerts.filter(a => a.severity === "critical").length,
      warning: alerts.filter(a => a.severity === "warning").length,
      info: alerts.filter(a => a.severity === "info").length,
    },
    alerts,
  });
});

export default router;
