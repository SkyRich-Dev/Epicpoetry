import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, gte, lte, sql, desc, isNotNull } from "drizzle-orm";
import {
  db,
  purchasesTable, purchaseLinesTable,
  expensesTable,
  wasteEntriesTable,
  ingredientsTable,
  vendorsTable,
  menuItemsTable, recipeLinesTable,
  salesInvoicesTable, salesInvoiceLinesTable,
  customersTable,
  vendorPaymentsTable,
  dailySalesSettlementsTable, settlementLinesTable,
  stockSnapshotsTable, stockAdjustmentsTable,
  pettyCashLedgerTable,
  employeesTable, attendanceTable, leavesTable, salaryRecordsTable, salaryAdvancesTable, salaryAdjustmentsTable,
  auditLogsTable,
  trialsTable, trialVersionsTable,
  categoriesTable,
  systemConfigTable,
} from "@workspace/db";
import { authMiddleware, adminOnly, requirePermission } from "../lib/auth";
import { getEffectivePermissionsForRole } from "./roles";
import { normalizePaymentMode } from "../lib/paymentMode";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

const router: IRouter = Router();

// ---------- Helpers ----------
function getToday(): string { return new Date().toISOString().split("T")[0]; }
function isValidDate(s?: string): boolean { return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function todayMinus(days: number): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}
function monthStart(ref: string): string { const [y,m] = ref.split("-"); return `${y}-${m}-01`; }
function monthEnd(ref: string): string {
  const [y,m] = ref.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2,"0")}-${String(last).padStart(2,"0")}`;
}
function fmtMoney(n: number): string { return `₹${(Math.round((n||0) * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

// ---------- Report Result Types ----------
type ColType = "text" | "number" | "currency" | "date" | "percent";
interface ReportColumn { key: string; label: string; type?: ColType; width?: number }
interface ReportResult { title: string; columns: ReportColumn[]; rows: any[]; summary?: Array<{ label: string; value: string | number }>; subtitle?: string }
interface ReportFilters { from: string; to: string; [k: string]: any }
interface ReportDef {
  key: string; title: string; category: string; adminOnly?: boolean;
  filters?: Array<{ key: string; label: string; type: "select" | "text"; optionsEndpoint?: string }>;
  fetch(filters: ReportFilters): Promise<ReportResult>;
}

function fmtCellForDisplay(v: any, type?: ColType): string {
  if (v === null || v === undefined || v === "") return "";
  if (type === "currency") return fmtMoney(Number(v));
  if (type === "percent") return `${Number(v).toFixed(2)}%`;
  if (type === "number") return Number(v).toLocaleString("en-IN");
  return String(v);
}

async function generateXlsx(result: ReportResult, period: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Epic Poetry Cafe";
  wb.created = new Date();
  const ws = wb.addWorksheet("Report");

  // Title rows
  ws.mergeCells(1, 1, 1, Math.max(result.columns.length, 1));
  const titleCell = ws.getCell("A1");
  titleCell.value = "Epic Poetry Cafe";
  titleCell.font = { bold: true, size: 16, color: { argb: "FF6750A4" } };
  titleCell.alignment = { horizontal: "center" };

  ws.mergeCells(2, 1, 2, Math.max(result.columns.length, 1));
  const subCell = ws.getCell("A2");
  subCell.value = result.title;
  subCell.font = { bold: true, size: 13 };
  subCell.alignment = { horizontal: "center" };

  ws.mergeCells(3, 1, 3, Math.max(result.columns.length, 1));
  const periodCell = ws.getCell("A3");
  periodCell.value = `${period}    Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;
  periodCell.font = { italic: true, size: 10, color: { argb: "FF666666" } };
  periodCell.alignment = { horizontal: "center" };

  // Header row
  const headerRow = ws.addRow([]);
  headerRow.values = result.columns.map(c => c.label);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.alignment = { vertical: "middle", horizontal: "left" };
  headerRow.eachCell(cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6750A4" } };
    cell.border = { top: {style:"thin"}, left: {style:"thin"}, right: {style:"thin"}, bottom: {style:"thin"} };
  });

  // Data rows
  for (const row of result.rows) {
    const r = ws.addRow(result.columns.map(c => row[c.key] ?? ""));
    r.eachCell((cell, colNum) => {
      const col = result.columns[colNum - 1];
      if (col.type === "currency") cell.numFmt = '"₹"#,##0.00';
      else if (col.type === "number") cell.numFmt = '#,##0.##';
      else if (col.type === "percent") cell.numFmt = '0.00"%"';
      cell.border = { top: {style:"hair"}, left: {style:"hair"}, right: {style:"hair"}, bottom: {style:"hair"} };
    });
  }

  // Auto width
  result.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? Math.max(c.label.length + 4, 14);
  });

  // Summary
  if (result.summary && result.summary.length > 0) {
    ws.addRow([]);
    const sHeader = ws.addRow(["Summary"]);
    sHeader.font = { bold: true, size: 12 };
    for (const item of result.summary) {
      const r = ws.addRow([item.label, item.value]);
      r.getCell(1).font = { bold: true };
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function generatePdf(result: ReportResult, period: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 30 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc.fontSize(18).fillColor("#6750A4").text("Epic Poetry Cafe", { align: "center" });
    doc.moveDown(0.2);
    doc.fontSize(13).fillColor("#222").text(result.title, { align: "center" });
    doc.fontSize(9).fillColor("#666").text(`${period}    Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`, { align: "center" });
    doc.moveDown(0.6);

    const pageW = doc.page.width - 60;
    const cols = result.columns;
    const colWidths = cols.map(c => Math.max(c.width ? c.width * 6 : 60, 50));
    const totalW = colWidths.reduce((a, b) => a + b, 0);
    if (totalW > pageW) {
      const scale = pageW / totalW;
      for (let i = 0; i < colWidths.length; i++) colWidths[i] = colWidths[i] * scale;
    }

    const rowH = 18;
    let y = doc.y;

    function drawHeader() {
      doc.rect(30, y, pageW, rowH).fill("#6750A4");
      let x = 30;
      doc.fillColor("#fff").fontSize(9).font("Helvetica-Bold");
      cols.forEach((c, i) => {
        doc.text(c.label, x + 4, y + 5, { width: colWidths[i] - 8, ellipsis: true });
        x += colWidths[i];
      });
      y += rowH;
      doc.fillColor("#000").font("Helvetica");
    }
    drawHeader();

    for (const row of result.rows) {
      if (y > doc.page.height - 60) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 30 });
        y = 40; drawHeader();
      }
      let x = 30;
      doc.fontSize(8);
      cols.forEach((c, i) => {
        const val = fmtCellForDisplay(row[c.key], c.type);
        doc.fillColor("#000").text(val, x + 4, y + 5, { width: colWidths[i] - 8, ellipsis: true, lineBreak: false });
        x += colWidths[i];
      });
      doc.strokeColor("#e6e6e6").moveTo(30, y + rowH).lineTo(30 + pageW, y + rowH).stroke();
      y += rowH;
    }

    if (result.summary && result.summary.length > 0) {
      if (y > doc.page.height - 100) { doc.addPage({ size: "A4", layout: "landscape", margin: 30 }); y = 40; }
      y += 10;
      doc.fontSize(11).fillColor("#6750A4").font("Helvetica-Bold").text("Summary", 30, y);
      y += 18;
      doc.font("Helvetica").fillColor("#000").fontSize(10);
      for (const s of result.summary) {
        doc.text(`${s.label}:  ${typeof s.value === "number" ? s.value.toLocaleString("en-IN") : s.value}`, 30, y);
        y += 14;
      }
    }

    doc.end();
  });
}

// ---------- REPORT REGISTRY ----------
const REPORTS: ReportDef[] = [];
function R(def: ReportDef) { REPORTS.push(def); }

// ============== SALES ==============
R({ key: "daily-sales-summary", title: "Daily Sales Summary", category: "Sales",
  fetch: async ({ from, to }) => {
    const inv = await db.select().from(salesInvoicesTable)
      .where(and(gte(salesInvoicesTable.salesDate, from), lte(salesInvoicesTable.salesDate, to)));
    const byDay = new Map<string, any>();
    for (const i of inv) {
      const d = byDay.get(i.salesDate) || { date: i.salesDate, invoiceCount: 0, gross: 0, discount: 0, gst: 0, net: 0, cash: 0, upi: 0, card: 0, other: 0 };
      d.invoiceCount++;
      d.gross += i.grossAmount; d.discount += i.totalDiscount; d.gst += i.gstAmount; d.net += i.finalAmount;
      const m = (i.paymentMode || "other").toLowerCase();
      if (m === "cash") d.cash += i.finalAmount;
      else if (m === "upi") d.upi += i.finalAmount;
      else if (m === "card") d.card += i.finalAmount;
      else d.other += i.finalAmount;
      byDay.set(i.salesDate, d);
    }
    const rows = Array.from(byDay.values()).sort((a,b) => a.date.localeCompare(b.date));
    const tot = rows.reduce((acc, r) => ({
      invoiceCount: acc.invoiceCount + r.invoiceCount, gross: acc.gross + r.gross, discount: acc.discount + r.discount,
      gst: acc.gst + r.gst, net: acc.net + r.net, cash: acc.cash + r.cash, upi: acc.upi + r.upi, card: acc.card + r.card, other: acc.other + r.other,
    }), { invoiceCount: 0, gross: 0, discount: 0, gst: 0, net: 0, cash: 0, upi: 0, card: 0, other: 0 });
    return {
      title: "Daily Sales Summary",
      columns: [
        { key: "date", label: "Date", type: "date", width: 12 },
        { key: "invoiceCount", label: "Invoices", type: "number", width: 10 },
        { key: "gross", label: "Gross", type: "currency", width: 14 },
        { key: "discount", label: "Discount", type: "currency", width: 12 },
        { key: "gst", label: "GST", type: "currency", width: 12 },
        { key: "net", label: "Net", type: "currency", width: 14 },
        { key: "cash", label: "Cash", type: "currency", width: 12 },
        { key: "upi", label: "UPI", type: "currency", width: 12 },
        { key: "card", label: "Card", type: "currency", width: 12 },
        { key: "other", label: "Other", type: "currency", width: 12 },
      ],
      rows,
      summary: [
        { label: "Total Invoices", value: tot.invoiceCount },
        { label: "Gross Sales", value: fmtMoney(tot.gross) },
        { label: "Total Discount", value: fmtMoney(tot.discount) },
        { label: "Total GST", value: fmtMoney(tot.gst) },
        { label: "Net Sales", value: fmtMoney(tot.net) },
        { label: "Cash / UPI / Card / Other", value: `${fmtMoney(tot.cash)} / ${fmtMoney(tot.upi)} / ${fmtMoney(tot.card)} / ${fmtMoney(tot.other)}` },
      ],
    };
  }
});

R({ key: "sales-by-item", title: "Sales by Item", category: "Sales",
  fetch: async ({ from, to }) => {
    const inv = await db.select({ id: salesInvoicesTable.id }).from(salesInvoicesTable)
      .where(and(gte(salesInvoicesTable.salesDate, from), lte(salesInvoicesTable.salesDate, to)));
    if (inv.length === 0) return { title: "Sales by Item", columns: [], rows: [] };
    const ids = inv.map(i => i.id);
    const lines = await db.select({
      menuItemId: salesInvoiceLinesTable.menuItemId,
      itemName: salesInvoiceLinesTable.itemNameSnapshot,
      qty: salesInvoiceLinesTable.quantity,
      gross: salesInvoiceLinesTable.grossLineAmount,
      discount: salesInvoiceLinesTable.lineDiscountAmount,
      net: salesInvoiceLinesTable.finalLineAmount,
    }).from(salesInvoiceLinesTable).where(sql`${salesInvoiceLinesTable.invoiceId} IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)})`);
    // Fall back to live menu_items.name when the snapshot was never written
    // (older rows) so the report is never blank or "Unknown".
    const itemIds = Array.from(new Set(lines.map(l => l.menuItemId).filter((x): x is number => !!x)));
    const itemNameMap = new Map<number, string>();
    if (itemIds.length > 0) {
      const items = await db.select({ id: menuItemsTable.id, name: menuItemsTable.name })
        .from(menuItemsTable)
        .where(sql`${menuItemsTable.id} IN (${sql.join(itemIds.map(id => sql`${id}`), sql`,`)})`);
      for (const it of items) itemNameMap.set(it.id, it.name);
    }
    const m = new Map<string, any>();
    for (const l of lines) {
      const name = l.itemName || (l.menuItemId ? itemNameMap.get(l.menuItemId) : null) || "Unknown";
      const key = `${l.menuItemId || 0}::${name}`;
      const e = m.get(key) || { itemName: name, qty: 0, gross: 0, discount: 0, net: 0 };
      e.qty += l.qty; e.gross += l.gross; e.discount += l.discount; e.net += l.net;
      m.set(key, e);
    }
    const totalRev = Array.from(m.values()).reduce((s, r) => s + r.net, 0);
    const rows = Array.from(m.values()).map(r => ({ ...r, share: totalRev > 0 ? (r.net / totalRev) * 100 : 0 })).sort((a,b) => b.net - a.net);
    return {
      title: "Sales by Item",
      columns: [
        { key: "itemName", label: "Item", type: "text", width: 30 },
        { key: "qty", label: "Qty Sold", type: "number" },
        { key: "gross", label: "Gross", type: "currency" },
        { key: "discount", label: "Discount", type: "currency" },
        { key: "net", label: "Net Revenue", type: "currency" },
        { key: "share", label: "Revenue Share %", type: "percent" },
      ],
      rows,
      summary: [
        { label: "Items Sold (unique)", value: rows.length },
        { label: "Total Quantity", value: rows.reduce((s,r)=>s+r.qty,0).toFixed(2) },
        { label: "Total Net Revenue", value: fmtMoney(totalRev) },
      ],
    };
  }
});

R({ key: "sales-by-category", title: "Sales by Category", category: "Sales",
  fetch: async ({ from, to }) => {
    const inv = await db.select({ id: salesInvoicesTable.id }).from(salesInvoicesTable)
      .where(and(gte(salesInvoicesTable.salesDate, from), lte(salesInvoicesTable.salesDate, to)));
    if (inv.length === 0) return { title: "Sales by Category", columns: [], rows: [] };
    const ids = inv.map(i => i.id);
    const lines = await db.select({
      menuItemId: salesInvoiceLinesTable.menuItemId,
      qty: salesInvoiceLinesTable.quantity,
      net: salesInvoiceLinesTable.finalLineAmount,
    }).from(salesInvoiceLinesTable).where(sql`${salesInvoiceLinesTable.invoiceId} IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)})`);
    const items = await db.select().from(menuItemsTable);
    const cats = await db.select().from(categoriesTable);
    const itemMap = new Map(items.map(i => [i.id, i]));
    const catMap = new Map(cats.map(c => [c.id, c.name]));
    const m = new Map<string, any>();
    for (const l of lines) {
      const it = l.menuItemId ? itemMap.get(l.menuItemId) : null;
      const catName = it?.categoryId ? catMap.get(it.categoryId) || "Uncategorized" : "Uncategorized";
      const e = m.get(catName) || { category: catName, qty: 0, net: 0, items: new Set<number>() };
      e.qty += l.qty; e.net += l.net;
      if (l.menuItemId) e.items.add(l.menuItemId);
      m.set(catName, e);
    }
    const totalRev = Array.from(m.values()).reduce((s, r) => s + r.net, 0);
    const rows = Array.from(m.values()).map(r => ({
      category: r.category, uniqueItems: r.items.size, qty: r.qty, net: r.net,
      share: totalRev > 0 ? (r.net / totalRev) * 100 : 0,
    })).sort((a,b) => b.net - a.net);
    return {
      title: "Sales by Category",
      columns: [
        { key: "category", label: "Category", type: "text", width: 24 },
        { key: "uniqueItems", label: "Unique Items", type: "number" },
        { key: "qty", label: "Qty Sold", type: "number" },
        { key: "net", label: "Net Revenue", type: "currency" },
        { key: "share", label: "Share %", type: "percent" },
      ],
      rows,
      summary: [{ label: "Total Net Revenue", value: fmtMoney(totalRev) }],
    };
  }
});

R({ key: "sales-by-payment-mode", title: "Sales by Payment Mode", category: "Sales",
  fetch: async ({ from, to }) => {
    const inv = await db.select().from(salesInvoicesTable)
      .where(and(gte(salesInvoicesTable.salesDate, from), lte(salesInvoicesTable.salesDate, to)));
    const m = new Map<string, any>();
    for (const i of inv) {
      const k = normalizePaymentMode(i.paymentMode);
      const e = m.get(k) || { paymentMode: k, invoiceCount: 0, net: 0 };
      e.invoiceCount++; e.net += i.finalAmount;
      m.set(k, e);
    }
    const total = Array.from(m.values()).reduce((s,r) => s + r.net, 0);
    const rows = Array.from(m.values()).map(r => ({ ...r, share: total > 0 ? (r.net / total) * 100 : 0 })).sort((a,b) => b.net - a.net);
    return {
      title: "Sales by Payment Mode",
      columns: [
        { key: "paymentMode", label: "Payment Mode", type: "text", width: 18 },
        { key: "invoiceCount", label: "Invoices", type: "number" },
        { key: "net", label: "Net Amount", type: "currency" },
        { key: "share", label: "Share %", type: "percent" },
      ],
      rows,
      summary: [{ label: "Total", value: fmtMoney(total) }],
    };
  }
});

R({ key: "sales-hour-day", title: "Sales by Hour & Day-of-Week", category: "Sales",
  fetch: async ({ from, to }) => {
    const inv = await db.select().from(salesInvoicesTable)
      .where(and(gte(salesInvoicesTable.salesDate, from), lte(salesInvoicesTable.salesDate, to)));
    const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const m = new Map<string, any>();
    for (const i of inv) {
      const d = new Date(i.createdAt);
      const dayName = days[d.getUTCDay()];
      const hr = d.getUTCHours();
      const k = `${dayName}-${hr}`;
      const e = m.get(k) || { day: dayName, hour: hr, invoices: 0, net: 0 };
      e.invoices++; e.net += i.finalAmount;
      m.set(k, e);
    }
    const rows = Array.from(m.values()).sort((a,b) => days.indexOf(a.day) - days.indexOf(b.day) || a.hour - b.hour);
    return {
      title: "Sales by Hour & Day-of-Week",
      columns: [
        { key: "day", label: "Day", type: "text", width: 8 },
        { key: "hour", label: "Hour", type: "number" },
        { key: "invoices", label: "Invoices", type: "number" },
        { key: "net", label: "Net Sales", type: "currency" },
      ],
      rows,
      summary: [{ label: "Total Invoices", value: inv.length }, { label: "Total Net Sales", value: fmtMoney(inv.reduce((s,i)=>s+i.finalAmount,0)) }],
    };
  }
});

R({ key: "discount-report", title: "Discount Report", category: "Sales",
  fetch: async ({ from, to }) => {
    const inv = await db.select().from(salesInvoicesTable)
      .where(and(gte(salesInvoicesTable.salesDate, from), lte(salesInvoicesTable.salesDate, to)));
    const rows = inv.filter(i => (i.totalDiscount || 0) > 0).map(i => ({
      date: i.salesDate, invoiceNo: i.invoiceNo, customer: i.customerName || "—",
      gross: i.grossAmount, discount: i.totalDiscount, net: i.finalAmount,
      discountPct: i.grossAmount > 0 ? (i.totalDiscount / i.grossAmount) * 100 : 0,
    })).sort((a,b) => b.discount - a.discount);
    const totDisc = rows.reduce((s,r) => s + r.discount, 0);
    return {
      title: "Discount Report",
      columns: [
        { key: "date", label: "Date", type: "date" },
        { key: "invoiceNo", label: "Invoice #", type: "text" },
        { key: "customer", label: "Customer", type: "text", width: 22 },
        { key: "gross", label: "Gross", type: "currency" },
        { key: "discount", label: "Discount", type: "currency" },
        { key: "discountPct", label: "Disc %", type: "percent" },
        { key: "net", label: "Net", type: "currency" },
      ],
      rows,
      summary: [
        { label: "Discounted Invoices", value: rows.length },
        { label: "Total Discount Given", value: fmtMoney(totDisc) },
      ],
    };
  }
});

R({ key: "gst-output", title: "GST Output (Sales)", category: "Sales",
  fetch: async ({ from, to }) => {
    const inv = await db.select().from(salesInvoicesTable)
      .where(and(gte(salesInvoicesTable.salesDate, from), lte(salesInvoicesTable.salesDate, to)));
    const m = new Map<string, any>();
    for (const i of inv) {
      const month = i.salesDate.substring(0, 7);
      const e = m.get(month) || { month, taxable: 0, gst: 0, total: 0 };
      e.taxable += i.taxableAmount; e.gst += i.gstAmount; e.total += i.finalAmount;
      m.set(month, e);
    }
    const rows = Array.from(m.values()).sort((a,b) => a.month.localeCompare(b.month));
    return {
      title: "GST Output (Sales)",
      columns: [
        { key: "month", label: "Month", type: "text", width: 12 },
        { key: "taxable", label: "Taxable Value", type: "currency" },
        { key: "gst", label: "GST Output", type: "currency" },
        { key: "total", label: "Invoice Total", type: "currency" },
      ],
      rows,
      summary: [{ label: "Total GST Output", value: fmtMoney(rows.reduce((s,r) => s + r.gst, 0)) }],
    };
  }
});

R({ key: "settlement-reconciliation", title: "Settlement Reconciliation", category: "Sales",
  fetch: async ({ from, to }) => {
    const s = await db.select().from(dailySalesSettlementsTable)
      .where(and(gte(dailySalesSettlementsTable.settlementDate, from), lte(dailySalesSettlementsTable.settlementDate, to)));
    const rows = s.map(x => ({
      date: x.settlementDate, gross: x.grossSalesAmount, net: x.netSalesAmount, settled: x.totalSettlementAmount,
      diff: x.differenceAmount, status: x.status,
    })).sort((a,b) => a.date.localeCompare(b.date));
    return {
      title: "Settlement Reconciliation",
      columns: [
        { key: "date", label: "Date", type: "date" },
        { key: "gross", label: "Gross Sales", type: "currency" },
        { key: "net", label: "Net Sales", type: "currency" },
        { key: "settled", label: "Settled", type: "currency" },
        { key: "diff", label: "Difference", type: "currency" },
        { key: "status", label: "Status", type: "text" },
      ],
      rows,
      summary: [
        { label: "Total Net Sales", value: fmtMoney(rows.reduce((s,r) => s + r.net, 0)) },
        { label: "Total Settled", value: fmtMoney(rows.reduce((s,r) => s + r.settled, 0)) },
        { label: "Net Difference", value: fmtMoney(rows.reduce((s,r) => s + r.diff, 0)) },
      ],
    };
  }
});

R({ key: "top-bottom-items", title: "Top / Bottom Items", category: "Sales",
  fetch: async ({ from, to }) => {
    const inv = await db.select({ id: salesInvoicesTable.id }).from(salesInvoicesTable)
      .where(and(gte(salesInvoicesTable.salesDate, from), lte(salesInvoicesTable.salesDate, to)));
    if (inv.length === 0) return { title: "Top / Bottom Items", columns: [], rows: [] };
    const ids = inv.map(i => i.id);
    const lines = await db.select({
      menuItemId: salesInvoiceLinesTable.menuItemId,
      itemName: salesInvoiceLinesTable.itemNameSnapshot,
      qty: salesInvoiceLinesTable.quantity,
      net: salesInvoiceLinesTable.finalLineAmount,
    }).from(salesInvoiceLinesTable).where(sql`${salesInvoiceLinesTable.invoiceId} IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)})`);
    const itemIds = Array.from(new Set(lines.map(l => l.menuItemId).filter((x): x is number => !!x)));
    const itemNameMap = new Map<number, string>();
    if (itemIds.length > 0) {
      const items = await db.select({ id: menuItemsTable.id, name: menuItemsTable.name })
        .from(menuItemsTable)
        .where(sql`${menuItemsTable.id} IN (${sql.join(itemIds.map(id => sql`${id}`), sql`,`)})`);
      for (const it of items) itemNameMap.set(it.id, it.name);
    }
    const m = new Map<string, any>();
    for (const l of lines) {
      const k = l.itemName || (l.menuItemId ? itemNameMap.get(l.menuItemId) : null) || "Unknown";
      const e = m.get(k) || { itemName: k, qty: 0, net: 0 };
      e.qty += l.qty; e.net += l.net;
      m.set(k, e);
    }
    const all = Array.from(m.values()).sort((a,b) => b.net - a.net);
    const top = all.slice(0, 10).map(r => ({ rank: "TOP", ...r }));
    const bottom = all.slice(-10).reverse().map(r => ({ rank: "BOTTOM", ...r }));
    return {
      title: "Top / Bottom 10 Items by Net Revenue",
      columns: [
        { key: "rank", label: "Bucket", type: "text", width: 10 },
        { key: "itemName", label: "Item", type: "text", width: 30 },
        { key: "qty", label: "Qty", type: "number" },
        { key: "net", label: "Net Revenue", type: "currency" },
      ],
      rows: [...top, ...bottom],
      summary: [{ label: "Total Items Sold", value: all.length }],
    };
  }
});

R({ key: "customer-sales", title: "Customer-wise Sales", category: "Sales",
  fetch: async ({ from, to }) => {
    const inv = await db.select().from(salesInvoicesTable)
      .where(and(gte(salesInvoicesTable.salesDate, from), lte(salesInvoicesTable.salesDate, to)));
    const m = new Map<string, any>();
    for (const i of inv) {
      const k = i.customerName || "Walk-in / Unknown";
      const e = m.get(k) || { customer: k, phone: i.customerPhone || "", visits: 0, gross: 0, net: 0 };
      e.visits++; e.gross += i.grossAmount; e.net += i.finalAmount;
      m.set(k, e);
    }
    const rows = Array.from(m.values()).sort((a,b) => b.net - a.net);
    return {
      title: "Customer-wise Sales",
      columns: [
        { key: "customer", label: "Customer", type: "text", width: 24 },
        { key: "phone", label: "Phone", type: "text", width: 14 },
        { key: "visits", label: "Visits", type: "number" },
        { key: "gross", label: "Gross", type: "currency" },
        { key: "net", label: "Net Spend", type: "currency" },
      ],
      rows,
      summary: [{ label: "Customers", value: rows.length }, { label: "Total Net", value: fmtMoney(rows.reduce((s,r) => s + r.net, 0)) }],
    };
  }
});

// ============== PURCHASE ==============
R({ key: "purchase-register", title: "Purchase Register", category: "Purchase",
  fetch: async ({ from, to }) => {
    const rows = await db.select({
      date: purchasesTable.purchaseDate, purchaseNo: purchasesTable.purchaseNumber,
      invoiceNo: purchasesTable.invoiceNumber, vendor: vendorsTable.name,
      total: purchasesTable.totalAmount, paid: purchasesTable.paidAmount, pending: purchasesTable.pendingAmount,
      status: purchasesTable.paymentStatus,
    }).from(purchasesTable).leftJoin(vendorsTable, eq(purchasesTable.vendorId, vendorsTable.id))
      .where(and(gte(purchasesTable.purchaseDate, from), lte(purchasesTable.purchaseDate, to)))
      .orderBy(purchasesTable.purchaseDate);
    return {
      title: "Purchase Register",
      columns: [
        { key: "date", label: "Date", type: "date" },
        { key: "purchaseNo", label: "Purchase #", type: "text" },
        { key: "invoiceNo", label: "Invoice #", type: "text" },
        { key: "vendor", label: "Vendor", type: "text", width: 22 },
        { key: "total", label: "Total", type: "currency" },
        { key: "paid", label: "Paid", type: "currency" },
        { key: "pending", label: "Pending", type: "currency" },
        { key: "status", label: "Status", type: "text" },
      ],
      rows,
      summary: [
        { label: "Total Purchases", value: rows.length },
        { label: "Total Value", value: fmtMoney(rows.reduce((s,r)=>s+(r.total||0),0)) },
        { label: "Total Pending", value: fmtMoney(rows.reduce((s,r)=>s+(r.pending||0),0)) },
      ],
    };
  }
});

R({ key: "purchase-by-vendor", title: "Purchase by Vendor", category: "Purchase",
  fetch: async ({ from, to }) => {
    const data = await db.select({
      vendor: vendorsTable.name, total: purchasesTable.totalAmount, paid: purchasesTable.paidAmount, pending: purchasesTable.pendingAmount,
    }).from(purchasesTable).leftJoin(vendorsTable, eq(purchasesTable.vendorId, vendorsTable.id))
      .where(and(gte(purchasesTable.purchaseDate, from), lte(purchasesTable.purchaseDate, to)));
    const m = new Map<string, any>();
    for (const d of data) {
      const k = d.vendor || "Unknown";
      const e = m.get(k) || { vendor: k, count: 0, total: 0, paid: 0, pending: 0 };
      e.count++; e.total += d.total || 0; e.paid += d.paid || 0; e.pending += d.pending || 0;
      m.set(k, e);
    }
    const rows = Array.from(m.values()).sort((a,b) => b.total - a.total);
    return {
      title: "Purchase by Vendor",
      columns: [
        { key: "vendor", label: "Vendor", type: "text", width: 24 },
        { key: "count", label: "# Purchases", type: "number" },
        { key: "total", label: "Total", type: "currency" },
        { key: "paid", label: "Paid", type: "currency" },
        { key: "pending", label: "Pending", type: "currency" },
      ],
      rows,
    };
  }
});

R({ key: "purchase-by-ingredient", title: "Purchase by Ingredient", category: "Purchase",
  fetch: async ({ from, to }) => {
    const purchases = await db.select({ id: purchasesTable.id, date: purchasesTable.purchaseDate }).from(purchasesTable)
      .where(and(gte(purchasesTable.purchaseDate, from), lte(purchasesTable.purchaseDate, to)));
    if (purchases.length === 0) return { title: "Purchase by Ingredient", columns: [], rows: [] };
    const ids = purchases.map(p => p.id);
    const lines = await db.select({
      ingredientId: purchaseLinesTable.ingredientId, qty: purchaseLinesTable.quantity,
      rate: purchaseLinesTable.unitRate, total: purchaseLinesTable.lineTotal,
    }).from(purchaseLinesTable).where(sql`${purchaseLinesTable.purchaseId} IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)})`);
    const ings = await db.select().from(ingredientsTable);
    const ingMap = new Map(ings.map(i => [i.id, i]));
    const m = new Map<number, any>();
    for (const l of lines) {
      const ing = ingMap.get(l.ingredientId);
      const e = m.get(l.ingredientId) || { ingredient: ing?.name || "Unknown", uom: ing?.stockUom || "", qty: 0, total: 0, count: 0 };
      e.qty += l.qty; e.total += l.total; e.count++;
      m.set(l.ingredientId, e);
    }
    const rows = Array.from(m.values()).map(r => ({ ...r, avgRate: r.qty > 0 ? r.total / r.qty : 0 })).sort((a,b) => b.total - a.total);
    return {
      title: "Purchase by Ingredient",
      columns: [
        { key: "ingredient", label: "Ingredient", type: "text", width: 24 },
        { key: "uom", label: "UOM", type: "text", width: 8 },
        { key: "count", label: "# Buys", type: "number" },
        { key: "qty", label: "Total Qty", type: "number" },
        { key: "avgRate", label: "Avg Rate", type: "currency" },
        { key: "total", label: "Total Value", type: "currency" },
      ],
      rows,
    };
  }
});

R({ key: "vendor-payments", title: "Vendor Payments Register", category: "Purchase",
  fetch: async ({ from, to }) => {
    const rows = await db.select({
      date: vendorPaymentsTable.paymentDate, paymentNo: vendorPaymentsTable.paymentNo,
      vendor: vendorsTable.name, amount: vendorPaymentsTable.totalAmount, method: vendorPaymentsTable.paymentMethod,
    }).from(vendorPaymentsTable).leftJoin(vendorsTable, eq(vendorPaymentsTable.vendorId, vendorsTable.id))
      .where(and(gte(vendorPaymentsTable.paymentDate, from), lte(vendorPaymentsTable.paymentDate, to)))
      .orderBy(vendorPaymentsTable.paymentDate);
    return {
      title: "Vendor Payments Register",
      columns: [
        { key: "date", label: "Date", type: "date" },
        { key: "paymentNo", label: "Payment #", type: "text" },
        { key: "vendor", label: "Vendor", type: "text", width: 22 },
        { key: "amount", label: "Amount", type: "currency" },
        { key: "method", label: "Method", type: "text" },
      ],
      rows,
      summary: [{ label: "Total Paid", value: fmtMoney(rows.reduce((s,r) => s + (r.amount||0), 0)) }],
    };
  }
});

R({ key: "vendor-outstanding", title: "Vendor Outstanding (Aging)", category: "Purchase", adminOnly: true,
  fetch: async () => {
    const today = new Date();
    const purchases = await db.select({
      date: purchasesTable.purchaseDate, vendor: vendorsTable.name, vendorId: vendorsTable.id,
      pending: purchasesTable.pendingAmount, status: purchasesTable.paymentStatus,
    }).from(purchasesTable).leftJoin(vendorsTable, eq(purchasesTable.vendorId, vendorsTable.id))
      .where(sql`${purchasesTable.pendingAmount} > 0`);
    const m = new Map<number, any>();
    for (const p of purchases) {
      const ageDays = Math.floor((today.getTime() - new Date(p.date).getTime()) / (1000*60*60*24));
      const e = m.get(p.vendorId || 0) || { vendor: p.vendor || "Unknown", b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0, total: 0 };
      const amt = p.pending || 0;
      if (ageDays <= 30) e.b0_30 += amt;
      else if (ageDays <= 60) e.b31_60 += amt;
      else if (ageDays <= 90) e.b61_90 += amt;
      else e.b90p += amt;
      e.total += amt;
      m.set(p.vendorId || 0, e);
    }
    const rows = Array.from(m.values()).sort((a,b) => b.total - a.total);
    return {
      title: "Vendor Outstanding (Aging)",
      columns: [
        { key: "vendor", label: "Vendor", type: "text", width: 24 },
        { key: "b0_30", label: "0–30 days", type: "currency" },
        { key: "b31_60", label: "31–60 days", type: "currency" },
        { key: "b61_90", label: "61–90 days", type: "currency" },
        { key: "b90p", label: "90+ days", type: "currency" },
        { key: "total", label: "Total Outstanding", type: "currency" },
      ],
      rows,
      summary: [{ label: "Grand Total Outstanding", value: fmtMoney(rows.reduce((s,r) => s + r.total, 0)) }],
    };
  }
});

R({ key: "price-trend", title: "Price Trend per Ingredient", category: "Purchase",
  fetch: async ({ from, to }) => {
    const purchases = await db.select({ id: purchasesTable.id, date: purchasesTable.purchaseDate }).from(purchasesTable)
      .where(and(gte(purchasesTable.purchaseDate, from), lte(purchasesTable.purchaseDate, to)));
    if (purchases.length === 0) return { title: "Price Trend per Ingredient", columns: [], rows: [] };
    const dateById = new Map(purchases.map(p => [p.id, p.date]));
    const ids = purchases.map(p => p.id);
    const lines = await db.select({
      purchaseId: purchaseLinesTable.purchaseId, ingredientId: purchaseLinesTable.ingredientId, rate: purchaseLinesTable.unitRate,
    }).from(purchaseLinesTable).where(sql`${purchaseLinesTable.purchaseId} IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)})`);
    const ings = await db.select().from(ingredientsTable);
    const ingMap = new Map(ings.map(i => [i.id, i.name]));
    const grp = new Map<number, { name: string; rates: Array<{date:string;rate:number}> }>();
    for (const l of lines) {
      const e = grp.get(l.ingredientId) || { name: ingMap.get(l.ingredientId) || "Unknown", rates: [] };
      e.rates.push({ date: dateById.get(l.purchaseId) || "", rate: l.rate });
      grp.set(l.ingredientId, e);
    }
    const rows = Array.from(grp.values()).map(g => {
      const sorted = g.rates.sort((a,b) => a.date.localeCompare(b.date));
      const first = sorted[0]?.rate || 0; const last = sorted[sorted.length-1]?.rate || 0;
      const min = Math.min(...sorted.map(r => r.rate));
      const max = Math.max(...sorted.map(r => r.rate));
      const avg = sorted.reduce((s,r) => s + r.rate, 0) / sorted.length;
      const variancePct = first > 0 ? ((last - first) / first) * 100 : 0;
      return { ingredient: g.name, buys: sorted.length, first, last, min, max, avg, variancePct };
    }).sort((a,b) => Math.abs(b.variancePct) - Math.abs(a.variancePct));
    return {
      title: "Price Trend per Ingredient",
      columns: [
        { key: "ingredient", label: "Ingredient", type: "text", width: 24 },
        { key: "buys", label: "# Buys", type: "number" },
        { key: "first", label: "First Rate", type: "currency" },
        { key: "last", label: "Last Rate", type: "currency" },
        { key: "min", label: "Min", type: "currency" },
        { key: "max", label: "Max", type: "currency" },
        { key: "avg", label: "Avg", type: "currency" },
        { key: "variancePct", label: "Change %", type: "percent" },
      ],
      rows,
    };
  }
});

R({ key: "gst-input", title: "GST Input (Purchases)", category: "Purchase", adminOnly: true,
  fetch: async ({ from, to }) => {
    const p = await db.select().from(purchasesTable)
      .where(and(gte(purchasesTable.purchaseDate, from), lte(purchasesTable.purchaseDate, to)));
    const m = new Map<string, any>();
    for (const x of p) {
      const month = x.purchaseDate.substring(0,7);
      const e = m.get(month) || { month, taxable: 0, gst: 0, total: 0 };
      e.taxable += (x.totalAmount || 0) - (x.taxAmount || 0); e.gst += x.taxAmount || 0; e.total += x.totalAmount || 0;
      m.set(month, e);
    }
    const rows = Array.from(m.values()).sort((a,b) => a.month.localeCompare(b.month));
    return {
      title: "GST Input (Purchases)",
      columns: [
        { key: "month", label: "Month", type: "text" },
        { key: "taxable", label: "Taxable Value", type: "currency" },
        { key: "gst", label: "GST Input", type: "currency" },
        { key: "total", label: "Purchase Total", type: "currency" },
      ],
      rows,
      summary: [{ label: "Total GST Input", value: fmtMoney(rows.reduce((s,r) => s + r.gst, 0)) }],
    };
  }
});

// ============== INVENTORY ==============
R({ key: "current-stock", title: "Current Stock Snapshot", category: "Inventory",
  fetch: async () => {
    const ings = await db.select().from(ingredientsTable).where(eq(ingredientsTable.active, true));
    const rows = ings.map(i => ({
      code: i.code, name: i.name, uom: i.stockUom, currentStock: i.currentStock,
      cost: i.weightedAvgCost, value: i.currentStock * i.weightedAvgCost,
      reorderLevel: i.reorderLevel, status: i.currentStock <= (i.reorderLevel || 0) ? "Low" : "OK",
    })).sort((a,b) => a.name.localeCompare(b.name));
    return {
      title: "Current Stock Snapshot",
      columns: [
        { key: "code", label: "Code", type: "text" },
        { key: "name", label: "Ingredient", type: "text", width: 24 },
        { key: "uom", label: "UOM", type: "text" },
        { key: "currentStock", label: "Stock", type: "number" },
        { key: "cost", label: "Wt-Avg Cost", type: "currency" },
        { key: "value", label: "Stock Value", type: "currency" },
        { key: "reorderLevel", label: "Reorder At", type: "number" },
        { key: "status", label: "Status", type: "text" },
      ],
      rows,
      summary: [
        { label: "Total Items", value: rows.length },
        { label: "Total Stock Value", value: fmtMoney(rows.reduce((s,r) => s + r.value, 0)) },
        { label: "Items Below Reorder", value: rows.filter(r => r.status === "Low").length },
      ],
    };
  }
});

R({ key: "stock-movement", title: "Stock Movement", category: "Inventory",
  fetch: async ({ from, to }) => {
    const snaps = await db.select({
      date: stockSnapshotsTable.snapshotDate, ingredientId: stockSnapshotsTable.ingredientId,
      opening: stockSnapshotsTable.openingQty, inward: stockSnapshotsTable.inwardQty,
      consumed: stockSnapshotsTable.consumedQty, waste: stockSnapshotsTable.wasteQty, closing: stockSnapshotsTable.closingQty,
    }).from(stockSnapshotsTable)
      .where(and(gte(stockSnapshotsTable.snapshotDate, from), lte(stockSnapshotsTable.snapshotDate, to)));
    const ings = await db.select().from(ingredientsTable);
    const ingMap = new Map(ings.map(i => [i.id, i]));
    const m = new Map<number, any>();
    for (const s of snaps) {
      const ing = ingMap.get(s.ingredientId);
      const e = m.get(s.ingredientId) || { ingredient: ing?.name || "?", uom: ing?.stockUom || "", opening: 0, inward: 0, consumed: 0, waste: 0, closing: 0 };
      e.inward += s.inward; e.consumed += s.consumed; e.waste += s.waste;
      e.opening = e.opening || s.opening; e.closing = s.closing;
      m.set(s.ingredientId, e);
    }
    const rows = Array.from(m.values()).sort((a,b) => a.ingredient.localeCompare(b.ingredient));
    return {
      title: "Stock Movement",
      columns: [
        { key: "ingredient", label: "Ingredient", type: "text", width: 24 },
        { key: "uom", label: "UOM", type: "text" },
        { key: "opening", label: "Opening", type: "number" },
        { key: "inward", label: "Inward", type: "number" },
        { key: "consumed", label: "Consumed", type: "number" },
        { key: "waste", label: "Waste", type: "number" },
        { key: "closing", label: "Closing", type: "number" },
      ],
      rows,
    };
  }
});

R({ key: "low-stock", title: "Low-Stock / Reorder Report", category: "Inventory",
  fetch: async () => {
    const ings = await db.select().from(ingredientsTable).where(eq(ingredientsTable.active, true));
    const rows = ings.filter(i => i.currentStock <= (i.reorderLevel || 0)).map(i => ({
      code: i.code, name: i.name, uom: i.stockUom, currentStock: i.currentStock,
      reorderLevel: i.reorderLevel, shortage: Math.max(0, (i.reorderLevel || 0) - i.currentStock),
    })).sort((a,b) => b.shortage - a.shortage);
    return {
      title: "Low-Stock / Reorder Report",
      columns: [
        { key: "code", label: "Code", type: "text" },
        { key: "name", label: "Ingredient", type: "text", width: 26 },
        { key: "uom", label: "UOM", type: "text" },
        { key: "currentStock", label: "Stock", type: "number" },
        { key: "reorderLevel", label: "Reorder At", type: "number" },
        { key: "shortage", label: "Shortage", type: "number" },
      ],
      rows,
      summary: [{ label: "Items needing reorder", value: rows.length }],
    };
  }
});

R({ key: "stock-adjustments", title: "Stock Adjustment Log", category: "Inventory",
  fetch: async ({ from, to }) => {
    const adj = await db.select({
      createdAt: stockAdjustmentsTable.createdAt, ingredientId: stockAdjustmentsTable.ingredientId,
      type: stockAdjustmentsTable.adjustmentType, qty: stockAdjustmentsTable.quantity, reason: stockAdjustmentsTable.reason,
    }).from(stockAdjustmentsTable)
      .where(and(gte(stockAdjustmentsTable.createdAt, new Date(from)), lte(stockAdjustmentsTable.createdAt, new Date(to + "T23:59:59Z"))));
    const ings = await db.select().from(ingredientsTable);
    const ingMap = new Map(ings.map(i => [i.id, i]));
    const rows = adj.map(a => ({
      date: a.createdAt.toISOString().split("T")[0],
      ingredient: ingMap.get(a.ingredientId)?.name || "?",
      uom: ingMap.get(a.ingredientId)?.stockUom || "",
      type: a.type, qty: a.qty, reason: a.reason,
    })).sort((a,b) => b.date.localeCompare(a.date));
    return {
      title: "Stock Adjustment Log",
      columns: [
        { key: "date", label: "Date", type: "date" },
        { key: "ingredient", label: "Ingredient", type: "text", width: 24 },
        { key: "uom", label: "UOM", type: "text" },
        { key: "type", label: "Type", type: "text" },
        { key: "qty", label: "Qty", type: "number" },
        { key: "reason", label: "Reason", type: "text", width: 28 },
      ],
      rows,
    };
  }
});

R({ key: "inventory-valuation", title: "Inventory Valuation", category: "Inventory", adminOnly: true,
  fetch: async () => {
    const ings = await db.select().from(ingredientsTable).where(eq(ingredientsTable.active, true));
    const cats = await db.select().from(categoriesTable);
    const catMap = new Map(cats.map(c => [c.id, c.name]));
    const m = new Map<string, any>();
    let total = 0;
    for (const i of ings) {
      const v = i.currentStock * i.weightedAvgCost;
      total += v;
      const cat = i.categoryId ? catMap.get(i.categoryId) || "Uncategorized" : "Uncategorized";
      const e = m.get(cat) || { category: cat, items: 0, value: 0 };
      e.items++; e.value += v;
      m.set(cat, e);
    }
    const rows = Array.from(m.values()).map(r => ({ ...r, share: total > 0 ? (r.value / total) * 100 : 0 })).sort((a,b) => b.value - a.value);
    return {
      title: "Inventory Valuation by Category",
      columns: [
        { key: "category", label: "Category", type: "text", width: 24 },
        { key: "items", label: "# Items", type: "number" },
        { key: "value", label: "Value", type: "currency" },
        { key: "share", label: "Share %", type: "percent" },
      ],
      rows,
      summary: [{ label: "Total Inventory Value", value: fmtMoney(total) }],
    };
  }
});

R({ key: "slow-moving", title: "Slow-Moving / Dead Stock", category: "Inventory",
  fetch: async ({ from, to }) => {
    const ings = await db.select().from(ingredientsTable).where(eq(ingredientsTable.active, true));
    const snaps = await db.select({
      ingredientId: stockSnapshotsTable.ingredientId, consumed: stockSnapshotsTable.consumedQty,
    }).from(stockSnapshotsTable).where(and(gte(stockSnapshotsTable.snapshotDate, from), lte(stockSnapshotsTable.snapshotDate, to)));
    const consMap = new Map<number, number>();
    for (const s of snaps) consMap.set(s.ingredientId, (consMap.get(s.ingredientId) || 0) + s.consumed);
    const rows = ings.filter(i => i.currentStock > 0 && (consMap.get(i.id) || 0) === 0).map(i => ({
      code: i.code, name: i.name, uom: i.stockUom, currentStock: i.currentStock,
      cost: i.weightedAvgCost, value: i.currentStock * i.weightedAvgCost,
    })).sort((a,b) => b.value - a.value);
    return {
      title: "Slow-Moving / Dead Stock (no consumption in period)",
      columns: [
        { key: "code", label: "Code", type: "text" },
        { key: "name", label: "Ingredient", type: "text", width: 26 },
        { key: "uom", label: "UOM", type: "text" },
        { key: "currentStock", label: "Stock", type: "number" },
        { key: "cost", label: "Cost", type: "currency" },
        { key: "value", label: "Tied-up Value", type: "currency" },
      ],
      rows,
      summary: [
        { label: "Dead-stock SKUs", value: rows.length },
        { label: "Total Tied-up Value", value: fmtMoney(rows.reduce((s,r) => s + r.value, 0)) },
      ],
    };
  }
});

R({ key: "expiry-report", title: "Expiry Report", category: "Inventory",
  fetch: async () => {
    const today = new Date().toISOString().split("T")[0];
    const lines = await db.select({
      expiry: purchaseLinesTable.expiryDate, ingredientId: purchaseLinesTable.ingredientId,
      qty: purchaseLinesTable.quantity, rate: purchaseLinesTable.unitRate,
      purchaseId: purchaseLinesTable.purchaseId,
    }).from(purchaseLinesTable).where(isNotNull(purchaseLinesTable.expiryDate));
    const ings = await db.select().from(ingredientsTable);
    const ingMap = new Map(ings.map(i => [i.id, i]));
    const rows = lines.filter(l => l.expiry).map(l => {
      const ing = ingMap.get(l.ingredientId);
      const days = Math.floor((new Date(l.expiry!).getTime() - new Date(today).getTime()) / (1000*60*60*24));
      let bucket = "OK";
      if (days < 0) bucket = "EXPIRED";
      else if (days <= 7) bucket = "Expires in 7d";
      else if (days <= 15) bucket = "Expires in 15d";
      else if (days <= 30) bucket = "Expires in 30d";
      return {
        ingredient: ing?.name || "?", uom: ing?.stockUom || "",
        expiry: l.expiry!, daysToExpiry: days, qty: l.qty, value: l.qty * (l.rate || 0), bucket,
      };
    }).filter(r => r.bucket !== "OK").sort((a,b) => a.daysToExpiry - b.daysToExpiry);
    return {
      title: "Expiry Report (FIFO)",
      columns: [
        { key: "ingredient", label: "Ingredient", type: "text", width: 24 },
        { key: "uom", label: "UOM", type: "text" },
        { key: "expiry", label: "Expiry Date", type: "date" },
        { key: "daysToExpiry", label: "Days Left", type: "number" },
        { key: "qty", label: "Qty", type: "number" },
        { key: "value", label: "Value at Risk", type: "currency" },
        { key: "bucket", label: "Bucket", type: "text" },
      ],
      rows,
      summary: [
        { label: "Already Expired Lots", value: rows.filter(r => r.bucket === "EXPIRED").length },
        { label: "Total Value at Risk", value: fmtMoney(rows.reduce((s,r) => s + r.value, 0)) },
      ],
    };
  }
});

// ============== RECIPE / MENU ==============
R({ key: "recipe-cost-card", title: "Recipe Cost Card (per item)", category: "Recipe",
  fetch: async () => {
    const items = await db.select().from(menuItemsTable).where(eq(menuItemsTable.active, true));
    const lines = await db.select().from(recipeLinesTable);
    const ings = await db.select().from(ingredientsTable);
    const ingMap = new Map(ings.map(i => [i.id, i]));
    const linesByItem = new Map<number, typeof lines>();
    for (const l of lines) {
      const arr = linesByItem.get(l.menuItemId) || [];
      arr.push(l); linesByItem.set(l.menuItemId, arr);
    }
    const rows = items.map(it => {
      const itLines = linesByItem.get(it.id) || [];
      let cost = 0;
      for (const l of itLines) {
        const ing = ingMap.get(l.ingredientId);
        if (!ing) continue;
        const netQty = l.quantity * (1 + (l.wastagePercent || 0) / 100);
        cost += (ing.weightedAvgCost / (ing.conversionFactor || 1)) * netQty;
      }
      const sp = it.sellingPrice || 0;
      const margin = sp - cost;
      return {
        item: it.name, code: it.code, ingredients: itLines.length,
        sellingPrice: sp, recipeCost: cost,
        marginAmt: margin, marginPct: sp > 0 ? (margin / sp) * 100 : 0,
        foodCostPct: sp > 0 ? (cost / sp) * 100 : 0,
      };
    }).sort((a,b) => a.item.localeCompare(b.item));
    return {
      title: "Recipe Cost Card",
      columns: [
        { key: "code", label: "Code", type: "text" },
        { key: "item", label: "Menu Item", type: "text", width: 26 },
        { key: "ingredients", label: "# Ing.", type: "number" },
        { key: "sellingPrice", label: "Selling Price", type: "currency" },
        { key: "recipeCost", label: "Recipe Cost", type: "currency" },
        { key: "marginAmt", label: "Margin ₹", type: "currency" },
        { key: "marginPct", label: "Margin %", type: "percent" },
        { key: "foodCostPct", label: "Food Cost %", type: "percent" },
      ],
      rows,
    };
  }
});

R({ key: "food-cost-percent", title: "Food Cost % by Item", category: "Recipe",
  fetch: async () => {
    const items = await db.select().from(menuItemsTable).where(eq(menuItemsTable.active, true));
    const lines = await db.select().from(recipeLinesTable);
    const ings = await db.select().from(ingredientsTable);
    const ingMap = new Map(ings.map(i => [i.id, i]));
    const linesByItem = new Map<number, typeof lines>();
    for (const l of lines) { const a = linesByItem.get(l.menuItemId) || []; a.push(l); linesByItem.set(l.menuItemId, a); }
    const rows = items.map(it => {
      const itLines = linesByItem.get(it.id) || [];
      let cost = 0;
      for (const l of itLines) {
        const ing = ingMap.get(l.ingredientId);
        if (!ing) continue;
        cost += (ing.weightedAvgCost / (ing.conversionFactor || 1)) * (l.quantity * (1 + (l.wastagePercent || 0)/100));
      }
      return { item: it.name, sellingPrice: it.sellingPrice, recipeCost: cost, foodCostPct: it.sellingPrice > 0 ? (cost / it.sellingPrice) * 100 : 0 };
    }).sort((a,b) => b.foodCostPct - a.foodCostPct);
    return {
      title: "Food Cost % by Item",
      columns: [
        { key: "item", label: "Menu Item", type: "text", width: 28 },
        { key: "sellingPrice", label: "Selling Price", type: "currency" },
        { key: "recipeCost", label: "Recipe Cost", type: "currency" },
        { key: "foodCostPct", label: "Food Cost %", type: "percent" },
      ],
      rows,
    };
  }
});

R({ key: "menu-profitability-matrix", title: "Menu Profitability Matrix", category: "Recipe",
  fetch: async ({ from, to }) => {
    const items = await db.select().from(menuItemsTable).where(eq(menuItemsTable.active, true));
    const lines = await db.select().from(recipeLinesTable);
    const ings = await db.select().from(ingredientsTable);
    const ingMap = new Map(ings.map(i => [i.id, i]));
    const linesByItem = new Map<number, typeof lines>();
    for (const l of lines) { const a = linesByItem.get(l.menuItemId) || []; a.push(l); linesByItem.set(l.menuItemId, a); }

    const inv = await db.select({ id: salesInvoicesTable.id }).from(salesInvoicesTable)
      .where(and(gte(salesInvoicesTable.salesDate, from), lte(salesInvoicesTable.salesDate, to)));
    const salesByItem = new Map<number, { qty: number; net: number }>();
    if (inv.length > 0) {
      const ids = inv.map(i => i.id);
      const sLines = await db.select({ menuItemId: salesInvoiceLinesTable.menuItemId, qty: salesInvoiceLinesTable.quantity, net: salesInvoiceLinesTable.finalLineAmount })
        .from(salesInvoiceLinesTable).where(sql`${salesInvoiceLinesTable.invoiceId} IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)})`);
      for (const l of sLines) {
        if (!l.menuItemId) continue;
        const e = salesByItem.get(l.menuItemId) || { qty: 0, net: 0 };
        e.qty += l.qty; e.net += l.net;
        salesByItem.set(l.menuItemId, e);
      }
    }

    const enriched = items.map(it => {
      const itLines = linesByItem.get(it.id) || [];
      let cost = 0;
      for (const l of itLines) { const ing = ingMap.get(l.ingredientId); if (ing) cost += (ing.weightedAvgCost / (ing.conversionFactor || 1)) * (l.quantity * (1 + (l.wastagePercent || 0)/100)); }
      const sale = salesByItem.get(it.id) || { qty: 0, net: 0 };
      const margin = (it.sellingPrice || 0) - cost;
      return { id: it.id, item: it.name, qtySold: sale.qty, revenue: sale.net, marginUnit: margin };
    });
    const avgQty = enriched.reduce((s,e) => s + e.qtySold, 0) / Math.max(enriched.length, 1);
    const avgMargin = enriched.reduce((s,e) => s + e.marginUnit, 0) / Math.max(enriched.length, 1);
    const rows = enriched.map(e => {
      const popHigh = e.qtySold >= avgQty;
      const profHigh = e.marginUnit >= avgMargin;
      const cls = popHigh && profHigh ? "Star" : popHigh && !profHigh ? "Plowhorse" : !popHigh && profHigh ? "Puzzle" : "Dog";
      return { item: e.item, qtySold: e.qtySold, revenue: e.revenue, marginUnit: e.marginUnit, classification: cls };
    }).sort((a,b) => b.revenue - a.revenue);
    return {
      title: "Menu Profitability Matrix",
      columns: [
        { key: "item", label: "Menu Item", type: "text", width: 26 },
        { key: "qtySold", label: "Qty Sold", type: "number" },
        { key: "revenue", label: "Revenue", type: "currency" },
        { key: "marginUnit", label: "Margin / Unit", type: "currency" },
        { key: "classification", label: "Classification", type: "text" },
      ],
      rows,
      summary: [
        { label: "Stars (popular + profitable)", value: rows.filter(r => r.classification === "Star").length },
        { label: "Plowhorses (popular, low-margin)", value: rows.filter(r => r.classification === "Plowhorse").length },
        { label: "Puzzles (high-margin, unpopular)", value: rows.filter(r => r.classification === "Puzzle").length },
        { label: "Dogs (consider removing)", value: rows.filter(r => r.classification === "Dog").length },
      ],
    };
  }
});

R({ key: "below-target-margin", title: "Items Below Target Margin", category: "Recipe",
  fetch: async () => {
    const cfg = await db.select().from(systemConfigTable);
    const targetPct = (cfg[0] as any)?.targetMarginPercent ?? 60;
    const items = await db.select().from(menuItemsTable).where(eq(menuItemsTable.active, true));
    const lines = await db.select().from(recipeLinesTable);
    const ings = await db.select().from(ingredientsTable);
    const ingMap = new Map(ings.map(i => [i.id, i]));
    const linesByItem = new Map<number, typeof lines>();
    for (const l of lines) { const a = linesByItem.get(l.menuItemId) || []; a.push(l); linesByItem.set(l.menuItemId, a); }
    const rows = items.map(it => {
      const itLines = linesByItem.get(it.id) || [];
      let cost = 0;
      for (const l of itLines) { const ing = ingMap.get(l.ingredientId); if (ing) cost += (ing.weightedAvgCost / (ing.conversionFactor || 1)) * (l.quantity * (1 + (l.wastagePercent || 0)/100)); }
      const marginPct = it.sellingPrice > 0 ? ((it.sellingPrice - cost) / it.sellingPrice) * 100 : 0;
      return { item: it.name, sellingPrice: it.sellingPrice, recipeCost: cost, marginPct, gap: targetPct - marginPct };
    }).filter(r => r.marginPct < targetPct).sort((a,b) => b.gap - a.gap);
    return {
      title: `Items Below Target Margin (target ${targetPct}%)`,
      columns: [
        { key: "item", label: "Menu Item", type: "text", width: 28 },
        { key: "sellingPrice", label: "Price", type: "currency" },
        { key: "recipeCost", label: "Cost", type: "currency" },
        { key: "marginPct", label: "Margin %", type: "percent" },
        { key: "gap", label: "Gap to Target", type: "percent" },
      ],
      rows,
    };
  }
});

R({ key: "ingredient-demand", title: "Recipe Ingredient Demand Forecast", category: "Recipe",
  fetch: async ({ from, to }) => {
    const inv = await db.select({ id: salesInvoicesTable.id }).from(salesInvoicesTable)
      .where(and(gte(salesInvoicesTable.salesDate, from), lte(salesInvoicesTable.salesDate, to)));
    if (inv.length === 0) return { title: "Recipe Ingredient Demand Forecast", columns: [], rows: [] };
    const ids = inv.map(i => i.id);
    const sLines = await db.select({ menuItemId: salesInvoiceLinesTable.menuItemId, qty: salesInvoiceLinesTable.quantity })
      .from(salesInvoiceLinesTable).where(sql`${salesInvoiceLinesTable.invoiceId} IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)})`);
    const recipes = await db.select().from(recipeLinesTable);
    const ings = await db.select().from(ingredientsTable);
    const ingMap = new Map(ings.map(i => [i.id, i]));
    const recByItem = new Map<number, typeof recipes>();
    for (const r of recipes) { const a = recByItem.get(r.menuItemId) || []; a.push(r); recByItem.set(r.menuItemId, a); }
    const demand = new Map<number, number>();
    for (const l of sLines) {
      if (!l.menuItemId) continue;
      const recs = recByItem.get(l.menuItemId) || [];
      for (const r of recs) {
        const need = l.qty * r.quantity * (1 + (r.wastagePercent || 0)/100);
        demand.set(r.ingredientId, (demand.get(r.ingredientId) || 0) + need);
      }
    }
    const rows = Array.from(demand.entries()).map(([ingId, qty]) => {
      const ing = ingMap.get(ingId);
      return { ingredient: ing?.name || "?", uom: ing?.stockUom || "", demanded: qty, currentStock: ing?.currentStock || 0,
        balance: (ing?.currentStock || 0) - qty };
    }).sort((a,b) => a.balance - b.balance);
    return {
      title: "Recipe Ingredient Demand (based on sales in period)",
      columns: [
        { key: "ingredient", label: "Ingredient", type: "text", width: 24 },
        { key: "uom", label: "UOM", type: "text" },
        { key: "demanded", label: "Demanded", type: "number" },
        { key: "currentStock", label: "Current Stock", type: "number" },
        { key: "balance", label: "Balance", type: "number" },
      ],
      rows,
    };
  }
});

// ============== EXPENSES ==============
R({ key: "expense-register", title: "Expense Register", category: "Expense",
  fetch: async ({ from, to }) => {
    const rows = await db.select({
      date: expensesTable.expenseDate, expenseNo: expensesTable.expenseNumber,
      category: categoriesTable.name, amount: expensesTable.totalAmount,
      costType: expensesTable.costType, paymentMode: expensesTable.paymentMode,
      description: expensesTable.description,
    }).from(expensesTable).leftJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
      .where(and(gte(expensesTable.expenseDate, from), lte(expensesTable.expenseDate, to)))
      .orderBy(expensesTable.expenseDate);
    return {
      title: "Expense Register",
      columns: [
        { key: "date", label: "Date", type: "date" },
        { key: "expenseNo", label: "Expense #", type: "text" },
        { key: "category", label: "Category", type: "text", width: 18 },
        { key: "amount", label: "Amount", type: "currency" },
        { key: "costType", label: "Cost Type", type: "text" },
        { key: "paymentMode", label: "Pay Mode", type: "text" },
        { key: "description", label: "Description", type: "text", width: 28 },
      ],
      rows,
      summary: [{ label: "Total Expenses", value: fmtMoney(rows.reduce((s,r) => s + (r.amount||0), 0)) }],
    };
  }
});

R({ key: "expense-by-category", title: "Expense by Category", category: "Expense",
  fetch: async ({ from, to }) => {
    const data = await db.select({ category: categoriesTable.name, amount: expensesTable.totalAmount })
      .from(expensesTable).leftJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
      .where(and(gte(expensesTable.expenseDate, from), lte(expensesTable.expenseDate, to)));
    const m = new Map<string, any>();
    for (const d of data) {
      const k = d.category || "Uncategorized";
      const e = m.get(k) || { category: k, count: 0, amount: 0 };
      e.count++; e.amount += d.amount || 0;
      m.set(k, e);
    }
    const total = Array.from(m.values()).reduce((s,r) => s + r.amount, 0);
    const rows = Array.from(m.values()).map(r => ({ ...r, share: total > 0 ? (r.amount / total) * 100 : 0 })).sort((a,b) => b.amount - a.amount);
    return {
      title: "Expense by Category",
      columns: [
        { key: "category", label: "Category", type: "text", width: 22 },
        { key: "count", label: "# Entries", type: "number" },
        { key: "amount", label: "Amount", type: "currency" },
        { key: "share", label: "Share %", type: "percent" },
      ],
      rows,
      summary: [{ label: "Total Expenses", value: fmtMoney(total) }],
    };
  }
});

R({ key: "fixed-vs-variable", title: "Fixed vs Variable Expenses", category: "Expense",
  fetch: async ({ from, to }) => {
    const data = await db.select().from(expensesTable)
      .where(and(gte(expensesTable.expenseDate, from), lte(expensesTable.expenseDate, to)));
    const fixed = data.filter(d => d.costType === "fixed").reduce((s,d) => s + (d.totalAmount||0), 0);
    const variable = data.filter(d => d.costType !== "fixed").reduce((s,d) => s + (d.totalAmount||0), 0);
    const total = fixed + variable;
    const rows = [
      { type: "Fixed", count: data.filter(d => d.costType === "fixed").length, amount: fixed, share: total > 0 ? (fixed/total)*100 : 0 },
      { type: "Variable", count: data.filter(d => d.costType !== "fixed").length, amount: variable, share: total > 0 ? (variable/total)*100 : 0 },
    ];
    return {
      title: "Fixed vs Variable Expenses",
      columns: [
        { key: "type", label: "Cost Type", type: "text" },
        { key: "count", label: "# Entries", type: "number" },
        { key: "amount", label: "Amount", type: "currency" },
        { key: "share", label: "Share %", type: "percent" },
      ],
      rows,
      summary: [{ label: "Total", value: fmtMoney(total) }],
    };
  }
});

R({ key: "recurring-expenses", title: "Recurring Expenses Schedule", category: "Expense",
  fetch: async () => {
    const data = await db.select({
      expenseNo: expensesTable.expenseNumber, category: categoriesTable.name,
      amount: expensesTable.totalAmount, frequency: expensesTable.recurringFrequency,
      lastDate: expensesTable.expenseDate, description: expensesTable.description,
    }).from(expensesTable).leftJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
      .where(eq(expensesTable.recurring, true));
    return {
      title: "Recurring Expenses",
      columns: [
        { key: "expenseNo", label: "Expense #", type: "text" },
        { key: "category", label: "Category", type: "text", width: 18 },
        { key: "amount", label: "Amount", type: "currency" },
        { key: "frequency", label: "Frequency", type: "text" },
        { key: "lastDate", label: "Last Date", type: "date" },
        { key: "description", label: "Description", type: "text", width: 28 },
      ],
      rows: data,
    };
  }
});

R({ key: "petty-cash-ledger", title: "Petty Cash Ledger", category: "Expense",
  fetch: async ({ from, to }) => {
    const rows = await db.select().from(pettyCashLedgerTable)
      .where(and(gte(pettyCashLedgerTable.transactionDate, from), lte(pettyCashLedgerTable.transactionDate, to)))
      .orderBy(pettyCashLedgerTable.transactionDate);
    const mapped = rows.map(r => ({
      date: r.transactionDate, type: r.transactionType, amount: r.amount,
      category: r.category || "", description: r.description || "", balance: r.runningBalance,
      status: r.approvalStatus,
    }));
    return {
      title: "Petty Cash Ledger",
      columns: [
        { key: "date", label: "Date", type: "date" },
        { key: "type", label: "Type", type: "text" },
        { key: "amount", label: "Amount", type: "currency" },
        { key: "category", label: "Category", type: "text" },
        { key: "description", label: "Description", type: "text", width: 26 },
        { key: "balance", label: "Running Balance", type: "currency" },
        { key: "status", label: "Status", type: "text" },
      ],
      rows: mapped,
      summary: [{ label: "End Balance", value: fmtMoney(mapped[mapped.length-1]?.balance || 0) }],
    };
  }
});

// ============== HR / EMPLOYEE ==============
R({ key: "attendance-register", title: "Attendance Register (Matrix)", category: "HR",
  fetch: async ({ from, to }) => {
    const emps = await db.select().from(employeesTable).where(eq(employeesTable.active, true));
    const att = await db.select().from(attendanceTable)
      .where(and(gte(attendanceTable.attendanceDate, from), lte(attendanceTable.attendanceDate, to)));
    const dates: string[] = [];
    const start = new Date(from), end = new Date(to);
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().split("T")[0]);
    const m = new Map<number, Map<string, string>>();
    for (const a of att) {
      if (!m.has(a.employeeId)) m.set(a.employeeId, new Map());
      const code = a.status === "present" ? "P" : a.status === "half-day" ? "½" : a.status === "week-off" ? "WO" : a.status === "absent" ? "A" : "?";
      m.get(a.employeeId)!.set(a.attendanceDate, code);
    }
    const cols: ReportColumn[] = [{ key: "employee", label: "Employee", type: "text", width: 22 }];
    for (const d of dates) cols.push({ key: d, label: d.substring(8), type: "text", width: 5 });
    const rows = emps.map(e => {
      const r: any = { employee: e.name };
      for (const d of dates) r[d] = m.get(e.id)?.get(d) || "—";
      return r;
    });
    return { title: "Attendance Register (Matrix)", columns: cols, rows, subtitle: from === to ? from : `${from} to ${to}` };
  }
});

R({ key: "monthly-attendance-summary", title: "Monthly Attendance Summary", category: "HR",
  fetch: async ({ from, to }) => {
    const emps = await db.select().from(employeesTable).where(eq(employeesTable.active, true));
    const att = await db.select().from(attendanceTable)
      .where(and(gte(attendanceTable.attendanceDate, from), lte(attendanceTable.attendanceDate, to)));
    const lvs = await db.select().from(leavesTable)
      .where(and(gte(leavesTable.leaveDate, from), lte(leavesTable.leaveDate, to)));
    const rows = emps.map(e => {
      const eAtt = att.filter(a => a.employeeId === e.id);
      const eLv = lvs.filter(l => l.employeeId === e.id);
      const counts = {
        present: eAtt.filter(a => a.status === "present").length,
        halfDay: eAtt.filter(a => a.status === "half-day").length,
        absent: eAtt.filter(a => a.status === "absent").length,
        weekOff: eAtt.filter(a => a.status === "week-off").length,
        paidLeave: eLv.filter(l => l.leaveType === "paid").length,
        unpaidLeave: eLv.filter(l => l.leaveType === "unpaid").length,
      };
      return { employee: e.name, position: e.position || "", ...counts, totalMarked: eAtt.length };
    });
    return {
      title: "Monthly Attendance Summary",
      columns: [
        { key: "employee", label: "Employee", type: "text", width: 22 },
        { key: "position", label: "Position", type: "text", width: 16 },
        { key: "present", label: "P", type: "number" },
        { key: "halfDay", label: "½", type: "number" },
        { key: "absent", label: "A", type: "number" },
        { key: "weekOff", label: "WO", type: "number" },
        { key: "paidLeave", label: "Paid Lv", type: "number" },
        { key: "unpaidLeave", label: "Unpaid Lv", type: "number" },
        { key: "totalMarked", label: "Days Marked", type: "number" },
      ],
      rows,
    };
  }
});

R({ key: "leaves-report", title: "Leaves Report", category: "HR",
  fetch: async ({ from, to }) => {
    const lvs = await db.select({
      date: leavesTable.leaveDate, employeeId: leavesTable.employeeId,
      leaveType: leavesTable.leaveType, reason: leavesTable.reason,
    }).from(leavesTable).where(and(gte(leavesTable.leaveDate, from), lte(leavesTable.leaveDate, to)))
      .orderBy(leavesTable.leaveDate);
    const emps = await db.select().from(employeesTable);
    const empMap = new Map(emps.map(e => [e.id, e]));
    const rows = lvs.map(l => ({
      date: l.date, employee: empMap.get(l.employeeId)?.name || "?",
      leaveType: l.leaveType, reason: l.reason || "",
    }));
    return {
      title: "Leaves Report",
      columns: [
        { key: "date", label: "Date", type: "date" },
        { key: "employee", label: "Employee", type: "text", width: 22 },
        { key: "leaveType", label: "Type", type: "text" },
        { key: "reason", label: "Reason", type: "text", width: 28 },
      ],
      rows,
      summary: [
        { label: "Paid Leaves", value: rows.filter(r => r.leaveType === "paid").length },
        { label: "Unpaid Leaves", value: rows.filter(r => r.leaveType === "unpaid").length },
      ],
    };
  }
});

R({ key: "salary-register", title: "Salary Register", category: "HR", adminOnly: true,
  fetch: async ({ from, to }) => {
    const fromY = parseInt(from.substring(0,4)); const fromM = parseInt(from.substring(5,7));
    const toY = parseInt(to.substring(0,4)); const toM = parseInt(to.substring(5,7));
    const all = await db.select().from(salaryRecordsTable);
    const filtered = all.filter(r => {
      const v = r.year * 12 + r.month;
      return v >= fromY * 12 + fromM && v <= toY * 12 + toM;
    });
    const emps = await db.select().from(employeesTable);
    const empMap = new Map(emps.map(e => [e.id, e]));
    const rows = filtered.map(r => ({
      employee: empMap.get(r.employeeId)?.name || "?",
      period: `${String(r.month).padStart(2,"0")}/${r.year}`,
      base: r.baseSalary, present: r.presentDays, halfDays: r.halfDays,
      bonus: r.bonusAmount, incentive: r.incentiveAmount,
      penalty: r.penaltyAmount, advance: r.advanceDeducted,
      gross: r.grossEarnings, deductions: r.deductions, net: r.netSalary,
      status: r.paymentStatus,
    })).sort((a,b) => a.period.localeCompare(b.period) || a.employee.localeCompare(b.employee));
    return {
      title: "Salary Register",
      columns: [
        { key: "period", label: "Period", type: "text" },
        { key: "employee", label: "Employee", type: "text", width: 22 },
        { key: "base", label: "Base", type: "currency" },
        { key: "present", label: "P Days", type: "number" },
        { key: "bonus", label: "Bonus", type: "currency" },
        { key: "incentive", label: "Incentive", type: "currency" },
        { key: "penalty", label: "Penalty", type: "currency" },
        { key: "advance", label: "Advance", type: "currency" },
        { key: "gross", label: "Gross", type: "currency" },
        { key: "deductions", label: "Deductions", type: "currency" },
        { key: "net", label: "Net", type: "currency" },
        { key: "status", label: "Status", type: "text" },
      ],
      rows,
      summary: [
        { label: "Total Net Payroll", value: fmtMoney(rows.reduce((s,r) => s + (r.net||0), 0)) },
      ],
    };
  }
});

R({ key: "salary-advances-report", title: "Salary Advances Report", category: "HR", adminOnly: true,
  fetch: async () => {
    const advs = await db.select().from(salaryAdvancesTable);
    const emps = await db.select().from(employeesTable);
    const empMap = new Map(emps.map(e => [e.id, e]));
    const rows = advs.map(a => ({
      date: a.advanceDate, employee: empMap.get(a.employeeId)?.name || "?",
      amount: a.amount, status: a.status, recoveredIn: a.recoveredInSalaryId || "—",
      reason: a.reason || "",
    })).sort((a,b) => b.date.localeCompare(a.date));
    return {
      title: "Salary Advances Report",
      columns: [
        { key: "date", label: "Date", type: "date" },
        { key: "employee", label: "Employee", type: "text", width: 22 },
        { key: "amount", label: "Amount", type: "currency" },
        { key: "status", label: "Status", type: "text" },
        { key: "recoveredIn", label: "Recovered in Sal#", type: "text" },
        { key: "reason", label: "Reason", type: "text", width: 28 },
      ],
      rows,
      summary: [
        { label: "Pending Advances", value: fmtMoney(rows.filter(r => r.status === "pending").reduce((s,r) => s + r.amount, 0)) },
        { label: "Total Recovered", value: fmtMoney(rows.filter(r => r.status === "recovered").reduce((s,r) => s + r.amount, 0)) },
      ],
    };
  }
});

R({ key: "bonus-penalty-log", title: "Bonus / Penalty / Incentive Log", category: "HR", adminOnly: true,
  fetch: async ({ from, to }) => {
    const fromY = parseInt(from.substring(0,4)); const fromM = parseInt(from.substring(5,7));
    const toY = parseInt(to.substring(0,4)); const toM = parseInt(to.substring(5,7));
    const all = await db.select().from(salaryAdjustmentsTable);
    const filtered = all.filter(r => { const v = r.year * 12 + r.month; return v >= fromY*12+fromM && v <= toY*12+toM; });
    const emps = await db.select().from(employeesTable);
    const empMap = new Map(emps.map(e => [e.id, e]));
    const rows = filtered.map(r => ({
      period: `${String(r.month).padStart(2,"0")}/${r.year}`,
      employee: empMap.get(r.employeeId)?.name || "?",
      type: r.type, amount: r.amount, reason: r.reason || "", applied: r.appliedToSalaryId ? "Yes" : "No",
    })).sort((a,b) => a.period.localeCompare(b.period));
    return {
      title: "Bonus / Penalty / Incentive Log",
      columns: [
        { key: "period", label: "Period", type: "text" },
        { key: "employee", label: "Employee", type: "text", width: 22 },
        { key: "type", label: "Type", type: "text" },
        { key: "amount", label: "Amount", type: "currency" },
        { key: "applied", label: "Applied?", type: "text" },
        { key: "reason", label: "Reason", type: "text", width: 28 },
      ],
      rows,
      summary: [
        { label: "Total Bonuses", value: fmtMoney(rows.filter(r => r.type === "bonus").reduce((s,r) => s + r.amount, 0)) },
        { label: "Total Incentives", value: fmtMoney(rows.filter(r => r.type === "incentive").reduce((s,r) => s + r.amount, 0)) },
        { label: "Total Penalties", value: fmtMoney(rows.filter(r => r.type === "penalty").reduce((s,r) => s + r.amount, 0)) },
      ],
    };
  }
});

R({ key: "employee-cost-percent", title: "Employee Cost % of Sales", category: "HR", adminOnly: true,
  fetch: async ({ from, to }) => {
    const fromY = parseInt(from.substring(0,4)); const fromM = parseInt(from.substring(5,7));
    const toY = parseInt(to.substring(0,4)); const toM = parseInt(to.substring(5,7));
    const sals = await db.select().from(salaryRecordsTable);
    const filteredSals = sals.filter(r => { const v = r.year * 12 + r.month; return v >= fromY*12+fromM && v <= toY*12+toM; });
    const totalSalary = filteredSals.reduce((s,r) => s + (r.netSalary || 0), 0);
    const inv = await db.select().from(salesInvoicesTable)
      .where(and(gte(salesInvoicesTable.salesDate, from), lte(salesInvoicesTable.salesDate, to)));
    const totalSales = inv.reduce((s,i) => s + i.finalAmount, 0);
    const pct = totalSales > 0 ? (totalSalary / totalSales) * 100 : 0;
    return {
      title: "Employee Cost % of Sales",
      columns: [
        { key: "metric", label: "Metric", type: "text", width: 28 },
        { key: "value", label: "Value", type: "text" },
      ],
      rows: [
        { metric: "Total Net Payroll (period)", value: fmtMoney(totalSalary) },
        { metric: "Total Net Sales (period)", value: fmtMoney(totalSales) },
        { metric: "Payroll Cost % of Sales", value: `${pct.toFixed(2)}%` },
      ],
    };
  }
});

// ============== FINANCIAL ==============
R({ key: "daily-pnl", title: "Daily P&L", category: "Financial", adminOnly: true,
  fetch: async ({ from, to }) => {
    const inv = await db.select().from(salesInvoicesTable)
      .where(and(gte(salesInvoicesTable.salesDate, from), lte(salesInvoicesTable.salesDate, to)));
    const exp = await db.select().from(expensesTable)
      .where(and(gte(expensesTable.expenseDate, from), lte(expensesTable.expenseDate, to)));
    const pur = await db.select().from(purchasesTable)
      .where(and(gte(purchasesTable.purchaseDate, from), lte(purchasesTable.purchaseDate, to)));
    const dates = new Set<string>();
    inv.forEach(i => dates.add(i.salesDate));
    exp.forEach(e => dates.add(e.expenseDate));
    pur.forEach(p => dates.add(p.purchaseDate));
    const rows = Array.from(dates).sort().map(date => {
      const sales = inv.filter(i => i.salesDate === date).reduce((s,i) => s + i.finalAmount, 0);
      const purchases = pur.filter(p => p.purchaseDate === date).reduce((s,p) => s + (p.totalAmount||0), 0);
      const expenses = exp.filter(e => e.expenseDate === date).reduce((s,e) => s + (e.totalAmount||0), 0);
      const profit = sales - purchases - expenses;
      return { date, sales, purchases, expenses, profit };
    });
    const tot = rows.reduce((acc, r) => ({ sales: acc.sales + r.sales, purchases: acc.purchases + r.purchases, expenses: acc.expenses + r.expenses, profit: acc.profit + r.profit }), { sales:0, purchases:0, expenses:0, profit:0 });
    return {
      title: "Daily Profit & Loss",
      columns: [
        { key: "date", label: "Date", type: "date" },
        { key: "sales", label: "Sales", type: "currency" },
        { key: "purchases", label: "Purchases (COGS)", type: "currency" },
        { key: "expenses", label: "Operating Expenses", type: "currency" },
        { key: "profit", label: "Net Profit", type: "currency" },
      ],
      rows,
      summary: [
        { label: "Total Sales", value: fmtMoney(tot.sales) },
        { label: "Total Purchases", value: fmtMoney(tot.purchases) },
        { label: "Total Expenses", value: fmtMoney(tot.expenses) },
        { label: "Net Profit (period)", value: fmtMoney(tot.profit) },
      ],
    };
  }
});

R({ key: "monthly-pnl", title: "Monthly P&L", category: "Financial", adminOnly: true,
  fetch: async ({ from, to }) => {
    const inv = await db.select().from(salesInvoicesTable)
      .where(and(gte(salesInvoicesTable.salesDate, from), lte(salesInvoicesTable.salesDate, to)));
    const exp = await db.select().from(expensesTable)
      .where(and(gte(expensesTable.expenseDate, from), lte(expensesTable.expenseDate, to)));
    const pur = await db.select().from(purchasesTable)
      .where(and(gte(purchasesTable.purchaseDate, from), lte(purchasesTable.purchaseDate, to)));
    const months = new Map<string, any>();
    function ensure(m: string) { if (!months.has(m)) months.set(m, { month: m, sales: 0, purchases: 0, expenses: 0, profit: 0 }); return months.get(m); }
    for (const i of inv) ensure(i.salesDate.substring(0,7)).sales += i.finalAmount;
    for (const p of pur) ensure(p.purchaseDate.substring(0,7)).purchases += (p.totalAmount||0);
    for (const e of exp) ensure(e.expenseDate.substring(0,7)).expenses += (e.totalAmount||0);
    months.forEach(r => r.profit = r.sales - r.purchases - r.expenses);
    const rows = Array.from(months.values()).sort((a,b) => a.month.localeCompare(b.month));
    return {
      title: "Monthly Profit & Loss",
      columns: [
        { key: "month", label: "Month", type: "text", width: 12 },
        { key: "sales", label: "Sales", type: "currency" },
        { key: "purchases", label: "Purchases", type: "currency" },
        { key: "expenses", label: "Expenses", type: "currency" },
        { key: "profit", label: "Net Profit", type: "currency" },
      ],
      rows,
      summary: [{ label: "Period Net Profit", value: fmtMoney(rows.reduce((s,r) => s + r.profit, 0)) }],
    };
  }
});

R({ key: "cash-flow", title: "Cash Flow Snapshot", category: "Financial", adminOnly: true,
  fetch: async ({ from, to }) => {
    const inv = await db.select().from(salesInvoicesTable)
      .where(and(gte(salesInvoicesTable.salesDate, from), lte(salesInvoicesTable.salesDate, to)));
    const cashIn = inv.reduce((s,i) => s + i.finalAmount, 0);
    const vp = await db.select().from(vendorPaymentsTable)
      .where(and(gte(vendorPaymentsTable.paymentDate, from), lte(vendorPaymentsTable.paymentDate, to)));
    const vendorOut = vp.reduce((s,p) => s + (p.totalAmount||0), 0);
    const exp = await db.select().from(expensesTable)
      .where(and(gte(expensesTable.expenseDate, from), lte(expensesTable.expenseDate, to)));
    const expOut = exp.reduce((s,e) => s + (e.totalAmount||0), 0);
    const sals = await db.select().from(salaryRecordsTable);
    const fromY = parseInt(from.substring(0,4)); const fromM = parseInt(from.substring(5,7));
    const toY = parseInt(to.substring(0,4)); const toM = parseInt(to.substring(5,7));
    const salPaid = sals.filter(r => { const v = r.year*12+r.month; return v >= fromY*12+fromM && v <= toY*12+toM && r.paymentStatus === "paid"; })
      .reduce((s,r) => s + (r.netSalary||0), 0);
    const totalOut = vendorOut + expOut + salPaid;
    const rows = [
      { item: "Sales Receipts", direction: "IN", amount: cashIn },
      { item: "Vendor Payments", direction: "OUT", amount: -vendorOut },
      { item: "Operating Expenses", direction: "OUT", amount: -expOut },
      { item: "Salary Disbursements", direction: "OUT", amount: -salPaid },
    ];
    return {
      title: "Cash Flow Snapshot",
      columns: [
        { key: "item", label: "Item", type: "text", width: 26 },
        { key: "direction", label: "Direction", type: "text" },
        { key: "amount", label: "Amount", type: "currency" },
      ],
      rows,
      summary: [
        { label: "Total Inflow", value: fmtMoney(cashIn) },
        { label: "Total Outflow", value: fmtMoney(totalOut) },
        { label: "Net Cash Flow", value: fmtMoney(cashIn - totalOut) },
      ],
    };
  }
});

R({ key: "gst-summary", title: "GST Summary (Output − Input)", category: "Financial", adminOnly: true,
  fetch: async ({ from, to }) => {
    const inv = await db.select().from(salesInvoicesTable)
      .where(and(gte(salesInvoicesTable.salesDate, from), lte(salesInvoicesTable.salesDate, to)));
    const pur = await db.select().from(purchasesTable)
      .where(and(gte(purchasesTable.purchaseDate, from), lte(purchasesTable.purchaseDate, to)));
    const months = new Map<string, any>();
    function ens(m: string) { if (!months.has(m)) months.set(m, { month: m, output: 0, input: 0, payable: 0 }); return months.get(m); }
    for (const i of inv) ens(i.salesDate.substring(0,7)).output += i.gstAmount || 0;
    for (const p of pur) ens(p.purchaseDate.substring(0,7)).input += p.taxAmount || 0;
    months.forEach(r => r.payable = r.output - r.input);
    const rows = Array.from(months.values()).sort((a,b) => a.month.localeCompare(b.month));
    return {
      title: "GST Summary",
      columns: [
        { key: "month", label: "Month", type: "text" },
        { key: "output", label: "Output GST (Sales)", type: "currency" },
        { key: "input", label: "Input GST (Purchases)", type: "currency" },
        { key: "payable", label: "Net Payable", type: "currency" },
      ],
      rows,
      summary: [{ label: "Period Net Payable", value: fmtMoney(rows.reduce((s,r) => s + r.payable, 0)) }],
    };
  }
});

// ============== OPERATIONAL ==============
R({ key: "waste-report", title: "Waste Report", category: "Operational",
  fetch: async ({ from, to }) => {
    const w = await db.select().from(wasteEntriesTable)
      .where(and(gte(wasteEntriesTable.wasteDate, from), lte(wasteEntriesTable.wasteDate, to)));
    const ings = await db.select().from(ingredientsTable);
    const ingMap = new Map(ings.map(i => [i.id, i]));
    const items = await db.select().from(menuItemsTable);
    const miMap = new Map(items.map(i => [i.id, i]));
    const rows = w.map(x => ({
      date: x.wasteDate, type: x.wasteType,
      item: x.ingredientId ? ingMap.get(x.ingredientId)?.name : (x.menuItemId ? miMap.get(x.menuItemId)?.name : "?"),
      qty: x.quantity, uom: x.uom, cost: x.costValue, reason: x.reason || "",
    })).sort((a,b) => b.date.localeCompare(a.date));
    return {
      title: "Waste Report",
      columns: [
        { key: "date", label: "Date", type: "date" },
        { key: "type", label: "Type", type: "text" },
        { key: "item", label: "Item", type: "text", width: 24 },
        { key: "qty", label: "Qty", type: "number" },
        { key: "uom", label: "UOM", type: "text" },
        { key: "cost", label: "Cost", type: "currency" },
        { key: "reason", label: "Reason", type: "text", width: 26 },
      ],
      rows,
      summary: [{ label: "Total Waste Cost", value: fmtMoney(rows.reduce((s,r) => s + (r.cost||0), 0)) }],
    };
  }
});

R({ key: "audit-log-report", title: "Audit Log Report", category: "Operational", adminOnly: true,
  fetch: async ({ from, to }) => {
    const fromDate = new Date(from); const toDate = new Date(to + "T23:59:59Z");
    const logs = await db.select().from(auditLogsTable)
      .where(and(gte(auditLogsTable.changedAt, fromDate), lte(auditLogsTable.changedAt, toDate)))
      .orderBy(desc(auditLogsTable.changedAt)).limit(2000);
    const rows = logs.map(l => ({
      time: l.changedAt.toISOString().replace("T"," ").substring(0,19),
      module: l.module, recordId: l.recordId, action: l.action, changedBy: l.changedBy || "",
    }));
    return {
      title: "Audit Log Report (latest 2000)",
      columns: [
        { key: "time", label: "Time", type: "text", width: 18 },
        { key: "module", label: "Module", type: "text" },
        { key: "recordId", label: "Record #", type: "number" },
        { key: "action", label: "Action", type: "text" },
        { key: "changedBy", label: "Changed By", type: "text" },
      ],
      rows,
    };
  }
});

R({ key: "trial-report", title: "Trial / R&D Report", category: "Operational",
  fetch: async () => {
    const trials = await db.select().from(trialsTable);
    const versions = await db.select().from(trialVersionsTable);
    const vByTrial = new Map<number, any[]>();
    for (const v of versions) { const a = vByTrial.get(v.trialId) || []; a.push(v); vByTrial.set(v.trialId, a); }
    const rows = trials.map(t => {
      const vs = vByTrial.get(t.id) || [];
      const latest = vs.sort((a,b) => b.versionNumber - a.versionNumber)[0];
      return {
        trialCode: t.trialCode, name: t.proposedItemName, status: t.status,
        targetCost: t.targetCost, versions: vs.length,
        latestCost: latest?.totalCost || 0, latestScore: latest?.tasteScore || 0,
        gap: latest && t.targetCost ? latest.totalCost - t.targetCost : 0,
      };
    }).sort((a,b) => a.trialCode.localeCompare(b.trialCode));
    return {
      title: "Trial / R&D Report",
      columns: [
        { key: "trialCode", label: "Trial #", type: "text" },
        { key: "name", label: "Proposed Item", type: "text", width: 24 },
        { key: "status", label: "Status", type: "text" },
        { key: "targetCost", label: "Target Cost", type: "currency" },
        { key: "versions", label: "Versions", type: "number" },
        { key: "latestCost", label: "Latest Cost", type: "currency" },
        { key: "latestScore", label: "Taste Score", type: "number" },
        { key: "gap", label: "Cost Gap vs Target", type: "currency" },
      ],
      rows,
    };
  }
});

R({ key: "customer-clv", title: "Customer Visit & Spend (CLV)", category: "Operational",
  fetch: async () => {
    const customers = await db.select().from(customersTable);
    const today = new Date();
    const rows = customers.map(c => {
      const lastVisit = c.lastVisitDate ? new Date(c.lastVisitDate) : null;
      const daysSince = lastVisit ? Math.floor((today.getTime() - lastVisit.getTime()) / (1000*60*60*24)) : null;
      const churnRisk = daysSince === null ? "Never visited" : daysSince <= 30 ? "Active" : daysSince <= 90 ? "At Risk" : "Churned";
      return {
        name: c.name, phone: c.phone, totalVisits: c.totalVisits, totalSpent: c.totalSpent,
        avgPerVisit: c.totalVisits > 0 ? c.totalSpent / c.totalVisits : 0,
        firstVisit: c.firstVisitDate || "", lastVisit: c.lastVisitDate || "",
        daysSince: daysSince ?? "—", churnRisk,
      };
    }).sort((a,b) => b.totalSpent - a.totalSpent);
    return {
      title: "Customer Visit & Spend (CLV)",
      columns: [
        { key: "name", label: "Customer", type: "text", width: 22 },
        { key: "phone", label: "Phone", type: "text", width: 14 },
        { key: "totalVisits", label: "Visits", type: "number" },
        { key: "totalSpent", label: "Total Spent", type: "currency" },
        { key: "avgPerVisit", label: "Avg / Visit", type: "currency" },
        { key: "firstVisit", label: "First Visit", type: "date" },
        { key: "lastVisit", label: "Last Visit", type: "date" },
        { key: "daysSince", label: "Days Since", type: "number" },
        { key: "churnRisk", label: "Status", type: "text" },
      ],
      rows,
      summary: [
        { label: "Active customers", value: rows.filter(r => r.churnRisk === "Active").length },
        { label: "At-risk customers", value: rows.filter(r => r.churnRisk === "At Risk").length },
        { label: "Churned customers", value: rows.filter(r => r.churnRisk === "Churned").length },
      ],
    };
  }
});

// ---------- DISPATCH ENDPOINTS ----------
async function userCanViewReport(req: Request, def: { adminOnly?: boolean; category: string }): Promise<boolean> {
  const role = (req as any).userRole as string | undefined;
  if (!role) return false;
  if (role === "admin" || role === "owner") return true;
  const perms = await getEffectivePermissionsForRole(role);
  const baseOk = perms.includes("reports.view");
  const isFinancial = !!def.adminOnly || def.category === "Financial";
  if (isFinancial) return baseOk && perms.includes("reports.financial");
  return baseOk;
}

router.get("/reports/registry", authMiddleware, requirePermission("reports.view"), async (req: Request, res: Response): Promise<void> => {
  const role = (req as any).userRole as string | undefined;
  const isAdmin = role === "admin" || role === "owner";
  const perms = isAdmin ? null : await getEffectivePermissionsForRole(role || "");
  const hasFinancial = isAdmin || (perms || []).includes("reports.financial");
  const list = REPORTS
    .filter(r => {
      const financialFlagged = !!r.adminOnly || r.category === "Financial";
      return !financialFlagged || hasFinancial;
    })
    .map(r => ({ key: r.key, title: r.title, category: r.category, adminOnly: !!r.adminOnly }));
  res.json(list);
});

router.get("/reports/run/:key", authMiddleware, requirePermission("reports.view"), async (req: Request, res: Response): Promise<void> => {
  const def = REPORTS.find(r => r.key === req.params.key);
  if (!def) { res.status(404).json({ error: "Report not found" }); return; }
  if (!(await userCanViewReport(req, def))) { res.status(403).json({ error: "Permission required: reports.financial" }); return; }

  const today = getToday();
  const from = isValidDate(req.query.from as string) ? (req.query.from as string) : todayMinus(30);
  const to = isValidDate(req.query.to as string) ? (req.query.to as string) : today;
  const format = (req.query.format as string) || "json";

  let result: ReportResult;
  try {
    result = await def.fetch({ from, to, ...req.query });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Report failed" });
    return;
  }

  const periodLabel = from === to ? `Date: ${from}` : `Period: ${from} → ${to}`;

  if (format === "xlsx") {
    const buf = await generateXlsx(result, periodLabel);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${def.key}_${from}_${to}.xlsx"`);
    res.send(buf);
    return;
  }
  if (format === "pdf") {
    const buf = await generatePdf(result, periodLabel);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${def.key}_${from}_${to}.pdf"`);
    res.send(buf);
    return;
  }
  res.json({ ...result, period: { from, to, label: periodLabel } });
});

