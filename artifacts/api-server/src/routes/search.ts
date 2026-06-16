import { Router, type IRouter } from "express";
import { ilike, or, desc, sql } from "drizzle-orm";
import { db, vendorsTable, ingredientsTable, menuItemsTable,
         employeesTable, customersTable, salesInvoicesTable, purchaseOrdersTable } from "@workspace/db";
import { authMiddleware } from "../lib/auth";

const router: IRouter = Router();

router.get("/search", authMiddleware, async (req, res): Promise<void> => {
  try {
    const q = ((req.query.q as string) || "").trim();
    if (!q || q.length < 2) {
      res.json({ vendors: [], ingredients: [], menuItems: [], invoices: [], employees: [], customers: [], purchaseOrders: [], total: 0 });
      return;
    }
    const like = `%${q}%`;

    const [vendors, ingredients, menuItems, invoices, employees, customers, pos] = await Promise.all([
      db.select({ id: vendorsTable.id, name: vendorsTable.name, code: vendorsTable.code, type: sql<string>`'vendor'` })
        .from(vendorsTable).where(or(ilike(vendorsTable.name, like), ilike(vendorsTable.code, like))).limit(5),

      db.select({ id: ingredientsTable.id, name: ingredientsTable.name, code: ingredientsTable.code, type: sql<string>`'ingredient'` })
        .from(ingredientsTable).where(or(ilike(ingredientsTable.name, like), ilike(ingredientsTable.code, like))).limit(5),

      db.select({ id: menuItemsTable.id, name: menuItemsTable.name, code: menuItemsTable.code, type: sql<string>`'menu_item'` })
        .from(menuItemsTable).where(or(ilike(menuItemsTable.name, like), ilike(menuItemsTable.code, like))).limit(5),

      // sales invoices — search by invoiceNo and customerName
      db.select({ id: salesInvoicesTable.id, name: salesInvoicesTable.invoiceNo, code: salesInvoicesTable.invoiceNo, type: sql<string>`'invoice'` })
        .from(salesInvoicesTable)
        .where(or(ilike(salesInvoicesTable.invoiceNo, like), ilike(salesInvoicesTable.customerName, like)))
        .orderBy(desc(salesInvoicesTable.createdAt)).limit(5),

      db.select({ id: employeesTable.id, name: employeesTable.name, code: employeesTable.code, type: sql<string>`'employee'` })
        .from(employeesTable).where(or(ilike(employeesTable.name, like), ilike(employeesTable.code, like))).limit(5),

      // customers — no code column, use phone
      db.select({ id: customersTable.id, name: customersTable.name, code: customersTable.phone, type: sql<string>`'customer'` })
        .from(customersTable).where(or(ilike(customersTable.name, like), ilike(customersTable.phone, like))).limit(5),

      db.select({ id: purchaseOrdersTable.id, name: purchaseOrdersTable.poNumber, code: purchaseOrdersTable.poNumber, type: sql<string>`'purchase_order'` })
        .from(purchaseOrdersTable).where(ilike(purchaseOrdersTable.poNumber, like))
        .orderBy(desc(purchaseOrdersTable.createdAt)).limit(5),
    ]);

    res.json({
      vendors, ingredients, menuItems, invoices, employees, customers, purchaseOrders: pos,
      total: vendors.length + ingredients.length + menuItems.length + invoices.length + employees.length + customers.length + pos.length,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
