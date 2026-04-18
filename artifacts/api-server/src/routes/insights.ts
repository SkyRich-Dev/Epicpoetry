import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql, isNotNull, desc } from "drizzle-orm";
import {
  db, salesInvoicesTable, salesInvoiceLinesTable, menuItemsTable, customersTable, categoriesTable,
} from "@workspace/db";
import { authMiddleware, managerOrAdmin } from "../lib/auth";

const router: IRouter = Router();

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

async function summaryForRange(fromDate: string, toDate: string) {
  const invoices = await db.select().from(salesInvoicesTable)
    .where(and(gte(salesInvoicesTable.salesDate, fromDate), lte(salesInvoicesTable.salesDate, toDate)));
  const totalSales = invoices.reduce((s, i) => s + i.finalAmount, 0);
  const totalInvoices = invoices.length;
  const uniqueCustomers = new Set(invoices.filter(i => i.customerId).map(i => i.customerId)).size;
  const walkInCount = invoices.filter(i => !i.customerId).length;
  const customerCount = uniqueCustomers + walkInCount;
  return {
    fromDate, toDate, totalSales: Math.round(totalSales * 100) / 100, totalInvoices,
    totalCustomers: customerCount, identifiedCustomers: uniqueCustomers,
    avgBill: totalInvoices > 0 ? Math.round((totalSales / totalInvoices) * 100) / 100 : 0,
  };
}

router.get("/insights/summary", authMiddleware, async (req, res): Promise<void> => {
  const fromDate = (req.query.fromDate as string) || fmtDate(addDays(new Date(), -30));
  const toDate = (req.query.toDate as string) || fmtDate(new Date());
  const data = await summaryForRange(fromDate, toDate);
  res.json(data);
});

router.get("/insights/comparisons", authMiddleware, async (_req, res): Promise<void> => {
  const today = new Date();
  const tStr = fmtDate(today);
  const ystr = fmtDate(addDays(today, -1));
  const sameDayLastWeek = fmtDate(addDays(today, -7));

  const todayD = await summaryForRange(tStr, tStr);
  const yest = await summaryForRange(ystr, ystr);
  const lastWeekDay = await summaryForRange(sameDayLastWeek, sameDayLastWeek);

  const weekStart = fmtDate(addDays(today, -6));
  const prevWeekStart = fmtDate(addDays(today, -13));
  const prevWeekEnd = fmtDate(addDays(today, -7));
  const thisWeek = await summaryForRange(weekStart, tStr);
  const lastWeek = await summaryForRange(prevWeekStart, prevWeekEnd);

  const monthStart = fmtDate(addDays(today, -29));
  const prevMonthStart = fmtDate(addDays(today, -59));
  const prevMonthEnd = fmtDate(addDays(today, -30));
  const thisMonth = await summaryForRange(monthStart, tStr);
  const lastMonth = await summaryForRange(prevMonthStart, prevMonthEnd);

  function pct(curr: number, prev: number) {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 1000) / 10;
  }

  res.json({
    todayVsYesterday: {
      current: todayD, previous: yest,
      salesGrowthPct: pct(todayD.totalSales, yest.totalSales),
      customerGrowthPct: pct(todayD.totalCustomers, yest.totalCustomers),
    },
    todayVsSameDayLastWeek: {
      current: todayD, previous: lastWeekDay,
      salesGrowthPct: pct(todayD.totalSales, lastWeekDay.totalSales),
    },
    weekVsLastWeek: {
      current: thisWeek, previous: lastWeek,
      salesGrowthPct: pct(thisWeek.totalSales, lastWeek.totalSales),
      customerGrowthPct: pct(thisWeek.totalCustomers, lastWeek.totalCustomers),
    },
    monthVsLastMonth: {
      current: thisMonth, previous: lastMonth,
      salesGrowthPct: pct(thisMonth.totalSales, lastMonth.totalSales),
      customerGrowthPct: pct(thisMonth.totalCustomers, lastMonth.totalCustomers),
    },
  });
});

router.get("/insights/peak-hours", authMiddleware, async (req, res): Promise<void> => {
  const fromDate = (req.query.fromDate as string) || fmtDate(addDays(new Date(), -30));
  const toDate = (req.query.toDate as string) || fmtDate(new Date());
  const invoices = await db.select().from(salesInvoicesTable)
    .where(and(gte(salesInvoicesTable.salesDate, fromDate), lte(salesInvoicesTable.salesDate, toDate)));

  const hourMap = new Map<number, { hour: number; visits: number; sales: number }>();
  for (let h = 0; h < 24; h++) hourMap.set(h, { hour: h, visits: 0, sales: 0 });
  for (const inv of invoices) {
    if (!inv.invoiceTime) continue;
    const h = parseInt(inv.invoiceTime.split(":")[0], 10);
    if (isNaN(h) || h < 0 || h > 23) continue;
    const e = hourMap.get(h);
    if (!e) continue;
    e.visits++;
    e.sales += inv.finalAmount;
  }
  const arr = [...hourMap.values()].map(h => ({ ...h, sales: Math.round(h.sales * 100) / 100 }));
  const withVisits = arr.filter(a => a.visits > 0);
  const peak = withVisits.length ? withVisits.reduce((m, x) => x.visits > m.visits ? x : m) : null;
  const least = withVisits.length ? withVisits.reduce((m, x) => x.visits < m.visits ? x : m) : null;
  res.json({ hours: arr, peakHour: peak?.hour ?? null, leastHour: least?.hour ?? null });
});

