import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer, { MulterError } from "multer";
import * as XLSX from "xlsx";
import { eq } from "drizzle-orm";
import {
  db,
  salesInvoicesTable,
  salesInvoiceLinesTable,
  menuItemsTable,
  recipeLinesTable,
  categoriesTable,
  purchasesTable,
  purchaseLinesTable,
  vendorsTable,
  ingredientsTable,
  expensesTable,
  salesImportBatchesTable,
} from "@workspace/db";
import { authMiddleware, adminOnly } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { isFutureDate, getTodayISO } from "../lib/dateValidation";
import { generateCode } from "../lib/codeGenerator";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const ALLOWED_MIMES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.toLowerCase();
    if (!ext.endsWith(".xlsx") && !ext.endsWith(".xls")) {
      return cb(new Error("Only .xlsx and .xls files are allowed"));
    }
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      return cb(new Error("Invalid file type"));
    }
    cb(null, true);
  },
});

function handleUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err: any) => {
    if (err instanceof MulterError) {
      res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "File too large (max 5MB)" : err.message });
      return;
    }
    if (err) {
      res.status(400).json({ error: err.message || "File upload error" });
      return;
    }
    next();
  });
}

function parseExcel(buffer: Buffer): Record<string, any>[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_]+/g, "_");
}

function normalizeRow(row: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(row)) {
    result[normalizeKey(key)] = val;
  }
  return result;
}

function toNum(val: any): number {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

function toDateStr(val: any): string {
  if (!val) return new Date().toISOString().split("T")[0];
  if (typeof val === "number") {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) {
      return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    }
  }
  const str = String(val).trim();
  const iso = new Date(str);
  if (!isNaN(iso.getTime())) return iso.toISOString().split("T")[0];
  return new Date().toISOString().split("T")[0];
}

function safeErrorMessage(e: any): string {
  if (e && typeof e.message === "string") {
    if (e.message.includes("duplicate key") || e.message.includes("violates")) return "Duplicate or constraint violation";
    if (e.message.includes("connection") || e.message.includes("timeout")) return "Database connection issue";
  }
  return "Processing error";
}

function safeParseFile(buffer: Buffer): { rows: Record<string, any>[]; error?: string } {
  try {
    const rows = parseExcel(buffer);
    return { rows };
  } catch (e: any) {
    logger.error({ err: e }, "Excel parse error");
    return { rows: [], error: "Could not parse Excel file. Ensure it is a valid .xlsx or .xls file." };
  }
}

