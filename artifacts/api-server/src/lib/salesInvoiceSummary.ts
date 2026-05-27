import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, salesInvoicesTable } from "@workspace/db";
import { round2, type SalesInvoiceSummary } from "./salesInvoiceSummaryMath";

export type SalesInvoiceFilterInput = {
  fromDate?: string | null;
  toDate?: string | null;
  sourceType?: string | null;
  orderType?: string | null;
  matchStatus?: string | null;
  date?: string | null;
};

export function buildSalesInvoiceWhere(input: SalesInvoiceFilterInput) {
  const conditions: any[] = [];
  if (input.fromDate) conditions.push(gte(salesInvoicesTable.salesDate, input.fromDate));
  if (input.toDate) conditions.push(lte(salesInvoicesTable.salesDate, input.toDate));
  if (input.sourceType) conditions.push(eq(salesInvoicesTable.sourceType, input.sourceType));
  if (input.orderType) conditions.push(eq(salesInvoicesTable.orderType, input.orderType));
  if (input.matchStatus) conditions.push(eq(salesInvoicesTable.matchStatus, input.matchStatus));
  if (input.date) conditions.push(eq(salesInvoicesTable.salesDate, input.date));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function getSalesInvoiceSummary(input: SalesInvoiceFilterInput): Promise<SalesInvoiceSummary> {
  const whereClause = buildSalesInvoiceWhere(input);
  const query = db.select({
    count: sql<number>`count(*)::int`,
    gross: sql<number>`coalesce(sum(${salesInvoicesTable.grossAmount}), 0)::float`,
    discount: sql<number>`coalesce(sum(${salesInvoicesTable.totalDiscount}), 0)::float`,
    gst: sql<number>`coalesce(sum(${salesInvoicesTable.gstAmount}), 0)::float`,
    final: sql<number>`coalesce(sum(${salesInvoicesTable.finalAmount}), 0)::float`,
    mismatched: sql<number>`coalesce(sum(case when ${salesInvoicesTable.matchStatus} = 'mismatched' then 1 else 0 end), 0)::int`,
  }).from(salesInvoicesTable);

  const [row] = whereClause ? await query.where(whereClause) : await query;
  return {
    count: Number(row?.count || 0),
    gross: round2(Number(row?.gross || 0)),
    discount: round2(Number(row?.discount || 0)),
    gst: round2(Number(row?.gst || 0)),
    final: round2(Number(row?.final || 0)),
    mismatched: Number(row?.mismatched || 0),
  };
}
