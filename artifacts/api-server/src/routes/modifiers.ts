import { Router, type IRouter } from "express";
import { eq, desc, ilike, or } from "drizzle-orm";
import { db, menuModifierGroupsTable, menuModifierOptionsTable, menuItemModifierGroupsTable,
         vendorsTable, ingredientsTable, menuItemsTable, expensesTable, employeesTable, customersTable, salesInvoicesTable, purchasesTable } from "@workspace/db";
import { authMiddleware, managerOrAdmin, adminOnly } from "../lib/auth";

const router: IRouter = Router();

// ─── MODIFIER GROUPS ─────────────────────────────────────────────────────────

router.get("/menu-modifier-groups", authMiddleware, async (req, res): Promise<void> => {
  try {
    const groups = await db.select().from(menuModifierGroupsTable).orderBy(menuModifierGroupsTable.id);
    const result = await Promise.all(groups.map(async (g) => {
      const options = await db.select().from(menuModifierOptionsTable)
        .where(eq(menuModifierOptionsTable.groupId, g.id));
      return { ...g, options };
    }));
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/menu-modifier-groups", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const { name, required = false, maxSelections = 1, options = [] } = req.body;
    if (!name) { res.status(400).json({ error: "Name is required" }); return; }
    const [group] = await db.insert(menuModifierGroupsTable).values({ name, required, maxSelections }).returning();
    for (const opt of options) {
      await db.insert(menuModifierOptionsTable).values({
        groupId: group.id, name: opt.name, priceAdjustment: opt.priceAdjustment || 0,
      });
    }
    const createdOptions = await db.select().from(menuModifierOptionsTable).where(eq(menuModifierOptionsTable.groupId, group.id));
    res.status(201).json({ ...group, options: createdOptions });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/menu-modifier-groups/:id", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { name, required, maxSelections, options } = req.body;
    const update: any = {};
    if (name !== undefined) update.name = name;
    if (required !== undefined) update.required = required;
    if (maxSelections !== undefined) update.maxSelections = maxSelections;
    const [updated] = await db.update(menuModifierGroupsTable).set(update).where(eq(menuModifierGroupsTable.id, id)).returning();
    if (options && Array.isArray(options)) {
      await db.delete(menuModifierOptionsTable).where(eq(menuModifierOptionsTable.groupId, id));
      for (const opt of options) {
        await db.insert(menuModifierOptionsTable).values({ groupId: id, name: opt.name, priceAdjustment: opt.priceAdjustment || 0 });
      }
    }
    const updatedOptions = await db.select().from(menuModifierOptionsTable).where(eq(menuModifierOptionsTable.groupId, id));
    res.json({ ...updated, options: updatedOptions });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/menu-modifier-groups/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  try {
    await db.delete(menuModifierGroupsTable).where(eq(menuModifierGroupsTable.id, Number(req.params.id)));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Link modifiers to menu item ─────────────────────────────────────────────

router.post("/menu-items/:id/modifier-groups", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const menuItemId = Number(req.params.id);
    const { modifierGroupIds = [] } = req.body;
    // Clear existing links
    await db.delete(menuItemModifierGroupsTable).where(eq(menuItemModifierGroupsTable.menuItemId, menuItemId));
    for (const groupId of modifierGroupIds) {
      await db.insert(menuItemModifierGroupsTable).values({ menuItemId, modifierGroupId: groupId });
    }
    res.json({ success: true, linked: modifierGroupIds.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/menu-items/:id/modifier-groups", authMiddleware, async (req, res): Promise<void> => {
  try {
    const menuItemId = Number(req.params.id);
    const links = await db.select({ modifierGroupId: menuItemModifierGroupsTable.modifierGroupId })
      .from(menuItemModifierGroupsTable)
      .where(eq(menuItemModifierGroupsTable.menuItemId, menuItemId));
    const groupIds = links.map(l => l.modifierGroupId);
    if (groupIds.length === 0) { res.json([]); return; }
    const groups = await Promise.all(groupIds.map(async (gid) => {
      const [group] = await db.select().from(menuModifierGroupsTable).where(eq(menuModifierGroupsTable.id, gid));
      const options = await db.select().from(menuModifierOptionsTable).where(eq(menuModifierOptionsTable.groupId, gid));
      return { ...group, options };
    }));
    res.json(groups.filter(Boolean));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GLOBAL SEARCH ────────────────────────────────────────────────────────────

const globalSearchRouter: IRouter = Router();

globalSearchRouter.get("/search", authMiddleware, async (req, res): Promise<void> => {
  try {
    const q = (req.query.q as string || "").trim();
    if (!q || q.length < 2) { res.json({ vendors: [], ingredients: [], menuItems: [], invoices: [], employees: [], customers: [] }); return; }
    const pattern = `%${q}%`;
    const [vendors, ingredients, menuItems, invoices, employees, customers] = await Promise.all([
      db.select({ id: vendorsTable.id, code: vendorsTable.code, name: vendorsTable.name, type: eq(vendorsTable.active, true) })
        .from(vendorsTable).where(or(ilike(vendorsTable.name, pattern), ilike(vendorsTable.code, pattern))).limit(5),
      db.select({ id: ingredientsTable.id, code: ingredientsTable.code, name: ingredientsTable.name })
        .from(ingredientsTable).where(or(ilike(ingredientsTable.name, pattern), ilike(ingredientsTable.code, pattern))).limit(5),
      db.select({ id: menuItemsTable.id, code: menuItemsTable.code, name: menuItemsTable.name })
        .from(menuItemsTable).where(or(ilike(menuItemsTable.name, pattern), ilike(menuItemsTable.code, pattern))).limit(5),
      db.select({ id: salesInvoicesTable.id, invoiceNo: salesInvoicesTable.invoiceNo, salesDate: salesInvoicesTable.salesDate, finalAmount: salesInvoicesTable.finalAmount })
        .from(salesInvoicesTable).where(ilike(salesInvoicesTable.invoiceNo, pattern)).limit(5),
      db.select({ id: employeesTable.id, code: employeesTable.code, name: employeesTable.name })
        .from(employeesTable).where(or(ilike(employeesTable.name, pattern), ilike(employeesTable.code, pattern))).limit(5),
      db.select({ id: customersTable.id, name: customersTable.name, phone: customersTable.phone })
        .from(customersTable).where(or(ilike(customersTable.name, pattern), ilike(customersTable.phone, pattern))).limit(5),
    ]);
    res.json({
      vendors: vendors.map(v => ({ ...v, entityType: "vendor", url: `/vendors/${v.id}` })),
      ingredients: ingredients.map(i => ({ ...i, entityType: "ingredient", url: `/ingredients` })),
      menuItems: menuItems.map(m => ({ ...m, entityType: "menuItem", url: `/menu` })),
      invoices: invoices.map(i => ({ ...i, entityType: "invoice", url: `/sales` })),
      employees: employees.map(e => ({ ...e, entityType: "employee", url: `/employees` })),
      customers: customers.map(c => ({ ...c, entityType: "customer", url: `/customers` })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export { globalSearchRouter };
export default router;
