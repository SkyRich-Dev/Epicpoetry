import { Router, type IRouter } from "express";
import { eq, and, gte, lte, desc, sql, ilike, or, isNotNull } from "drizzle-orm";
import {
  db, customersTable, salesInvoicesTable, salesInvoiceLinesTable, menuItemsTable,
} from "@workspace/db";
import { authMiddleware, adminOnly } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { recomputeCustomerStats, normalizePhone } from "../lib/customers";

const router: IRouter = Router();

router.get("/customers", authMiddleware, async (req, res): Promise<void> => {
  const search = (req.query.search as string)?.trim();
  const segment = req.query.segment as string;

  const where: any[] = [];
  if (search) where.push(or(ilike(customersTable.name, `%${search}%`), ilike(customersTable.phone, `%${search}%`)));

  let rows = where.length
    ? await db.select().from(customersTable).where(and(...where)).orderBy(desc(customersTable.lastVisitDate))
    : await db.select().from(customersTable).orderBy(desc(customersTable.lastVisitDate));

  const today = new Date();
  const daysAgo = (d: string | null) => d ? Math.floor((today.getTime() - new Date(d).getTime()) / (1000 * 60 * 60 * 24)) : 9999;

  const enriched = rows.map(c => {
    const recency = daysAgo(c.lastVisitDate);
    let seg: string;
    if (c.totalVisits === 0) seg = "new";
    else if (c.totalSpent >= 5000 || c.totalVisits >= 10) seg = "high_value";
    else if (recency > 60) seg = "inactive";
    else if (c.totalVisits >= 4) seg = "frequent";
    else if (c.totalVisits === 1) seg = "new";
    else seg = "regular";
    return {
      ...c,
      avgOrderValue: c.totalVisits > 0 ? Math.round((c.totalSpent / c.totalVisits) * 100) / 100 : 0,
      daysSinceLastVisit: recency === 9999 ? null : recency,
      segment: seg,
    };
  });

  const filtered = segment ? enriched.filter(e => e.segment === segment) : enriched;
  res.json(filtered);
});