// ---------- LEGACY EXPORTS / SPECIFIC REPORTS (kept for backward compat) ----------
function getDateRange(period: string, fromDate?: string, toDate?: string): { from: string; to: string } {
  const today = getToday();
  const ref = (fromDate && isValidDate(fromDate)) ? fromDate : today;
  if (period === "daily") return { from: ref, to: ref };
  if (period === "weekly") {
    const d = new Date(ref); const day = d.getUTCDay();
    const monOff = day === 0 ? -6 : 1 - day;
    const mon = new Date(d); mon.setUTCDate(d.getUTCDate() + monOff);
    const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
    return { from: mon.toISOString().split("T")[0], to: sun.toISOString().split("T")[0] };
  }
  if (period === "monthly") return { from: monthStart(ref), to: monthEnd(ref) };
  if (period === "custom") return { from: ref, to: (toDate && isValidDate(toDate)) ? toDate : today };
  return { from: ref, to: (toDate && isValidDate(toDate)) ? toDate : today };
}

router.get("/reports/item-profitability", authMiddleware, requirePermission("reports.financial"), async (req, res): Promise<void> => {
  const period = (req.query.period as string) || "monthly";
  const { from, to } = getDateRange(period, req.query.fromDate as string, req.query.toDate as string);
  const inv = await db.select({ id: salesInvoicesTable.id }).from(salesInvoicesTable)
    .where(and(gte(salesInvoicesTable.salesDate, from), lte(salesInvoicesTable.salesDate, to)));
  const itemMap = new Map<number, { quantitySold: number; revenue: number; grossSales: number; totalDiscount: number }>();
  if (inv.length > 0) {
    const ids = inv.map(i => i.id);
    const lines = await db.select({
      menuItemId: salesInvoiceLinesTable.menuItemId, quantity: salesInvoiceLinesTable.quantity,
      grossLineAmount: salesInvoiceLinesTable.grossLineAmount, lineDiscountAmount: salesInvoiceLinesTable.lineDiscountAmount,
      finalLineAmount: salesInvoiceLinesTable.finalLineAmount,
    }).from(salesInvoiceLinesTable).where(sql`${salesInvoiceLinesTable.invoiceId} IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)})`);
    for (const l of lines) {
      if (!l.menuItemId) continue;
      const e = itemMap.get(l.menuItemId) || { quantitySold: 0, revenue: 0, grossSales: 0, totalDiscount: 0 };
      e.quantitySold += l.quantity; e.revenue += l.finalLineAmount; e.grossSales += l.grossLineAmount; e.totalDiscount += l.lineDiscountAmount;
      itemMap.set(l.menuItemId, e);
    }
  }
  const allMenuItems = await db.select().from(menuItemsTable).where(eq(menuItemsTable.active, true));
  const result = [];
  for (const menuItem of allMenuItems) {
    const recipeLines = await db.select().from(recipeLinesTable).where(eq(recipeLinesTable.menuItemId, menuItem.id));
    let unitCost = 0;
    for (const line of recipeLines) {
      const [ing] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, line.ingredientId));
      if (ing) {
        const netQty = line.quantity * (1 + (line.wastagePercent || 0) / 100);
        unitCost += (ing.weightedAvgCost / (ing.conversionFactor || 1)) * netQty;
      }
    }
    const sd = itemMap.get(menuItem.id);
    const quantitySold = sd?.quantitySold || 0;
    const revenue = sd?.revenue || 0;
    const totalProductionCost = unitCost * quantitySold;
    const grossProfit = revenue - totalProductionCost;
    result.push({
      menuItemId: menuItem.id, menuItemName: menuItem.name, sellingPrice: menuItem.sellingPrice,
      unitProductionCost: Math.round(unitCost * 100) / 100, quantitySold,
      grossSales: sd?.grossSales || 0, totalDiscount: sd?.totalDiscount || 0, netRevenue: revenue,
      totalProductionCost: Math.round(totalProductionCost * 100) / 100,
      grossProfit: Math.round(grossProfit * 100) / 100,
      marginPercent: revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0,
      costToSaleRatio: menuItem.sellingPrice > 0 ? Math.round((unitCost / menuItem.sellingPrice) * 1000) / 10 : 0,
    });
  }
  res.json({ period, fromDate: from, toDate: to, items: result.sort((a,b) => b.netRevenue - a.netRevenue),
    summary: {
      totalRevenue: result.reduce((s,i) => s + i.netRevenue, 0),
      totalProductionCost: Math.round(result.reduce((s,i) => s + i.totalProductionCost, 0) * 100) / 100,
      totalGrossProfit: Math.round(result.reduce((s,i) => s + i.grossProfit, 0) * 100) / 100,
      avgMarginPercent: (() => { const r = result.reduce((s,i) => s + i.netRevenue, 0); const p = result.reduce((s,i) => s + i.grossProfit, 0); return r > 0 ? Math.round((p/r)*1000)/10 : 0; })(),
      totalItemsSold: result.reduce((s,i) => s + i.quantitySold, 0),
    },
  });
});

export default router;
