import { Router, type IRouter } from "express";
import { eq, and, ilike, sql } from "drizzle-orm";
import { db, vendorsTable, categoriesTable, purchasesTable, purchaseLinesTable, ingredientVendorMappingTable } from "@workspace/db";
import { ListVendorsResponse, CreateVendorBody, GetVendorParams, GetVendorResponse, UpdateVendorParams, UpdateVendorBody, GetVendorSpendSummaryParams, GetVendorSpendSummaryResponse } from "@workspace/api-zod";
import { authMiddleware } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { generateCode } from "../lib/codeGenerator";

const router: IRouter = Router();

router.get("/vendors", async (req, res): Promise<void> => {
  const vendors = await db
    .select({
      id: vendorsTable.id,
      code: vendorsTable.code,
      name: vendorsTable.name,
      categoryId: vendorsTable.categoryId,
      categoryName: categoriesTable.name,
      contactPerson: vendorsTable.contactPerson,
      mobile: vendorsTable.mobile,
      email: vendorsTable.email,
      address: vendorsTable.address,
      gstNumber: vendorsTable.gstNumber,
      paymentTerms: vendorsTable.paymentTerms,
      creditDays: vendorsTable.creditDays,
      preferred: vendorsTable.preferred,
      active: vendorsTable.active,
      remarks: vendorsTable.remarks,
      createdAt: vendorsTable.createdAt,
    })
    .from(vendorsTable)
    .leftJoin(categoriesTable, eq(vendorsTable.categoryId, categoriesTable.id));

  res.json(ListVendorsResponse.parse(vendors));
});

router.post("/vendors", authMiddleware, async (req, res): Promise<void> => {
  const parsed = CreateVendorBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const code = await generateCode("VND", "vendors");
  const [vendor] = await db.insert(vendorsTable).values({ ...parsed.data, code }).returning();
  await createAuditLog("vendors", vendor.id, "create", null, vendor);
  res.status(201).json({ ...vendor, categoryName: null });
});

router.get("/vendors/:id", async (req, res): Promise<void> => {
  const params = GetVendorParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [vendor] = await db
    .select({
      id: vendorsTable.id,
      code: vendorsTable.code,
      name: vendorsTable.name,
      categoryId: vendorsTable.categoryId,
      categoryName: categoriesTable.name,
      contactPerson: vendorsTable.contactPerson,
      mobile: vendorsTable.mobile,
      email: vendorsTable.email,
      address: vendorsTable.address,
      gstNumber: vendorsTable.gstNumber,
      paymentTerms: vendorsTable.paymentTerms,
      creditDays: vendorsTable.creditDays,
      preferred: vendorsTable.preferred,
      active: vendorsTable.active,
      remarks: vendorsTable.remarks,
      createdAt: vendorsTable.createdAt,
    })
    .from(vendorsTable)
    .leftJoin(categoriesTable, eq(vendorsTable.categoryId, categoriesTable.id))
    .where(eq(vendorsTable.id, params.data.id));

  if (!vendor) { res.status(404).json({ error: "Not found" }); return; }
  res.json(GetVendorResponse.parse(vendor));
});

router.patch("/vendors/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = UpdateVendorParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateVendorBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [old] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, params.data.id));
  const [vendor] = await db.update(vendorsTable).set(parsed.data).where(eq(vendorsTable.id, params.data.id)).returning();
  if (!vendor) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("vendors", vendor.id, "update", old, vendor);
  res.json({ ...vendor, categoryName: null });
});

router.delete("/vendors/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = UpdateVendorParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [vendor] = await db.delete(vendorsTable).where(eq(vendorsTable.id, params.data.id)).returning();
  if (!vendor) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("vendors", vendor.id, "delete", vendor, null);
  res.json({ success: true });
});

router.get("/vendors/:id/spend-summary", async (req, res): Promise<void> => {
  const params = GetVendorSpendSummaryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const purchases = await db.select().from(purchasesTable).where(eq(purchasesTable.vendorId, params.data.id));
  const mappings = await db.select().from(ingredientVendorMappingTable).where(eq(ingredientVendorMappingTable.vendorId, params.data.id));

  const totalSpend = purchases.reduce((sum, p) => sum + p.totalAmount, 0);
  const lastPurchase = purchases.length > 0 ? purchases.sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))[0].purchaseDate : null;

  res.json(GetVendorSpendSummaryResponse.parse({
    vendorId: params.data.id,
    totalSpend,
    purchaseCount: purchases.length,
    ingredientCount: mappings.length,
    lastPurchaseDate: lastPurchase,
  }));
});

export default router;