router.post("/upload/purchases", authMiddleware, handleUpload, async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const { rows, error } = safeParseFile(req.file.buffer);
  if (error) { res.status(400).json({ error }); return; }
  if (rows.length === 0) { res.status(400).json({ error: "Empty file or no data rows found" }); return; }

  const vendors = await db.select().from(vendorsTable);
  const vendorByName = new Map(vendors.map(v => [v.name.toLowerCase().trim(), v]));
  const vendorById = new Map(vendors.map(v => [v.id, v]));
  const ingredients = await db.select().from(ingredientsTable);
  const ingByName = new Map(ingredients.map(i => [i.name.toLowerCase().trim(), i]));
  const ingById = new Map(ingredients.map(i => [i.id, i]));

  const grouped = new Map<string, { vendorId: number; date: string; invoice?: string; paymentMode?: string; lines: any[] }>();
  const results: { row: number; status: string; error?: string; data?: any }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = normalizeRow(rows[i]);
    try {
      const purchaseDate = toDateStr(raw.date || raw.purchase_date);
      if (isFutureDate(purchaseDate)) { results.push({ row: i + 2, status: "error", error: `Date cannot be in the future (${purchaseDate}). Today is ${getTodayISO()}.` }); continue; }
      const vendorName = String(raw.vendor || raw.vendor_name || "").trim();
      const vendorId = toNum(raw.vendor_id);
      const ingredientName = String(raw.ingredient || raw.ingredient_name || raw.item || raw.item_name || "").trim();
      const ingredientId = toNum(raw.ingredient_id);
      const quantity = toNum(raw.quantity || raw.qty);
      const unitRate = toNum(raw.rate || raw.unit_rate || raw.price || raw.unit_price);
      const taxPercent = toNum(raw.tax || raw.tax_percent || raw.tax_pct || 0);
      const purchaseUom = String(raw.uom || raw.unit || "unit").trim();
      const invoice = String(raw.invoice || raw.invoice_number || raw.invoice_no || "").trim();
      const paymentMode = String(raw.payment_mode || raw.payment || "cash").trim();

      let vendor = vendorId ? vendorById.get(vendorId) : undefined;
      if (!vendor && vendorName) vendor = vendorByName.get(vendorName.toLowerCase());
      if (!vendor) { results.push({ row: i + 2, status: "error", error: `Vendor not found: "${vendorName || vendorId}"` }); continue; }

      let ing = ingredientId ? ingById.get(ingredientId) : undefined;
      if (!ing && ingredientName) ing = ingByName.get(ingredientName.toLowerCase());
      if (!ing) { results.push({ row: i + 2, status: "error", error: `Ingredient not found: "${ingredientName || ingredientId}"` }); continue; }

      if (quantity <= 0) { results.push({ row: i + 2, status: "error", error: "Quantity must be > 0" }); continue; }
      if (unitRate <= 0) { results.push({ row: i + 2, status: "error", error: "Unit rate must be > 0" }); continue; }

      const groupKey = `${vendor.id}_${purchaseDate}_${invoice}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, { vendorId: vendor.id, date: purchaseDate, invoice: invoice || undefined, paymentMode, lines: [] });
      }
      grouped.get(groupKey)!.lines.push({ ingredientId: ing.id, ingredientName: ing.name, quantity, purchaseUom, unitRate, taxPercent, rowIndex: i + 2 });
    } catch (e: any) {
      logger.error({ err: e, row: i + 2 }, "Purchase upload row parse error");
      results.push({ row: i + 2, status: "error", error: safeErrorMessage(e) });
    }
  }

  let successCount = 0;

  for (const [, group] of grouped) {
    try {
      await db.transaction(async (tx) => {
        const purchaseNumber = await generateCode("PUR", "purchases");
        let totalAmount = 0;

        const [purchase] = await tx.insert(purchasesTable).values({
          purchaseNumber,
          purchaseDate: group.date,
          vendorId: group.vendorId,
          invoiceNumber: group.invoice,
          paymentMode: group.paymentMode,
          paymentStatus: "pending",
          totalAmount: 0,
        }).returning();

        for (const line of group.lines) {
          const lineTotal = line.quantity * line.unitRate * (1 + line.taxPercent / 100);
          totalAmount += lineTotal;

          await tx.insert(purchaseLinesTable).values({
            purchaseId: purchase.id,
            ingredientId: line.ingredientId,
            quantity: line.quantity,
            purchaseUom: line.purchaseUom,
            unitRate: line.unitRate,
            taxPercent: line.taxPercent,
            lineTotal,
          });

          const [ing] = await tx.select().from(ingredientsTable).where(eq(ingredientsTable.id, line.ingredientId));
          if (ing) {
            const newStock = ing.currentStock + line.quantity;
            const oldTotal = ing.weightedAvgCost * ing.currentStock;
            const newTotal = oldTotal + line.unitRate * line.quantity;
            const newAvg = newStock > 0 ? newTotal / newStock : line.unitRate;
            await tx.update(ingredientsTable).set({
              currentStock: newStock,
              latestCost: line.unitRate,
              weightedAvgCost: newAvg,
            }).where(eq(ingredientsTable.id, line.ingredientId));
          }

          successCount++;
          results.push({ row: line.rowIndex, status: "success", data: { purchaseNumber, ingredient: line.ingredientName, quantity: line.quantity, lineTotal } });
        }

        await tx.update(purchasesTable).set({ totalAmount }).where(eq(purchasesTable.id, purchase.id));
        await createAuditLog("purchases", purchase.id, "create", null, { purchaseNumber, totalAmount });
      });
    } catch (e: any) {
      logger.error({ err: e }, "Purchase group transaction error");
      for (const line of group.lines) {
        const existing = results.find(r => r.row === line.rowIndex);
        if (existing && existing.status === "success") {
          existing.status = "error";
          existing.error = "Transaction failed — entire purchase group rolled back";
          delete existing.data;
          successCount--;
        }
      }
    }
  }

  res.json({ totalRows: rows.length, successCount, errorCount: rows.length - successCount, results });
});

router.post("/upload/expenses", authMiddleware, handleUpload, async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const { rows, error } = safeParseFile(req.file.buffer);
  if (error) { res.status(400).json({ error }); return; }
  if (rows.length === 0) { res.status(400).json({ error: "Empty file or no data rows found" }); return; }

  const results: { row: number; status: string; error?: string; data?: any }[] = [];
  let successCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const raw = normalizeRow(rows[i]);
    try {
      const expenseDate = toDateStr(raw.date || raw.expense_date);
      if (isFutureDate(expenseDate)) { results.push({ row: i + 2, status: "error", error: `Date cannot be in the future (${expenseDate}). Today is ${getTodayISO()}.` }); continue; }
      const costType = String(raw.cost_type || raw.type || "fixed").toLowerCase().trim();
      const category = String(raw.category || "").trim();
      const description = String(raw.description || raw.desc || raw.details || "").trim();
      const amount = toNum(raw.amount || raw.base_amount);
      const taxAmount = toNum(raw.tax || raw.tax_amount || 0);
      const totalAmount = amount + taxAmount;
      const paymentMode = String(raw.payment_mode || raw.payment || "cash").trim();
      const paidBy = String(raw.paid_by || "").trim() || undefined;

      if (!description && !category) { results.push({ row: i + 2, status: "error", error: "Description or category is required" }); continue; }
      if (amount <= 0) { results.push({ row: i + 2, status: "error", error: "Amount must be > 0" }); continue; }
      if (!["fixed", "variable", "semi_variable"].includes(costType)) {
        results.push({ row: i + 2, status: "error", error: `Invalid cost_type. Use fixed, variable, or semi_variable` }); continue;
      }

      const expenseNumber = await generateCode("EXP", "expenses");
      const [expense] = await db.insert(expensesTable).values({
        expenseNumber,
        expenseDate,
        amount,
        taxAmount,
        totalAmount,
        paymentMode,
        paidBy,
        description: description || category,
        costType,
      }).returning();

      await createAuditLog("expenses", expense.id, "create", null, expense);
      successCount++;
      results.push({ row: i + 2, status: "success", data: { id: expense.id, expenseNumber, description: description || category, total: totalAmount } });
    } catch (e: any) {
      logger.error({ err: e, row: i + 2 }, "Expense upload row error");
      results.push({ row: i + 2, status: "error", error: safeErrorMessage(e) });
    }
  }

  res.json({ totalRows: rows.length, successCount, errorCount: rows.length - successCount, results });
});

router.post("/upload/menu", authMiddleware, handleUpload, async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const { rows, error } = safeParseFile(req.file.buffer);
  if (error) { res.status(400).json({ error }); return; }
  if (rows.length === 0) { res.status(400).json({ error: "Empty file or no data rows found" }); return; }

  const categories = await db.select().from(categoriesTable);
  const catByName = new Map(categories.map(c => [c.name.toLowerCase().trim(), c]));
  const ingredients = await db.select().from(ingredientsTable);
  const ingByName = new Map(ingredients.map(i => [i.name.toLowerCase().trim(), i]));
  const existingMenuItems = await db.select().from(menuItemsTable);
  const menuByName = new Map(existingMenuItems.map(m => [m.name.toLowerCase().trim(), m]));

  const grouped = new Map<string, {
    name: string;
    categoryName: string;
    description: string;
    sellingPrice: number;
    dineInPrice: number | null;
    takeawayPrice: number | null;
    deliveryPrice: number | null;
    recipeLines: { ingredientName: string; quantity: number; uom: string; wastagePercent: number; stage: string; notes: string; rowIndex: number }[];
  }>();

  const results: { row: number; status: string; error?: string; data?: any }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = normalizeRow(rows[i]);
    try {
      const menuItemName = String(raw.menu_item || raw.item || raw.name || raw.menu_item_name || "").trim();
      const categoryName = String(raw.category || "").trim();
      const description = String(raw.description || raw.desc || "").trim();
      const sellingPrice = toNum(raw.selling_price || raw.price || 0);
      const dineInPrice = raw.dine_in_price != null && raw.dine_in_price !== "" ? toNum(raw.dine_in_price) : null;
      const takeawayPrice = raw.takeaway_price != null && raw.takeaway_price !== "" ? toNum(raw.takeaway_price) : null;
      const deliveryPrice = raw.delivery_price != null && raw.delivery_price !== "" ? toNum(raw.delivery_price) : null;

      const ingredientName = String(raw.ingredient || raw.ingredient_name || "").trim();
      const quantity = toNum(raw.quantity || raw.qty || 0);
      const uom = String(raw.uom || raw.recipe_uom || raw.unit || "").trim();
      const wastagePercent = toNum(raw.wastage_percent || raw.wastage || raw.waste || 0);
      const stage = String(raw.stage || "").trim();
      const notes = String(raw.notes || "").trim();

      if (!menuItemName) { results.push({ row: i + 2, status: "error", error: "Menu item name is required" }); continue; }

      const groupKey = menuItemName.toLowerCase();
      if (!grouped.has(groupKey)) {
        if (sellingPrice <= 0) { results.push({ row: i + 2, status: "error", error: "Selling price must be > 0 for new menu item" }); continue; }
        grouped.set(groupKey, {
          name: menuItemName,
          categoryName,
          description,
          sellingPrice,
          dineInPrice,
          takeawayPrice,
          deliveryPrice,
          recipeLines: [],
        });
      }

      if (ingredientName) {
        const ing = ingByName.get(ingredientName.toLowerCase());
        if (!ing) { results.push({ row: i + 2, status: "error", error: `Ingredient not found: "${ingredientName}"` }); continue; }
        if (quantity <= 0) { results.push({ row: i + 2, status: "error", error: "Recipe quantity must be > 0" }); continue; }
        if (!uom) { results.push({ row: i + 2, status: "error", error: "UOM is required for recipe line" }); continue; }
        grouped.get(groupKey)!.recipeLines.push({ ingredientName, quantity, uom, wastagePercent, stage, notes, rowIndex: i + 2 });
      }
    } catch (e: any) {
      logger.error({ err: e, row: i + 2 }, "Menu upload row parse error");
      results.push({ row: i + 2, status: "error", error: safeErrorMessage(e) });
    }
  }

  let successCount = 0;

  for (const [, group] of grouped) {
    try {
      await db.transaction(async (tx) => {
        let categoryId: number | null = null;
        if (group.categoryName) {
          const cat = catByName.get(group.categoryName.toLowerCase());
          if (cat) {
            categoryId = cat.id;
          } else {
            const [newCat] = await tx.insert(categoriesTable).values({
              name: group.categoryName,
              type: "menu",
              active: true,
              sortOrder: 0,
            }).returning();
            categoryId = newCat.id;
            catByName.set(group.categoryName.toLowerCase(), newCat);
          }
        }

        const existing = menuByName.get(group.name.toLowerCase());
        let menuItemId: number;
        let menuItemCode: string;

        if (existing) {
          await tx.update(menuItemsTable).set({
            sellingPrice: group.sellingPrice,
            dineInPrice: group.dineInPrice,
            takeawayPrice: group.takeawayPrice,
            deliveryPrice: group.deliveryPrice,
            description: group.description || existing.description,
            categoryId: categoryId ?? existing.categoryId,
          }).where(eq(menuItemsTable.id, existing.id));
          menuItemId = existing.id;
          menuItemCode = existing.code;

          if (group.recipeLines.length > 0) {
            await tx.delete(recipeLinesTable).where(eq(recipeLinesTable.menuItemId, menuItemId));
          }
        } else {
          menuItemCode = await generateCode("MNU", "menu_items");
          const [newItem] = await tx.insert(menuItemsTable).values({
            code: menuItemCode,
            name: group.name,
            categoryId,
            description: group.description || undefined,
            sellingPrice: group.sellingPrice,
            dineInPrice: group.dineInPrice,
            takeawayPrice: group.takeawayPrice,
            deliveryPrice: group.deliveryPrice,
          }).returning();
          menuItemId = newItem.id;
          menuByName.set(group.name.toLowerCase(), newItem);
        }

        for (const line of group.recipeLines) {
          const ing = ingByName.get(line.ingredientName.toLowerCase());
          if (!ing) continue;
          await tx.insert(recipeLinesTable).values({
            menuItemId,
            ingredientId: ing.id,
            quantity: line.quantity,
            uom: line.uom,
            wastagePercent: line.wastagePercent,
            stage: line.stage || undefined,
            notes: line.notes || undefined,
          });
        }

        await createAuditLog("menu_items", menuItemId, existing ? "update" : "create", null, {
          code: menuItemCode,
          name: group.name,
          recipeLines: group.recipeLines.length,
        });

        for (const line of group.recipeLines) {
          successCount++;
          results.push({ row: line.rowIndex, status: "success", data: { menuItem: group.name, ingredient: line.ingredientName, quantity: line.quantity, uom: line.uom } });
        }

        if (group.recipeLines.length === 0) {
          successCount++;
          results.push({ row: 0, status: "success", data: { menuItem: group.name, code: menuItemCode, note: "Created without recipe lines" } });
        }
      });
    } catch (e: any) {
      logger.error({ err: e }, "Menu upload transaction error");
      for (const line of group.recipeLines) {
        const existing = results.find(r => r.row === line.rowIndex);
        if (existing && existing.status === "success") {
          existing.status = "error";
          existing.error = "Transaction failed — entire menu item group rolled back";
          delete existing.data;
          successCount--;
        }
      }
      if (group.recipeLines.length === 0) {
        results.push({ row: 0, status: "error", error: `Failed to create "${group.name}": ${safeErrorMessage(e)}` });
      }
    }
  }

  res.json({ totalRows: rows.length, successCount, errorCount: rows.length - successCount, results });
});

router.post("/upload/sales-invoices", authMiddleware, handleUpload, async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const { rows, error } = safeParseFile(req.file.buffer);
  if (error) { res.status(400).json({ error }); return; }
  if (rows.length === 0) { res.status(400).json({ error: "Empty file or no data rows found" }); return; }

  const menuItems = await db.select().from(menuItemsTable);
  const menuByName = new Map(menuItems.map(m => [m.name.toLowerCase().trim(), m]));
  const menuById = new Map(menuItems.map(m => [m.id, m]));

  const grouped = new Map<string, {
    salesDate: string; invoiceNo: string; invoiceTime: string; orderType: string;
    customerName: string; paymentMode: string; gstInclusive: boolean; totalDiscount: number;
    lines: { menuItemId: number; menuItemName: string; menuItemCode: string; fixedPrice: number; quantity: number; gstPercent: number; rowIndex: number }[];
  }>();
  const results: { row: number; status: string; error?: string; data?: any }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = normalizeRow(rows[i]);
    try {
      const salesDate = toDateStr(raw.date || raw.sales_date || raw.invoice_date);
      if (isFutureDate(salesDate)) { results.push({ row: i + 2, status: "error", error: `Date cannot be in the future (${salesDate}). Today is ${getTodayISO()}.` }); continue; }
      const invoiceNo = String(raw.invoice_no || raw.invoice_number || raw.invoice || "").trim();
      const invoiceTime = String(raw.time || raw.invoice_time || "").trim();
      const orderType = String(raw.order_type || raw.type || "dine-in").toLowerCase().replace(/\s+/g, "-");
      const customerName = String(raw.customer || raw.customer_name || "").trim();
      const paymentMode = String(raw.payment_mode || raw.payment || "cash").toLowerCase().trim();
      const gstInclusive = String(raw.gst_inclusive || raw.gst_incl || "true").toLowerCase() !== "false";
      const totalDiscount = toNum(raw.discount || raw.total_discount || 0);

      const itemName = String(raw.item || raw.menu_item || raw.item_name || raw.menu_item_name || "").trim();
      const itemId = toNum(raw.item_id || raw.menu_item_id);
      const quantity = toNum(raw.quantity || raw.qty);
      const gstPercent = toNum(raw.gst_percent || raw.gst || raw.tax || 5);

      let menuItem = itemId ? menuById.get(itemId) : undefined;
      if (!menuItem && itemName) menuItem = menuByName.get(itemName.toLowerCase());
      if (!menuItem) { results.push({ row: i + 2, status: "error", error: `Menu item not found: "${itemName || itemId}"` }); continue; }
      if (quantity <= 0) { results.push({ row: i + 2, status: "error", error: "Quantity must be > 0" }); continue; }

      const groupKey = `${salesDate}_${invoiceNo || `row${i}`}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, { salesDate, invoiceNo, invoiceTime, orderType, customerName, paymentMode, gstInclusive, totalDiscount, lines: [] });
      }
      grouped.get(groupKey)!.lines.push({
        menuItemId: menuItem.id, menuItemName: menuItem.name, menuItemCode: menuItem.code || '',
        fixedPrice: menuItem.sellingPrice, quantity, gstPercent, rowIndex: i + 2,
      });
    } catch (e: any) {
      logger.error({ err: e, row: i + 2 }, "Sales invoice upload row parse error");
      results.push({ row: i + 2, status: "error", error: safeErrorMessage(e) });
    }
  }

  let successCount = 0;

  const [batch] = await db.insert(salesImportBatchesTable).values({
    sourceType: "excel", fileName: req.file.originalname, invoiceCount: grouped.size,
    lineCount: rows.length, successCount: 0, failedCount: 0, matchedCount: 0, mismatchedCount: 0,
    uploadedBy: (req as any).userId,
  }).returning();

  for (const [, group] of grouped) {
    try {
      let grossAmount = 0;
      for (const l of group.lines) { grossAmount += l.quantity * l.fixedPrice; }
      const invoiceDiscount = group.totalDiscount;

      const finalLines: any[] = [];
      let totalGst = 0;
      for (const pl of group.lines) {
        const lineGross = pl.quantity * pl.fixedPrice;
        const allocatedDiscount = grossAmount > 0 ? Math.round((lineGross / grossAmount) * invoiceDiscount * 100) / 100 : 0;
        const discountedGross = lineGross - allocatedDiscount;
        const discountedUnitPrice = pl.quantity > 0 ? discountedGross / pl.quantity : 0;

        let taxableAmount: number, gstAmt: number, finalAmount: number;
        if (group.gstInclusive) {
          finalAmount = discountedGross;
          taxableAmount = pl.gstPercent > 0 ? finalAmount / (1 + pl.gstPercent / 100) : finalAmount;
          gstAmt = finalAmount - taxableAmount;
        } else {
          taxableAmount = discountedGross;
          gstAmt = taxableAmount * (pl.gstPercent / 100);
          finalAmount = taxableAmount + gstAmt;
        }
        totalGst += gstAmt;

        finalLines.push({
          menuItemId: pl.menuItemId, itemCodeSnapshot: pl.menuItemCode, itemNameSnapshot: pl.menuItemName,
          quantity: pl.quantity, fixedPrice: pl.fixedPrice, grossLineAmount: Math.round(lineGross * 100) / 100,
          lineDiscountAmount: Math.round(allocatedDiscount * 100) / 100, discountedUnitPrice: Math.round(discountedUnitPrice * 100) / 100,
          taxableLineAmount: Math.round(taxableAmount * 100) / 100, gstPercent: pl.gstPercent,
          gstAmount: Math.round(gstAmt * 100) / 100, finalLineAmount: Math.round(finalAmount * 100) / 100,
        });
      }

      const lineFinalTotal = finalLines.reduce((s, l) => s + l.finalLineAmount, 0);
      const taxableTotal = finalLines.reduce((s, l) => s + l.taxableLineAmount, 0);
      const invNo = group.invoiceNo || `XL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;

      await db.transaction(async (tx) => {
        const [invoice] = await tx.insert(salesInvoicesTable).values({
          salesDate: group.salesDate, invoiceNo: invNo, invoiceTime: group.invoiceTime || null,
          sourceType: "excel", orderType: group.orderType, customerName: group.customerName || null,
          grossAmount: Math.round(grossAmount * 100) / 100, totalDiscount: Math.round(invoiceDiscount * 100) / 100,
          taxableAmount: Math.round(taxableTotal * 100) / 100, gstAmount: Math.round(totalGst * 100) / 100,
          finalAmount: Math.round(lineFinalTotal * 100) / 100, paymentMode: group.paymentMode,
          importBatchId: batch.id, matchStatus: "matched", matchDifference: 0,
          createdBy: (req as any).userId,
        }).returning();

        for (const fl of finalLines) {
          await tx.insert(salesInvoiceLinesTable).values({ invoiceId: invoice.id, ...fl });
        }
      });

      for (const l of group.lines) {
        successCount++;
        results.push({ row: l.rowIndex, status: "success", data: { invoiceNo: invNo, item: l.menuItemName, qty: l.quantity } });
      }
    } catch (e: any) {
      logger.error({ err: e }, "Sales invoice upload transaction error");
      for (const l of group.lines) {
        results.push({ row: l.rowIndex, status: "error", error: safeErrorMessage(e) });
      }
    }
  }

  await db.update(salesImportBatchesTable).set({
    successCount, failedCount: rows.length - successCount,
  }).where(eq(salesImportBatchesTable.id, batch.id));

  await createAuditLog("sales_invoices", batch.id, "import", null, { source: "excel", file: req.file.originalname, total: rows.length, success: successCount });
  res.json({ totalRows: rows.length, successCount, errorCount: rows.length - successCount, results });
});

router.post("/upload/petpooja", authMiddleware, handleUpload, async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const { rows, error } = safeParseFile(req.file.buffer);
  if (error) { res.status(400).json({ error }); return; }
  if (rows.length === 0) { res.status(400).json({ error: "Empty file or no data rows found" }); return; }

  const menuItems = await db.select().from(menuItemsTable);
  const menuByName = new Map(menuItems.map(m => [m.name.toLowerCase().trim(), m]));
  const allCategories = await db.select().from(categoriesTable);
  const categoryByName = new Map(allCategories.map(c => [c.name.toLowerCase().trim(), c]));
  const autoCreated: string[] = [];

  const grouped = new Map<string, {
    salesDate: string; invoiceNo: string; invoiceTime: string; orderType: string;
    customerName: string; paymentMode: string; totalDiscount: number;
    lines: { menuItemId: number; menuItemName: string; menuItemCode: string; fixedPrice: number; quantity: number; gstPercent: number; rowIndex: number }[];
  }>();
  const results: { row: number; status: string; error?: string; data?: any }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = normalizeRow(rows[i]);
    try {
      const salesDate = toDateStr(raw.date || raw.order_date || raw.sales_date);
      if (isFutureDate(salesDate)) { results.push({ row: i + 2, status: "error", error: `Date cannot be in the future (${salesDate}). Today is ${getTodayISO()}.` }); continue; }
      const invoiceNo = String(raw.order_id || raw.invoice_no || raw.order_no || raw.invoice || "").trim();
      const invoiceTime = String(raw.time || raw.order_time || "").trim();
      const orderType = String(raw.order_type || raw.type || "dine-in").toLowerCase().replace(/\s+/g, "-");
      const customerName = String(raw.customer || raw.customer_name || "").trim();
      const paymentMode = String(raw.payment_mode || raw.payment || "cash").toLowerCase().trim();
      const totalDiscount = toNum(raw.discount || raw.total_discount || 0);

      const ppItemName = String(raw.item || raw.item_name || raw.menu_item || "").trim();
      const ppCategoryName = String(raw.category || raw.category_name || "").trim();
      const quantity = toNum(raw.quantity || raw.qty);
      const price = toNum(raw.price || raw.rate || raw.selling_price || 0);
      const gstPercent = toNum(raw.gst_percent || raw.gst || raw.tax || 5);

      if (!ppItemName) { results.push({ row: i + 2, status: "error", error: "Item name is required" }); continue; }
      if (quantity <= 0) { results.push({ row: i + 2, status: "error", error: "Quantity must be > 0" }); continue; }

      let menuItem = menuByName.get(ppItemName.toLowerCase().trim());

      if (!menuItem) {
        let categoryId: number | null = null;
        if (ppCategoryName) {
          let category = categoryByName.get(ppCategoryName.toLowerCase().trim());
          if (!category) {
            const [newCat] = await db.insert(categoriesTable).values({ name: ppCategoryName, type: "menu" }).returning();
            category = newCat;
            categoryByName.set(ppCategoryName.toLowerCase().trim(), category);
            autoCreated.push(`Category: ${ppCategoryName}`);
          }
          categoryId = category.id;
        }
        const code = await generateCode("PP", "menu_items");
        const [newItem] = await db.insert(menuItemsTable).values({
          code, name: ppItemName, categoryId, sellingPrice: price, active: true,
        }).returning();
        menuItem = newItem;
        menuByName.set(ppItemName.toLowerCase().trim(), menuItem);
        autoCreated.push(`Menu Item: ${ppItemName} (${code}) @ ₹${price}`);
      }

      const groupKey = `${salesDate}_${invoiceNo || `row${i}`}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, { salesDate, invoiceNo, invoiceTime, orderType, customerName, paymentMode, totalDiscount, lines: [] });
      }
      grouped.get(groupKey)!.lines.push({
        menuItemId: menuItem.id, menuItemName: menuItem.name, menuItemCode: menuItem.code || '',
        fixedPrice: menuItem.sellingPrice, quantity, gstPercent, rowIndex: i + 2,
      });
    } catch (e: any) {
      logger.error({ err: e, row: i + 2 }, "Petpooja upload row parse error");
      results.push({ row: i + 2, status: "error", error: safeErrorMessage(e) });
    }
  }

  let successCount = 0;

  const [batch] = await db.insert(salesImportBatchesTable).values({
    sourceType: "petpooja", fileName: req.file.originalname, invoiceCount: grouped.size,
    lineCount: rows.length, successCount: 0, failedCount: 0, matchedCount: 0, mismatchedCount: 0,
    uploadedBy: (req as any).userId,
  }).returning();

  for (const [, group] of grouped) {
    try {
      let grossAmount = 0;
      for (const l of group.lines) { grossAmount += l.quantity * l.fixedPrice; }
      const invoiceDiscount = group.totalDiscount;

      const finalLines: any[] = [];
      let totalGst = 0;
      for (const pl of group.lines) {
        const lineGross = pl.quantity * pl.fixedPrice;
        const allocatedDiscount = grossAmount > 0 ? Math.round((lineGross / grossAmount) * invoiceDiscount * 100) / 100 : 0;
        const discountedGross = lineGross - allocatedDiscount;
        const discountedUnitPrice = pl.quantity > 0 ? discountedGross / pl.quantity : 0;
        const taxableAmount = discountedGross;
        const gstAmt = taxableAmount * (pl.gstPercent / 100);
        const finalAmount = taxableAmount + gstAmt;
        totalGst += gstAmt;

        finalLines.push({
          menuItemId: pl.menuItemId, itemCodeSnapshot: pl.menuItemCode, itemNameSnapshot: pl.menuItemName,
          quantity: pl.quantity, fixedPrice: pl.fixedPrice, grossLineAmount: Math.round(lineGross * 100) / 100,
          lineDiscountAmount: Math.round(allocatedDiscount * 100) / 100, discountedUnitPrice: Math.round(discountedUnitPrice * 100) / 100,
          taxableLineAmount: Math.round(taxableAmount * 100) / 100, gstPercent: pl.gstPercent,
          gstAmount: Math.round(gstAmt * 100) / 100, finalLineAmount: Math.round(finalAmount * 100) / 100,
        });
      }

      const lineFinalTotal = finalLines.reduce((s, l) => s + l.finalLineAmount, 0);
      const taxableTotal = finalLines.reduce((s, l) => s + l.taxableLineAmount, 0);
      const invNo = group.invoiceNo ? `PP-${group.invoiceNo}` : `PP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;

      await db.transaction(async (tx) => {
        const [invoice] = await tx.insert(salesInvoicesTable).values({
          salesDate: group.salesDate, invoiceNo: invNo, invoiceTime: group.invoiceTime || null,
          sourceType: "petpooja", orderType: group.orderType, customerName: group.customerName || null,
          grossAmount: Math.round(grossAmount * 100) / 100, totalDiscount: Math.round(invoiceDiscount * 100) / 100,
          taxableAmount: Math.round(taxableTotal * 100) / 100, gstAmount: Math.round(totalGst * 100) / 100,
          finalAmount: Math.round(lineFinalTotal * 100) / 100, paymentMode: group.paymentMode,
          importBatchId: batch.id, matchStatus: "matched", matchDifference: 0,
          createdBy: (req as any).userId,
        }).returning();

        for (const fl of finalLines) {
          await tx.insert(salesInvoiceLinesTable).values({ invoiceId: invoice.id, ...fl });
        }
      });

      for (const l of group.lines) {
        successCount++;
        results.push({ row: l.rowIndex, status: "success", data: { invoiceNo: invNo, item: l.menuItemName, qty: l.quantity } });
      }
    } catch (e: any) {
      logger.error({ err: e }, "Petpooja upload transaction error");
      for (const l of group.lines) {
        results.push({ row: l.rowIndex, status: "error", error: safeErrorMessage(e) });
      }
    }
  }

  await db.update(salesImportBatchesTable).set({
    successCount, failedCount: rows.length - successCount,
  }).where(eq(salesImportBatchesTable.id, batch.id));

  await createAuditLog("sales_invoices", batch.id, "import", null, { source: "petpooja", file: req.file.originalname, total: rows.length, success: successCount, autoCreated });
  res.json({ totalRows: rows.length, successCount, errorCount: rows.length - successCount, results, autoCreated: autoCreated.length > 0 ? autoCreated : undefined });
});

router.get("/upload/template/:type", authMiddleware, async (req, res): Promise<void> => {
  const { type } = req.params;
  let headers: string[];
  let sampleRow: any[];
  let sheetName: string;

  switch (type) {
    case "purchases":
      sheetName = "Purchases";
      headers = ["Date", "Vendor", "Ingredient", "Quantity", "UOM", "Rate", "Tax_Percent", "Invoice", "Payment_Mode"];
      sampleRow = ["2026-03-30", "Fresh Dairy Co", "Whole Milk", 20, "L", 55, 0, "INV-001", "cash"];
      break;
    case "expenses":
      sheetName = "Expenses";
      headers = ["Date", "Cost_Type", "Category", "Description", "Amount", "Tax", "Payment_Mode", "Paid_By"];
      sampleRow = ["2026-03-30", "fixed", "Rent", "Monthly shop rent", 50000, 0, "bank_transfer", "Owner"];
      break;
    case "menu": {
      sheetName = "Menu_Recipes";
      headers = ["Menu_Item", "Category", "Description", "Selling_Price", "Dine_In_Price", "Takeaway_Price", "Delivery_Price", "Ingredient", "Quantity", "UOM", "Wastage_Percent", "Stage", "Notes"];
      sampleRow = ["Cappuccino", "Beverages", "Classic Italian coffee", 180, 180, 200, 220, "Milk", 150, "ml", 2, "Prep", "Steamed"];
      const wb2 = XLSX.utils.book_new();
      const wsData2 = [headers, sampleRow, ["Cappuccino", "", "", "", "", "", "", "Coffee", 18, "g", 5, "Brew", "Espresso shot"]];
      const ws2 = XLSX.utils.aoa_to_sheet(wsData2);
      ws2["!cols"] = headers.map((h, idx) => ({ wch: Math.max(h.length, String(sampleRow[idx]).length) + 4 }));
      XLSX.utils.book_append_sheet(wb2, ws2, sheetName);
      const buf2 = XLSX.write(wb2, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=menu_template.xlsx`);
      res.send(buf2);
      return;
    }
    case "sales-invoices":
      sheetName = "Sales_Invoices";
      headers = ["Date", "Invoice_No", "Time", "Order_Type", "Customer", "Item", "Quantity", "GST_Percent", "Discount", "Payment_Mode", "GST_Inclusive"];
      sampleRow = ["2026-03-30", "INV-001", "10:30", "dine-in", "John", "Cappuccino", 2, 5, 0, "cash", "true"];
      break;
    case "petpooja":
      sheetName = "Petpooja_Sales";
      headers = ["Date", "Order_ID", "Time", "Order_Type", "Customer", "Item", "Category", "Price", "Quantity", "GST_Percent", "Discount", "Payment_Mode"];
      sampleRow = ["2026-03-30", "PP-1234", "10:30", "dine-in", "Walk-in", "Cappuccino", "Beverages", 180, 2, 5, 0, "cash"];
      break;
    default:
      res.status(400).json({ error: "Invalid template type. Use: purchases, expenses, menu, sales-invoices, or petpooja" });
      return;
  }

  const wb = XLSX.utils.book_new();
  const wsData = [headers, sampleRow];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  const colWidths = headers.map((h, idx) => {
    const maxLen = Math.max(h.length, String(sampleRow[idx]).length);
    return { wch: maxLen + 4 };
  });
  ws["!cols"] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=${type}_template.xlsx`);
  res.send(buf);
});

export default router;
