import { eq, sql } from "drizzle-orm";
import { db, customersTable, salesInvoicesTable } from "@workspace/db";

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  const trimmed = digits.length > 10 ? digits.slice(-10) : digits;
  if (trimmed.length !== 10) return null;
  return trimmed;
}

export async function upsertCustomerFromInvoice(args: {
  customerName: string | null;
  customerPhone: string | null;
  salesDate: string;
  finalAmount: number;
}): Promise<{ customerId: number | null; customerPhone: string | null }> {
  const phone = normalizePhone(args.customerPhone);
  if (!phone) return { customerId: null, customerPhone: null };

  const [existing] = await db.select().from(customersTable).where(eq(customersTable.phone, phone));
  if (existing) {
    return { customerId: existing.id, customerPhone: phone };
  }

  const [created] = await db.insert(customersTable).values({
    name: args.customerName?.trim() || `Guest ${phone.slice(-4)}`,
    phone,
  }).returning();
  return { customerId: created.id, customerPhone: phone };
}

export async function recomputeCustomerStats(customerId: number): Promise<void> {
  const rows = await db.select({
    visits: sql<number>`count(*)::int`,
    spent: sql<number>`coalesce(sum(${salesInvoicesTable.finalAmount}), 0)::float`,
    firstDate: sql<string | null>`min(${salesInvoicesTable.salesDate})`,
    lastDate: sql<string | null>`max(${salesInvoicesTable.salesDate})`,
  }).from(salesInvoicesTable).where(eq(salesInvoicesTable.customerId, customerId));

  const r = rows[0];
  await db.update(customersTable).set({
    totalVisits: r?.visits || 0,
    totalSpent: r?.spent || 0,
    firstVisitDate: r?.firstDate || null,
    lastVisitDate: r?.lastDate || null,
  }).where(eq(customersTable.id, customerId));
}
