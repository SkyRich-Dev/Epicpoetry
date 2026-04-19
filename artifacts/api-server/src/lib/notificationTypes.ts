import { db, ingredientsTable, salesEntriesTable, wasteEntriesTable, vendorLedgerTable, vendorsTable, dailySalesSettlementsTable, settlementLinesTable, expensesTable } from "@workspace/db";
import { gte, lte, and, eq, desc, sql } from "drizzle-orm";

export interface AlertTypeDef {
  type: string;
  label: string;
  description: string;
  defaultThreshold?: Record<string, number | string>;
}

export const ALERT_TYPES: AlertTypeDef[] = [
  { type: "low_stock", label: "Low stock alert", description: "Lists ingredients at or below their reorder level." },
  { type: "daily_sales_summary", label: "Daily sales summary", description: "Yesterday's total sales, transactions, and average ticket." },
  { type: "revenue_leak", label: "Revenue leak (waste %)", description: "Triggers when waste cost exceeds threshold % of sales over the last N days.", defaultThreshold: { wastePercent: 5, lookbackDays: 7 } },
  { type: "vendor_payments_due", label: "Vendor payments due", description: "Outstanding vendor balances due for payment." },
  { type: "daily_collection", label: "Daily collection / settlement", description: "Yesterday's settlement breakdown by payment mode." },
  { type: "weekly_pnl", label: "Weekly P&L", description: "Last 7 days revenue, expenses, gross profit." },
];

export const SCHEDULES = [
  { id: "every_15_min", label: "Every 15 minutes", intervalMs: 15 * 60 * 1000 },
  { id: "hourly", label: "Hourly", intervalMs: 60 * 60 * 1000 },
  { id: "daily_morning", label: "Daily at 8:00 AM", cron: { hour: 8, minute: 0 } },
  { id: "daily_evening", label: "Daily at 8:00 PM", cron: { hour: 20, minute: 0 } },
  { id: "weekly_monday", label: "Weekly (Mon 8 AM)", cron: { hour: 8, minute: 0, dow: 1 } },
] as const;

type ScheduleId = typeof SCHEDULES[number]["id"];

export function isValidSchedule(s: string): s is ScheduleId {
  return SCHEDULES.some((x) => x.id === s);
}

export function isValidType(t: string): boolean {
  return ALERT_TYPES.some((x) => x.type === t);
}

/** Compute whether a schedule is "due" given the lastRun timestamp and now. */
export function isDue(schedule: string, lastRun: Date | null, now: Date = new Date()): boolean {
  const def = SCHEDULES.find((x) => x.id === schedule);
  if (!def) return false;
  if ("intervalMs" in def && def.intervalMs) {
    if (!lastRun) return true;
    return now.getTime() - lastRun.getTime() >= def.intervalMs;
  }
  if ("cron" in def && def.cron) {
    const { hour, minute, dow } = def.cron as { hour: number; minute: number; dow?: number };
    // Match the firing minute window (within 60s).
    if (now.getHours() !== hour) return false;
    if (now.getMinutes() !== minute) return false;
    if (dow !== undefined && now.getDay() !== dow) return false;
    if (lastRun && now.getTime() - lastRun.getTime() < 90 * 1000) return false;
    return true;
  }
  return false;
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
}