router.get("/insights/daily-trend", authMiddleware, async (req, res): Promise<void> => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 180);
  const fromDate = fmtDate(addDays(new Date(), -(days - 1)));
  const toDate = fmtDate(new Date());

  const invoices = await db.select().from(salesInvoicesTable)
    .where(and(gte(salesInvoicesTable.salesDate, fromDate), lte(salesInvoicesTable.salesDate, toDate)));

  const dayMap = new Map<string, { date: string; sales: number; invoices: number; customers: Set<any> }>();
  for (let i = 0; i < days; i++) {
    const d = fmtDate(addDays(new Date(fromDate), i));
    dayMap.set(d, { date: d, sales: 0, invoices: 0, customers: new Set() });
  }
  for (const inv of invoices) {
    const e = dayMap.get(inv.salesDate);
    if (!e) continue;
    e.sales += inv.finalAmount;
    e.invoices++;
    e.customers.add(inv.customerId || `walkin-${inv.id}`);
  }
  const series = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)).map(d => ({
    date: d.date, sales: Math.round(d.sales * 100) / 100, invoices: d.invoices, customers: d.customers.size,
  }));
  res.json(series);
});

router.get("/insights/repeat-vs-new", authMiddleware, async (req, res): Promise<void> => {
  const fromDate = (req.query.fromDate as string) || fmtDate(addDays(new Date(), -30));
  const toDate = (req.query.toDate as string) || fmtDate(new Date());

  const invoices = await db.select().from(salesInvoicesTable)
    .where(and(gte(salesInvoicesTable.salesDate, fromDate), lte(salesInvoicesTable.salesDate, toDate), isNotNull(salesInvoicesTable.customerId)));

  const customerIds = [...new Set(invoices.map(i => i.customerId!))];
  if (customerIds.length === 0) { res.json({ newCount: 0, repeatCount: 0, walkIns: 0, totalIdentified: 0 }); return; }

  const custs = await db.select().from(customersTable)
    .where(sql`${customersTable.id} IN (${sql.join(customerIds.map(i => sql`${i}`), sql`, `)})`);

  let newCount = 0, repeatCount = 0;
  for (const c of custs) {
    if (c.firstVisitDate && c.firstVisitDate >= fromDate && c.firstVisitDate <= toDate) newCount++;
    else repeatCount++;
  }
  const walkInInvoices = await db.select({ count: sql<number>`count(*)::int` }).from(salesInvoicesTable)
    .where(and(gte(salesInvoicesTable.salesDate, fromDate), lte(salesInvoicesTable.salesDate, toDate), sql`${salesInvoicesTable.customerId} IS NULL`));

  res.json({
    newCount, repeatCount, walkIns: walkInInvoices[0]?.count || 0,
    totalIdentified: custs.length,
    repeatPct: custs.length > 0 ? Math.round((repeatCount / custs.length) * 1000) / 10 : 0,
    newPct: custs.length > 0 ? Math.round((newCount / custs.length) * 1000) / 10 : 0,
  });
});

router.get("/insights/top-items", authMiddleware, async (req, res): Promise<void> => {
  const fromDate = (req.query.fromDate as string) || fmtDate(addDays(new Date(), -30));
  const toDate = (req.query.toDate as string) || fmtDate(new Date());
  const limit = Math.min(Number(req.query.limit) || 10, 50);

  const invoices = await db.select({ id: salesInvoicesTable.id }).from(salesInvoicesTable)
    .where(and(gte(salesInvoicesTable.salesDate, fromDate), lte(salesInvoicesTable.salesDate, toDate)));
  if (invoices.length === 0) { res.json({ top: [], bottom: [] }); return; }
  const ids = invoices.map(i => i.id);

  const lines = await db.select({
    menuItemId: salesInvoiceLinesTable.menuItemId,
    name: menuItemsTable.name,
    quantity: salesInvoiceLinesTable.quantity,
    finalLineAmount: salesInvoiceLinesTable.finalLineAmount,
  }).from(salesInvoiceLinesTable)
    .leftJoin(menuItemsTable, eq(salesInvoiceLinesTable.menuItemId, menuItemsTable.id))
    .where(sql`${salesInvoiceLinesTable.invoiceId} IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`);

  const map = new Map<number, { itemId: number; itemName: string; qty: number; sales: number }>();
  for (const l of lines) {
    const e = map.get(l.menuItemId);
    if (e) { e.qty += l.quantity; e.sales += l.finalLineAmount; }
    else map.set(l.menuItemId, { itemId: l.menuItemId, itemName: l.name || "—", qty: l.quantity, sales: l.finalLineAmount });
  }
  const all = [...map.values()].map(i => ({ ...i, qty: Math.round(i.qty * 100) / 100, sales: Math.round(i.sales * 100) / 100 }));
  const top = [...all].sort((a, b) => b.qty - a.qty).slice(0, limit);
  const bottom = [...all].sort((a, b) => a.qty - b.qty).slice(0, limit);
  res.json({ top, bottom });
});

