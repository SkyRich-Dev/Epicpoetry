import { db, posIntegrationsTable, menuItemsTable, categoriesTable,
  salesInvoicesTable, salesInvoiceLinesTable, customersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { isFutureDate } from "./dateValidation";
import { generateCode } from "./codeGenerator";
import { normalizePhone, recomputeCustomerStats } from "./customers";
import type { PosIntegration } from "./posProviders";

const PETPOOJA_SOURCE = "petpooja";

function normalizeTenantSchemaName(value: string | null | undefined): string | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(normalized)) return null;
  if (normalized === "public" || normalized.startsWith("pg_") || normalized === "information_schema") return null;
  return normalized;
}

export interface ImportInput {
  ppOrder: any;
  ppItems: any[];
  ppCustomer?: any;
  integration: PosIntegration;
}

export interface ImportResult {
  created: boolean;
  invoiceNo: string;
  autoCreated: string[];
  reason?: string;
  customerId?: number | null;
}

export async function importPetpoojaOrder(input: ImportInput): Promise<ImportResult> {
  const { ppOrder, ppItems, ppCustomer, integration } = input;
  const tenantSchemaName = normalizeTenantSchemaName(integration.tenantSchemaName);

  if (!ppOrder || !Array.isArray(ppItems) || ppItems.length === 0) {
    throw new Error("Missing Order or OrderItem in payload");
  }

  const orderRef = String(ppOrder.customer_invoice_id || ppOrder.orderID || ppOrder.order_id || "").trim();
  if (!orderRef) {
    throw new Error("Order is missing both customer_invoice_id and orderID — cannot create a stable invoice number");
  }
  const invoiceNo = `PP-${orderRef}`;

  const createdOn = ppOrder.created_on || "";
  const salesDate = createdOn ? createdOn.split(" ")[0] : new Date().toISOString().split("T")[0];
  const invoiceTime = createdOn ? createdOn.split(" ")[1] || "" : "";
  if (isFutureDate(salesDate)) {
    throw new Error(`Order date cannot be in the future (${salesDate})`);
  }

  const rawOrderType = (ppOrder.order_type || "").toLowerCase().replace(/\s+/g, "-");
  const orderType = rawOrderType || integration.defaultOrderType || "dine-in";
  const customerName = ppCustomer?.name || "";

  let paymentMode = (ppOrder.payment_type || "cash").toLowerCase();
  const partPayments = ppOrder.part_payments;
  if (paymentMode === "part payment" && Array.isArray(partPayments) && partPayments.length > 0) {
    paymentMode = "mixed";
  }
  if (paymentMode === "online") {
    const subOrderType = (ppOrder.sub_order_type || "").toLowerCase();
    if (subOrderType === "zomato" || subOrderType === "swiggy") paymentMode = subOrderType;
  }

  const totalDiscount = Number(ppOrder.discount_total || 0);
  const orderTaxTotal = Number(ppOrder.tax_total || 0);
  const ppTotal = Number(ppOrder.total || 0);
  const serviceCharge = Number(ppOrder.service_charge || 0);
  const packagingCharge = Number(ppOrder.packaging_charge || 0);
  const deliveryCharges = Number(ppOrder.delivery_charges || 0);

  const refParts: string[] = [];
  if (Array.isArray(partPayments) && partPayments.length > 0) {
    refParts.push(partPayments.map((pp: any) =>
      `${pp.payment_type || pp.custome_payment_type || "Other"}: ₹${pp.amount}`
    ).join(", "));
  }
  if (ppOrder.order_from && ppOrder.order_from !== "POS") {
    let src = ppOrder.order_from;
    if (ppOrder.order_from_id) src += ` #${ppOrder.order_from_id}`;
    refParts.push(src);
  }
  if (ppOrder.table_no) refParts.push(`Table: ${ppOrder.table_no}`);
  if (ppOrder.biller) refParts.push(`Biller: ${ppOrder.biller}`);
  if (ppOrder.comment) refParts.push(`Note: ${ppOrder.comment}`);
  if (serviceCharge > 0) refParts.push(`Service Charge: ₹${serviceCharge}`);
  if (packagingCharge > 0) refParts.push(`Packaging: ₹${packagingCharge}`);
  if (deliveryCharges > 0) refParts.push(`Delivery: ₹${deliveryCharges}`);
  const paymentRef = refParts.join(" | ");

  // Everything from the duplicate-check through invoice/line/category/menu inserts MUST run
  // in one transaction so that on a 23505 race (concurrent import won) or any failure, the
  // auto-created categories/menu items are rolled back instead of orphaned.
  // We also retry up to 3 times on a transient menu_items.code race: generateCode()
  // is a non-atomic max+1, so two concurrent imports auto-creating distinct new menu items
  // can both compute the same code and one will fail with 23505 on menu_items_code_unique.
  // Re-running the whole transaction picks up the just-committed code and tries the next number.
  let txResult: ImportResult | null = null;
  const MAX_ATTEMPTS = 3;
  let lastErr: any = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      txResult = await db.transaction(async (tx) => {
      if (tenantSchemaName) {
        await tx.execute(sql`select set_config('search_path', ${`"${tenantSchemaName}", public`}, false)`);
      }
      const existing = await tx.select({ id: salesInvoicesTable.id })
        .from(salesInvoicesTable)
        .where(and(eq(salesInvoicesTable.invoiceNo, invoiceNo), eq(salesInvoicesTable.sourceType, PETPOOJA_SOURCE)))
        .limit(1);
      if (existing.length > 0) {
        return { created: false, invoiceNo, autoCreated: [], reason: "already_imported" } as ImportResult;
      }

      const allCategories = await tx.select().from(categoriesTable);
      const categoryByName = new Map(allCategories.map(c => [c.name.toLowerCase().trim(), c]));
      const allMenuItems = await tx.select().from(menuItemsTable);
      const menuByName = new Map(allMenuItems.map(m => [m.name.toLowerCase().trim(), m]));
      const autoCreated: string[] = [];
      const lineData: any[] = [];

      for (const item of ppItems) {
        const ppItemName = String(item.name || "").trim();
        const ppCategoryName = String(item.category_name || "").trim();
        const qty = Number(item.quantity || 1);
        const itemPrice = Number(item.price || 0);
        const itemTotal = Number(item.total || itemPrice * qty);
        const itemDiscount = Number(item.discount || 0);
        const itemTax = Number(item.tax || 0);

        let addonTotal = 0;
        if (Array.isArray(item.addon)) {
          for (const addon of item.addon) {
            addonTotal += Number(addon.price || 0) * Number(addon.quantity || 1);
          }
        }

        const itemKey = ppItemName.toLowerCase().trim();
        let menuItem = menuByName.get(itemKey);
        if (!menuItem) {
          // Acquire the advisory lock BEFORE deciding to create. Two concurrent
          // transactions importing different orders that contain the same new item name
          // would otherwise both read the stale snapshot, both decide the item is
          // missing, and both insert duplicate rows (menu_items.name is not unique).
          // The lock serializes the "check existence + maybe create" critical section
          // across transactions; it is released automatically at commit/rollback.
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${424201})`);

          // Re-query under the lock to pick up any row another transaction just
          // committed for this same name. Case-insensitive match using LOWER(TRIM()).
          const recheck = await tx
            .select()
            .from(menuItemsTable)
            .where(sql`LOWER(TRIM(${menuItemsTable.name})) = ${itemKey}`)
            .limit(1);
          if (recheck.length > 0) {
            menuItem = recheck[0];
            menuByName.set(itemKey, menuItem);
          } else {
            let categoryId: number | null = null;
            if (ppCategoryName) {
              const catKey = ppCategoryName.toLowerCase().trim();
              let category = categoryByName.get(catKey);
              if (!category) {
                // Re-check categories under the same lock so two concurrent imports
                // do not each insert a duplicate category row (categories.name has
                // no unique constraint either).
                const catRecheck = await tx
                  .select()
                  .from(categoriesTable)
                  .where(sql`LOWER(TRIM(${categoriesTable.name})) = ${catKey} AND ${categoriesTable.type} = 'menu'`)
                  .limit(1);
                if (catRecheck.length > 0) {
                  category = catRecheck[0];
                } else {
                  const [newCat] = await tx.insert(categoriesTable).values({
                    name: ppCategoryName,
                    type: "menu",
                  }).returning();
                  category = newCat;
                  autoCreated.push(`Category: ${ppCategoryName}`);
                }
                categoryByName.set(catKey, category);
              }
              categoryId = category.id;
            }
            // Pass `tx` so MAX sees previously-inserted menu items in this same
            // transaction (e.g. an order with two distinct new menu items would
            // otherwise both compute the same code via a separate connection that
            // can't see uncommitted rows).
            const code = await generateCode("PP", "menu_items", tx);
            const [newItem] = await tx.insert(menuItemsTable).values({
              code,
              name: ppItemName,
              categoryId,
              sellingPrice: itemPrice,
              active: true,
            }).returning();
            menuItem = newItem;
            menuByName.set(itemKey, menuItem);
            autoCreated.push(`Menu Item: ${ppItemName} (${code}) @ ₹${itemPrice}`);
          }
        }

        const usePrice = itemTotal > 0 ? itemTotal / qty : (menuItem.sellingPrice || itemPrice);
        const grossWithAddons = (usePrice * qty) + addonTotal;

        lineData.push({
          menuItemId: menuItem.id,
          itemCodeSnapshot: menuItem.code,
          itemNameSnapshot: menuItem.name,
          fixedPrice: usePrice,
          quantity: qty,
          grossLineAmount: grossWithAddons,
          ppItemDiscount: itemDiscount,
          ppItemTax: itemTax,
          gstPercent: integration.defaultGstPercent || 5,
        });
      }

      let grossAmount = lineData.reduce((s, l) => s + l.grossLineAmount, 0);
      let totalGst = 0;
      let totalTaxable = 0;
      let totalFinal = 0;
      const hasDiscount = totalDiscount > 0 || lineData.some((line) => line.ppItemDiscount > 0);
      const useOrderLevelTax = orderTaxTotal > 0;
      const discountRatio = hasDiscount && grossAmount > 0 ? totalDiscount / grossAmount : 0;

      const finalLines = lineData.map(l => {
        const lineDiscount = hasDiscount
          ? (l.ppItemDiscount > 0
            ? l.ppItemDiscount
            : Math.round(l.grossLineAmount * discountRatio * 100) / 100)
          : 0;
        const taxable = l.grossLineAmount - lineDiscount;
        let gst = 0;
        if (useOrderLevelTax && grossAmount > 0) {
          gst = Math.round((l.grossLineAmount / grossAmount) * orderTaxTotal * 100) / 100;
        } else if (l.ppItemTax > 0) {
          gst = l.ppItemTax;
        } else if (l.gstPercent > 0) {
          gst = Math.round(taxable * l.gstPercent / 100 * 100) / 100;
        }
        const finalAmt = taxable + gst;
        totalGst += gst;
        totalTaxable += taxable;
        totalFinal += finalAmt;
        return {
          menuItemId: l.menuItemId,
          itemCodeSnapshot: l.itemCodeSnapshot,
          itemNameSnapshot: l.itemNameSnapshot,
          fixedPrice: l.fixedPrice,
          quantity: l.quantity,
          grossLineAmount: Math.round(l.grossLineAmount * 100) / 100,
          lineDiscountAmount: Math.round(lineDiscount * 100) / 100,
          discountedUnitPrice: l.quantity > 0
            ? Math.round(((hasDiscount ? (l.grossLineAmount - lineDiscount) : l.grossLineAmount) / l.quantity) * 100) / 100
            : 0,
          taxableLineAmount: Math.round(taxable * 100) / 100,
          gstPercent: l.gstPercent,
          gstAmount: Math.round(gst * 100) / 100,
          finalLineAmount: Math.round(finalAmt * 100) / 100,
        };
      });

      const invoiceFinal = ppTotal > 0 ? ppTotal : Math.round(totalFinal * 100) / 100;

      // Customer linkage — upsert by phone INSIDE the import tx so that
      // (1) the invoice is linked atomically (no need for a later "Recompute")
      // and (2) on a rollback we don't leak orphan customers from a failed import.
      // ON CONFLICT DO NOTHING handles the customers.phone unique race when two
      // concurrent orders for the same phone import simultaneously.
      let linkedCustomerId: number | null = null;
      let linkedCustomerPhone: string | null = null;
      const ppCustPhone = normalizePhone(ppCustomer?.phone);
      const ppCustNameRaw = String(ppCustomer?.name || "").trim();
      const ppCustEmailRaw = String(ppCustomer?.email || "").trim();
      if (ppCustPhone) {
        linkedCustomerPhone = ppCustPhone;
        const insertedRows = await tx.insert(customersTable).values({
          name: ppCustNameRaw || `Guest ${ppCustPhone.slice(-4)}`,
          phone: ppCustPhone,
          email: ppCustEmailRaw || null,
        }).onConflictDoNothing({ target: customersTable.phone }).returning();
        if (insertedRows.length > 0) {
          linkedCustomerId = insertedRows[0].id;
        } else {
          const [existingCust] = await tx.select().from(customersTable)
            .where(eq(customersTable.phone, ppCustPhone)).limit(1);
          if (existingCust) {
            linkedCustomerId = existingCust.id;
            // Enrich existing record only when current values look like placeholders
            // (avoids overwriting a name the operator manually fixed in the master list).
            const updates: any = {};
            const isPlaceholderName = !existingCust.name || /^Guest /i.test(existingCust.name);
            if (ppCustNameRaw && isPlaceholderName && existingCust.name !== ppCustNameRaw) {
              updates.name = ppCustNameRaw;
            }
            if (ppCustEmailRaw && !existingCust.email) {
              updates.email = ppCustEmailRaw;
            }
            if (Object.keys(updates).length > 0) {
              await tx.update(customersTable).set(updates).where(eq(customersTable.id, existingCust.id));
            }
          }
        }
      }

      const [invoice] = await tx.insert(salesInvoicesTable).values({
        salesDate,
        invoiceNo,
        invoiceTime,
        sourceType: PETPOOJA_SOURCE,
        orderType,
        customerName: customerName || null,
        customerPhone: linkedCustomerPhone,
        customerId: linkedCustomerId,
        grossAmount: Math.round(grossAmount * 100) / 100,
        totalDiscount: Math.round(totalDiscount * 100) / 100,
        taxableAmount: Math.round(totalTaxable * 100) / 100,
        gstAmount: Math.round(totalGst * 100) / 100,
        finalAmount: Math.round(invoiceFinal * 100) / 100,
        paymentMode,
        paymentReference: paymentRef || null,
        matchStatus: "matched",
        matchDifference: 0,
      }).returning();

      for (const line of finalLines) {
        await tx.insert(salesInvoiceLinesTable).values({
          invoiceId: invoice.id,
          ...line,
        });
      }

      return { created: true, invoiceNo, autoCreated, customerId: linkedCustomerId } as ImportResult;
      });
      break; // success — exit retry loop
    } catch (e: any) {
      const code = e?.code || e?.cause?.code;
      const msg = String(e?.message || "");
      const constraint = e?.constraint || e?.cause?.constraint || "";
      // (a) Sales-invoice race: concurrent import already created this invoice.
      // The whole transaction (incl. any auto-created categories/menu items) is rolled back.
      const isSalesInvoiceDup =
        constraint === "sales_invoices_source_invoice_unique" ||
        msg.includes("sales_invoices_source_invoice_unique");
      if (isSalesInvoiceDup) {
        return { created: false, invoiceNo, autoCreated: [], reason: "already_imported" };
      }
      // (b) Menu-item code race: generateCode() is non-atomic max+1, so two concurrent
      // imports auto-creating distinct new menu items can compute the same code. The
      // losing tx fails on menu_items_code_unique. Retry up to MAX_ATTEMPTS to pick up
      // the just-committed code and try the next number.
      const isMenuCodeDup =
        code === "23505" &&
        (constraint.startsWith("menu_items") ||
          msg.includes("menu_items_code") ||
          msg.includes('"menu_items"'));
      if (isMenuCodeDup && attempt < MAX_ATTEMPTS) {
        lastErr = e;
        continue; // retry whole transaction
      }
      // Anything else (or out of retries) is a real error.
      throw e;
    }
  }

  if (!txResult) {
    // Should be unreachable: either we returned, broke with a result, or threw.
    throw lastErr || new Error("Petpooja import failed without a result");
  }

  if (txResult.created) {
    await db.update(posIntegrationsTable).set({
      lastSyncAt: new Date(),
      lastSyncStatus: "success",
      lastSyncMessage: "1 synced",
      totalOrdersSynced: sql`${posIntegrationsTable.totalOrdersSynced} + 1`,
    }).where(eq(posIntegrationsTable.id, integration.id));

    // Refresh customer aggregate stats outside the import tx so the
    // Customers page reflects this new order without needing "Recompute".
    if (txResult.customerId) {
      try {
        await recomputeCustomerStats(txResult.customerId);
      } catch (e) {
        // Stats refresh failures should never roll back a successfully imported order.
      }
    }
  }

  return txResult;
}

export interface UpsertCustomerInput {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

export async function upsertPetpoojaCustomer(c: UpsertCustomerInput): Promise<"created" | "updated" | "skipped"> {
  // Always normalize the phone — Petpooja's payload sometimes ships +91-prefixed
  // or formatted numbers, and storing those as-is creates a duplicate customer
  // that's never linked to invoices (which use the normalized 10-digit form).
  const phone = normalizePhone(c.phone);
  if (!phone) return "skipped";
  const name = (c.name || "").trim();
  const email = (c.email || "").trim();

  const [existing] = await db.select().from(customersTable).where(eq(customersTable.phone, phone)).limit(1);
  if (existing) {
    // Only enrich placeholder data; never overwrite a curated name with the POS
    // payload (the operator may have manually corrected it in the master list).
    const updates: any = {};
    const isPlaceholderName = !existing.name || /^Guest /i.test(existing.name);
    if (name && isPlaceholderName && existing.name !== name) updates.name = name;
    if (email && !existing.email) updates.email = email;
    if (Object.keys(updates).length === 0) return "skipped";
    await db.update(customersTable).set(updates).where(eq(customersTable.id, existing.id));
    return "updated";
  }

  // No existing customer — create using the available data, falling back to a
  // Guest placeholder when the POS payload omitted a name.
  const insertedRows = await db.insert(customersTable).values({
    name: name || `Guest ${phone.slice(-4)}`,
    phone,
    email: email || null,
  }).onConflictDoNothing({ target: customersTable.phone }).returning();
  if (insertedRows.length > 0) return "created";
  // Lost a race — another concurrent upsert just inserted this phone. Treat as skipped.
  return "skipped";
}