router.get("/customers/:id", authMiddleware, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [c] = await db.select().from(customersTable).where(eq(customersTable.id, id));
  if (!c) { res.status(404).json({ error: "Not found" }); return; }

  const invoices = await db.select().from(salesInvoicesTable)
    .where(eq(salesInvoicesTable.customerId, id))
    .orderBy(desc(salesInvoicesTable.salesDate));

  const invoiceIds = invoices.map(i => i.id);

  let topItems: any[] = [];
  let timePattern = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  let preferredPaymentMode = "—";
  let preferredOrderType = "—";

  if (invoiceIds.length > 0) {
    const lines = await db.select({
      menuItemId: salesInvoiceLinesTable.menuItemId,
      itemName: menuItemsTable.name,
      quantity: salesInvoiceLinesTable.quantity,
      finalLineAmount: salesInvoiceLinesTable.finalLineAmount,
    }).from(salesInvoiceLinesTable)
      .leftJoin(menuItemsTable, eq(salesInvoiceLinesTable.menuItemId, menuItemsTable.id))
      .where(sql`${salesInvoiceLinesTable.invoiceId} IN (${sql.join(invoiceIds.map(i => sql`${i}`), sql`, `)})`);

    const itemMap = new Map<number, { itemId: number; itemName: string; qty: number; spend: number }>();
    for (const l of lines) {
      const e = itemMap.get(l.menuItemId);
      if (e) { e.qty += l.quantity; e.spend += l.finalLineAmount; }
      else itemMap.set(l.menuItemId, { itemId: l.menuItemId, itemName: l.itemName || "—", qty: l.quantity, spend: l.finalLineAmount });
    }
    topItems = Array.from(itemMap.values()).sort((a, b) => b.qty - a.qty).slice(0, 3).map(x => ({
      ...x, qty: Math.round(x.qty * 100) / 100, spend: Math.round(x.spend * 100) / 100,
    }));

    const payCount = new Map<string, number>();
    const orderCount = new Map<string, number>();
    for (const inv of invoices) {
      payCount.set(inv.paymentMode, (payCount.get(inv.paymentMode) || 0) + 1);
      orderCount.set(inv.orderType, (orderCount.get(inv.orderType) || 0) + 1);
      if (inv.invoiceTime) {
        const h = parseInt(inv.invoiceTime.split(":")[0], 10);
        if (!isNaN(h)) {
          if (h >= 5 && h < 12) timePattern.morning++;
          else if (h < 17) timePattern.afternoon++;
          else if (h < 21) timePattern.evening++;
          else timePattern.night++;
        }
      }
    }
    preferredPaymentMode = [...payCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
    preferredOrderType = [...orderCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  }

  res.json({
    ...c,
    avgOrderValue: c.totalVisits > 0 ? Math.round((c.totalSpent / c.totalVisits) * 100) / 100 : 0,
    topItems,
    timePattern,
    preferredPaymentMode,
    preferredOrderType,
    visits: invoices.map(i => ({
      id: i.id, invoiceNo: i.invoiceNo, salesDate: i.salesDate, invoiceTime: i.invoiceTime,
      finalAmount: i.finalAmount, orderType: i.orderType, paymentMode: i.paymentMode,
    })),
  });
});

router.post("/customers", authMiddleware, async (req, res): Promise<void> => {
  const { name, phone, email, birthday, anniversary, notes } = req.body;
  const normPhone = normalizePhone(phone);
  if (!name || !normPhone) { res.status(400).json({ error: "Name and valid 10-digit phone required" }); return; }

  const [existing] = await db.select().from(customersTable).where(eq(customersTable.phone, normPhone));
  if (existing) { res.status(409).json({ error: "Customer with this phone already exists", customerId: existing.id }); return; }

  const [created] = await db.insert(customersTable).values({
    name: String(name).trim(), phone: normPhone, email: email || null,
    birthday: birthday || null, anniversary: anniversary || null, notes: notes || null,
  }).returning();
  await createAuditLog("customers", created.id, "create", null, created);
  res.status(201).json(created);
});

router.patch("/customers/:id", authMiddleware, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(customersTable).where(eq(customersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const updates: any = {};
  for (const f of ["name", "email", "birthday", "anniversary", "notes"]) {
    if (req.body[f] !== undefined) updates[f] = req.body[f] || null;
  }
  if (req.body.phone !== undefined) {
    const np = normalizePhone(req.body.phone);
    if (!np) { res.status(400).json({ error: "Invalid phone — must be 10 digits" }); return; }
    if (np !== existing.phone) {
      const [dupe] = await db.select().from(customersTable).where(eq(customersTable.phone, np));
      if (dupe && dupe.id !== id) { res.status(409).json({ error: "Another customer already uses this phone", customerId: dupe.id }); return; }
    }
    updates.phone = np;
  }

  const [updated] = await db.update(customersTable).set(updates).where(eq(customersTable.id, id)).returning();
  await createAuditLog("customers", id, "update", existing, updated);
  res.json(updated);
});

router.delete("/customers/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(customersTable).where(eq(customersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  await db.update(salesInvoicesTable).set({ customerId: null }).where(eq(salesInvoicesTable.customerId, id));
  await db.delete(customersTable).where(eq(customersTable.id, id));
  await createAuditLog("customers", id, "delete", existing, null);
  res.json({ success: true });
});

router.post("/customers/recompute-all", authMiddleware, adminOnly, async (_req, res): Promise<void> => {
  const linkRows = await db.select({
    phone: salesInvoicesTable.customerPhone,
    name: salesInvoicesTable.customerName,
    customerId: salesInvoicesTable.customerId,
    id: salesInvoicesTable.id,
  }).from(salesInvoicesTable).where(isNotNull(salesInvoicesTable.customerPhone));

  let linked = 0, created = 0;
  for (const inv of linkRows) {
    const phone = normalizePhone(inv.phone);
    if (!phone) continue;
    let [cust] = await db.select().from(customersTable).where(eq(customersTable.phone, phone));
    if (!cust) {
      [cust] = await db.insert(customersTable).values({
        name: inv.name?.trim() || `Guest ${phone.slice(-4)}`, phone,
      }).returning();
      created++;
    }
    if (inv.customerId !== cust.id) {
      await db.update(salesInvoicesTable).set({ customerId: cust.id }).where(eq(salesInvoicesTable.id, inv.id));
      linked++;
    }
  }

  const allCustomers = await db.select({ id: customersTable.id }).from(customersTable);
  for (const c of allCustomers) await recomputeCustomerStats(c.id);

  res.json({ created, linked, customers: allCustomers.length });
});

router.get("/customers/reminders/upcoming", authMiddleware, async (req, res): Promise<void> => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 60);
  const all = await db.select().from(customersTable);
  const today = new Date();
  const todayMD = (today.getMonth() + 1) * 100 + today.getDate();

  function daysUntilMD(dateStr: string | null): number | null {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const md = (d.getMonth() + 1) * 100 + d.getDate();
    let diff = md - todayMD;
    if (diff < 0) {
      const next = new Date(today.getFullYear() + 1, d.getMonth(), d.getDate());
      diff = Math.floor((next.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / (1000 * 60 * 60 * 24));
    }
    return diff;
  }

  const birthdays: any[] = [];
  const anniversaries: any[] = [];
  for (const c of all) {
    const bd = daysUntilMD(c.birthday);
    const ad = daysUntilMD(c.anniversary);
    if (bd !== null && bd <= days) birthdays.push({ ...c, daysUntil: bd });
    if (ad !== null && ad <= days) anniversaries.push({ ...c, daysUntil: ad });
  }
  birthdays.sort((a, b) => a.daysUntil - b.daysUntil);
  anniversaries.sort((a, b) => a.daysUntil - b.daysUntil);
  res.json({ birthdays, anniversaries });
});

export default router;