router.get("/insights/segmentation", authMiddleware, async (_req, res): Promise<void> => {
  const all = await db.select().from(customersTable);
  const today = new Date();
  const counts = { high_value: 0, frequent: 0, regular: 0, new: 0, inactive: 0 };

  for (const c of all) {
    const recency = c.lastVisitDate ? Math.floor((today.getTime() - new Date(c.lastVisitDate).getTime()) / (1000 * 60 * 60 * 24)) : 9999;
    if (c.totalVisits === 0) counts.new++;
    else if (c.totalSpent >= 5000 || c.totalVisits >= 10) counts.high_value++;
    else if (recency > 60) counts.inactive++;
    else if (c.totalVisits >= 4) counts.frequent++;
    else if (c.totalVisits === 1) counts.new++;
    else counts.regular++;
  }
  res.json({ total: all.length, ...counts });
});

router.get("/insights/category-mix", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  const fromDate = (req.query.fromDate as string) || fmtDate(addDays(new Date(), -30));
  const toDate = (req.query.toDate as string) || fmtDate(new Date());
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

  const invoices = await db.select({ id: salesInvoicesTable.id }).from(salesInvoicesTable)
    .where(and(gte(salesInvoicesTable.salesDate, fromDate), lte(salesInvoicesTable.salesDate, toDate)));
  if (invoices.length === 0) { res.json([]); return; }
  const ids = invoices.map(i => i.id);

  const lines = await db.select({
    categoryId: menuItemsTable.categoryId,
    categoryName: categoriesTable.name,
    quantity: salesInvoiceLinesTable.quantity,
    finalLineAmount: salesInvoiceLinesTable.finalLineAmount,
  }).from(salesInvoiceLinesTable)
    .leftJoin(menuItemsTable, eq(salesInvoiceLinesTable.menuItemId, menuItemsTable.id))
    .leftJoin(categoriesTable, eq(menuItemsTable.categoryId, categoriesTable.id))
    .where(sql`${salesInvoiceLinesTable.invoiceId} IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`);

  const map = new Map<string, { categoryId: number | null; name: string; revenue: number; units: number; count: number }>();
  for (const l of lines) {
    const key = l.categoryId == null ? "uncat" : String(l.categoryId);
    const e = map.get(key);
    if (e) { e.revenue += l.finalLineAmount; e.units += l.quantity; e.count += l.quantity; }
    else map.set(key, {
      categoryId: l.categoryId ?? null,
      name: l.categoryName ?? "Uncategorized",
      revenue: l.finalLineAmount,
      units: l.quantity,
      count: l.quantity,
    });
  }
  const totalRev = [...map.values()].reduce((s, x) => s + x.revenue, 0);
  const result = [...map.values()]
    .map(x => ({
      categoryId: x.categoryId,
      name: x.name,
      category: x.name,
      revenue: Math.round(x.revenue * 100) / 100,
      value: Math.round(x.revenue * 100) / 100,
      units: Math.round(x.units * 100) / 100,
      count: Math.round(x.units * 100) / 100,
      sharePct: totalRev > 0 ? Math.round((x.revenue / totalRev) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
  res.json(result);
});

router.get("/insights/day-of-week", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  const days = Math.min(Math.max(Number(req.query.days) || 90, 7), 365);
  const fromDate = (req.query.fromDate as string) || fmtDate(addDays(new Date(), -(days - 1)));
  const toDate = (req.query.toDate as string) || fmtDate(new Date());

  const invoices = await db.select().from(salesInvoicesTable)
    .where(and(gte(salesInvoicesTable.salesDate, fromDate), lte(salesInvoicesTable.salesDate, toDate)));

  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const buckets = names.map((n, idx) => ({ dayOfWeek: idx, name: n, label: n, revenue: 0, count: 0, invoices: 0 }));
  for (const inv of invoices) {
    const dow = new Date(`${inv.salesDate}T00:00:00`).getDay();
    if (isNaN(dow)) continue;
    const b = buckets[dow];
    b.revenue += Number(inv.finalAmount) || 0;
    b.count += 1;
    b.invoices += 1;
  }
  const result = buckets.map(b => ({
    ...b,
    revenue: Math.round(b.revenue * 100) / 100,
  }));
  // Reorder Mon..Sun for nicer display
  const ordered = [1, 2, 3, 4, 5, 6, 0].map(i => result[i]);
  res.json(ordered);
});

export default router;