function dateRange(daysBack: number) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setDate(start.getDate() - daysBack);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function yesterdayRange() {
  const start = new Date();
  start.setDate(start.getDate() - 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export interface AlertContent {
  subject: string;
  html: string;
  text: string;
  hasData: boolean;
}

const wrap = (title: string, body: string) => `
<div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:0 auto;color:#2A323B">
  <div style="background:#E8722C;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0">
    <div style="font-size:12px;letter-spacing:1px;opacity:.85">PLATR · ALERT</div>
    <div style="font-size:20px;font-weight:700;margin-top:2px">${title}</div>
  </div>
  <div style="background:#F8F5EE;padding:20px;border-radius:0 0 10px 10px;border:1px solid #eadfc8;border-top:none">
    ${body}
    <div style="margin-top:24px;font-size:11px;color:#888;text-align:center">Powered by SkyRich</div>
  </div>
</div>`;

export async function buildAlertContent(type: string, threshold?: Record<string, number | string> | null): Promise<AlertContent> {
  switch (type) {
    case "low_stock": {
      const items = await db.select().from(ingredientsTable);
      const low = items.filter((i) => Number(i.currentStock) <= Number(i.reorderLevel));
      const hasData = low.length > 0;
      const rows = low.map((i) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eadfc8">${i.name}</td><td style="padding:6px 10px;border-bottom:1px solid #eadfc8;text-align:right">${i.currentStock}</td><td style="padding:6px 10px;border-bottom:1px solid #eadfc8;text-align:right">${i.reorderLevel}</td></tr>`).join("");
      const html = wrap("Low Stock Alert", hasData
        ? `<p>The following items are at or below their reorder level:</p><table style="width:100%;border-collapse:collapse;background:#fff;border-radius:6px;overflow:hidden"><thead><tr style="background:#2A323B;color:#fff"><th style="padding:8px 10px;text-align:left">Item</th><th style="padding:8px 10px;text-align:right">Current</th><th style="padding:8px 10px;text-align:right">Reorder</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<p>All ingredients are above their reorder levels. No action needed.</p>`);
      const text = hasData ? `Low stock items:\n${low.map((i) => `- ${i.name}: ${i.currentStock} (reorder ${i.reorderLevel})`).join("\n")}` : "All stock above reorder level.";
      return { subject: hasData ? `[Platr] ${low.length} item(s) at/below reorder level` : "[Platr] Stock OK", html, text, hasData };
    }
    case "daily_sales_summary": {
      const { start, end } = yesterdayRange();
      const rows = await db.select().from(salesEntriesTable).where(and(gte(salesEntriesTable.salesDate, start.toISOString().slice(0, 10)), lte(salesEntriesTable.salesDate, end.toISOString().slice(0, 10))));
      const total = rows.reduce((s, r) => s + Number(r.totalAmount || 0), 0);
      const txns = rows.length;
      const avg = txns ? total / txns : 0;
      const html = wrap("Daily Sales Summary", `<p>Sales for <b>${start.toDateString()}</b>:</p><ul><li>Total revenue: <b>${fmtMoney(total)}</b></li><li>Transactions: <b>${txns}</b></li><li>Avg ticket: <b>${fmtMoney(avg)}</b></li></ul>`);
      const text = `Sales ${start.toDateString()}: ${fmtMoney(total)} across ${txns} transactions (avg ${fmtMoney(avg)}).`;
      return { subject: `[Platr] Sales ${start.toDateString()}: ${fmtMoney(total)}`, html, text, hasData: true };
    }
    case "revenue_leak": {
      const lookback = Number(threshold?.lookbackDays ?? 7);
      const wastePct = Number(threshold?.wastePercent ?? 5);
      const { start, end } = dateRange(lookback);
      const sales = await db.select().from(salesEntriesTable).where(and(gte(salesEntriesTable.salesDate, start.toISOString().slice(0, 10)), lte(salesEntriesTable.salesDate, end.toISOString().slice(0, 10))));
      const wastes = await db.select().from(wasteEntriesTable).where(and(gte(wasteEntriesTable.wasteDate, start.toISOString().slice(0, 10)), lte(wasteEntriesTable.wasteDate, end.toISOString().slice(0, 10))));
      const salesTotal = sales.reduce((s, r) => s + Number(r.totalAmount || 0), 0);
      const wasteCost = wastes.reduce((s, r) => s + Number(r.costValue || 0), 0);
      const pct = salesTotal > 0 ? (wasteCost / salesTotal) * 100 : 0;
      const breach = pct >= wastePct;
      const html = wrap("Revenue Leak Check", `<p>Last <b>${lookback}</b> days:</p><ul><li>Sales: <b>${fmtMoney(salesTotal)}</b></li><li>Waste cost: <b>${fmtMoney(wasteCost)}</b></li><li>Waste %: <b style="color:${breach ? "#c00" : "#2A323B"}">${pct.toFixed(2)}%</b> (threshold ${wastePct}%)</li></ul>${breach ? "<p style='color:#c00'><b>Threshold breached.</b> Review recent waste entries.</p>" : "<p>Within threshold.</p>"}`);
      const text = `Last ${lookback}d sales ${fmtMoney(salesTotal)}, waste ${fmtMoney(wasteCost)} (${pct.toFixed(2)}%, threshold ${wastePct}%)`;
      return { subject: breach ? `[Platr] Revenue leak: waste ${pct.toFixed(1)}% > ${wastePct}%` : `[Platr] Waste % within threshold (${pct.toFixed(1)}%)`, html, text, hasData: breach };
    }
    case "vendor_payments_due": {
      // Outstanding = vendors whose latest ledger running balance > 0 (debit balance owed to vendor).
      const ledger = await db.select().from(vendorLedgerTable).orderBy(desc(vendorLedgerTable.id));
      const latestByVendor = new Map<number, number>();
      for (const row of ledger) {
        if (!latestByVendor.has(row.vendorId)) latestByVendor.set(row.vendorId, Number(row.runningBalance || 0));
      }
      const vendors = await db.select().from(vendorsTable);
      const vendorName = new Map(vendors.map((v) => [v.id, v.name] as const));
      const due = [...latestByVendor.entries()].filter(([_, bal]) => bal > 0.01).map(([vid, bal]) => ({ vendorId: vid, balance: bal, name: vendorName.get(vid) ?? `Vendor #${vid}` }));
      const total = due.reduce((s, p) => s + p.balance, 0);
      const rows = due.slice(0, 50).map((p) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eadfc8">${p.name}</td><td style="padding:6px 10px;border-bottom:1px solid #eadfc8;text-align:right">${fmtMoney(p.balance)}</td></tr>`).join("");
      const html = wrap("Vendor Payments Due", due.length
        ? `<p><b>${due.length}</b> vendor(s) with outstanding balance totalling <b>${fmtMoney(total)}</b>.</p><table style="width:100%;border-collapse:collapse;background:#fff;border-radius:6px;overflow:hidden"><thead><tr style="background:#2A323B;color:#fff"><th style="padding:8px 10px;text-align:left">Vendor</th><th style="padding:8px 10px;text-align:right">Balance</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<p>No outstanding vendor balances.</p>`);
      const text = `${due.length} vendors owed ${fmtMoney(total)}.`;
      return { subject: due.length ? `[Platr] ${due.length} vendor(s) with balance (${fmtMoney(total)})` : "[Platr] No vendor balances due", html, text, hasData: due.length > 0 };
    }
    case "daily_collection": {
      const { start } = yesterdayRange();
      const dateStr = start.toISOString().slice(0, 10);
      const settlements = await db.select().from(dailySalesSettlementsTable).where(eq(dailySalesSettlementsTable.settlementDate, dateStr));
      const settlementIds = settlements.map((s) => s.id);
      const lines = settlementIds.length
        ? await db.select().from(settlementLinesTable).where(sql`${settlementLinesTable.settlementId} = ANY(${settlementIds})`)
        : [];
      const byMode: Record<string, number> = {};
      for (const r of lines) {
        const mode = r.paymentMode ?? "other";
        byMode[mode] = (byMode[mode] ?? 0) + Number(r.amount ?? 0);
      }
      const total = Object.values(byMode).reduce((a, b) => a + b, 0);
      const list = Object.entries(byMode).map(([m, a]) => `<li>${m}: <b>${fmtMoney(a)}</b></li>`).join("");
      const html = wrap("Daily Collection", `<p>Collections for <b>${start.toDateString()}</b>:</p>${list ? `<ul>${list}</ul>` : "<p>No settlements recorded.</p>"}<p>Total: <b>${fmtMoney(total)}</b></p>`);
      return { subject: `[Platr] Collection ${start.toDateString()}: ${fmtMoney(total)}`, html, text: `Collection ${start.toDateString()}: ${fmtMoney(total)}`, hasData: true };
    }
    case "weekly_pnl": {
      const { start, end } = dateRange(7);
      const sales = await db.select().from(salesEntriesTable).where(and(gte(salesEntriesTable.salesDate, start.toISOString().slice(0, 10)), lte(salesEntriesTable.salesDate, end.toISOString().slice(0, 10))));
      const expenses = await db.select().from(expensesTable).where(and(gte(expensesTable.expenseDate, start.toISOString().slice(0, 10)), lte(expensesTable.expenseDate, end.toISOString().slice(0, 10))));
      const revenue = sales.reduce((s, r) => s + Number(r.totalAmount || 0), 0);
      const expTotal = expenses.reduce((s, r) => s + Number(r.totalAmount || 0), 0);
      const profit = revenue - expTotal;
      const html = wrap("Weekly P&L", `<p>Last 7 days:</p><ul><li>Revenue: <b>${fmtMoney(revenue)}</b></li><li>Expenses: <b>${fmtMoney(expTotal)}</b></li><li>Net: <b style="color:${profit >= 0 ? "#0a7d2a" : "#c00"}">${fmtMoney(profit)}</b></li></ul>`);
      return { subject: `[Platr] Weekly P&L: ${fmtMoney(profit)}`, html, text: `Weekly P&L revenue ${fmtMoney(revenue)} expenses ${fmtMoney(expTotal)} net ${fmtMoney(profit)}.`, hasData: true };
    }
  }
  return { subject: "[Platr] Unknown alert", html: wrap("Unknown alert", `<p>Unknown alert type: ${type}</p>`), text: `Unknown alert type ${type}`, hasData: false };
}
