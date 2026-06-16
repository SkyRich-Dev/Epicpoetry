/**
 * Platr permission catalog — v2.0 updated.
 */

export interface PermissionDef {
  key: string;
  label: string;
  description?: string;
}

export interface PermissionCategory {
  id: string;
  label: string;
  permissions: PermissionDef[];
}

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    id: "operation",
    label: "Operations",
    permissions: [
      { key: "sales.view", label: "View sales" },
      { key: "sales.create", label: "Create sales / invoices" },
      { key: "sales.edit", label: "Edit sales / invoices" },
      { key: "sales.delete", label: "Delete sales / invoices" },
      { key: "sales.import", label: "Import sales (Excel / POS)" },
      { key: "settlements.view", label: "View settlements" },
      { key: "settlements.create", label: "Create settlements" },
      { key: "settlements.verify", label: "Verify settlements" },
      { key: "customers.view", label: "View customers" },
      { key: "customers.edit", label: "Edit customers" },
      { key: "waste.view", label: "View waste" },
      { key: "waste.create", label: "Record waste" },
      // v2.0
      { key: "tables.view", label: "View table management" },
      { key: "tables.edit", label: "Manage tables & floor plan" },
      { key: "kot.view", label: "View kitchen orders (KOT)" },
      { key: "kot.edit", label: "Update KOT status" },
      { key: "eod.view", label: "View EOD / daily closing" },
      { key: "eod.manage", label: "Initiate and approve EOD" },
      { key: "reservations.view", label: "View reservations" },
      { key: "reservations.edit", label: "Manage reservations" },
    ],
  },
  {
    id: "account",
    label: "Accounts",
    permissions: [
      { key: "expenses.view", label: "View expenses" },
      { key: "expenses.create", label: "Create expenses" },
      { key: "expenses.edit", label: "Edit expenses" },
      { key: "expenses.delete", label: "Delete expenses" },
      { key: "vendor_payments.view", label: "View vendor payments" },
      { key: "vendor_payments.create", label: "Record vendor payments" },
      { key: "vendor_payments.delete", label: "Delete vendor payments" },
      { key: "petty_cash.view", label: "View petty cash" },
      { key: "petty_cash.create", label: "Record petty cash entries" },
      { key: "petty_cash.delete", label: "Delete petty cash entries" },
      // v2.0
      { key: "expense_budgets.view", label: "View expense budgets" },
      { key: "expense_budgets.edit", label: "Set / edit expense budgets" },
    ],
  },
  {
    id: "purchase",
    label: "Purchase & Inventory",
    permissions: [
      { key: "vendors.view", label: "View vendors" },
      { key: "vendors.create", label: "Create vendors" },
      { key: "vendors.edit", label: "Edit vendors" },
      { key: "vendors.delete", label: "Delete vendors" },
      { key: "purchases.view", label: "View purchases" },
      { key: "purchases.create", label: "Create purchases" },
      { key: "purchases.edit", label: "Edit purchases" },
      { key: "purchases.delete", label: "Delete purchases" },
      { key: "ingredients.view", label: "View ingredients" },
      { key: "ingredients.edit", label: "Edit ingredients" },
      { key: "menu_items.view", label: "View menu items" },
      { key: "menu_items.edit", label: "Edit menu items / recipes" },
      { key: "menu_items.view_margin", label: "View menu item cost & margin", description: "Reveals production cost, margin %, and recipe cost." },
      { key: "inventory.view", label: "View inventory" },
      { key: "inventory.edit", label: "Adjust inventory" },
      // v2.0
      { key: "purchase_orders.view", label: "View purchase orders" },
      { key: "purchase_orders.create", label: "Create / submit purchase orders" },
      { key: "purchase_orders.approve", label: "Approve purchase orders" },
      { key: "stocktakes.view", label: "View stocktakes" },
      { key: "stocktakes.manage", label: "Initiate and count stocktakes" },
      { key: "stocktakes.approve", label: "Approve stocktake variances" },
    ],
  },
  {
    id: "hr",
    label: "HR & Payroll",
    permissions: [
      { key: "employees.view", label: "View employees" },
      { key: "employees.create", label: "Create employees" },
      { key: "employees.edit", label: "Edit employees" },
      { key: "employees.delete", label: "Delete employees" },
      { key: "attendance.view", label: "View attendance" },
      { key: "attendance.create", label: "Mark attendance" },
      { key: "leaves.view", label: "View leaves" },
      { key: "leaves.approve", label: "Approve leaves" },
      { key: "salary.view", label: "View salary" },
      { key: "salary.create", label: "Generate salary" },
      { key: "salary.edit", label: "Edit salary" },
      { key: "salary_advances.view", label: "View salary advances" },
      { key: "salary_advances.create", label: "Record salary advances" },
      // v2.0
      { key: "timeclock.view", label: "View time clock records" },
      { key: "timeclock.manage", label: "Manage clock-in / clock-out" },
      { key: "timeclock.approve_overtime", label: "Approve overtime" },
    ],
  },
  {
    id: "reports",
    label: "Reports & Insights",
    permissions: [
      { key: "reports.view", label: "View standard reports" },
      { key: "reports.financial", label: "View financial reports" },
      { key: "decision_engine.view", label: "View Decision Engine" },
      { key: "decision_engine.financial", label: "View Decision Engine financial tabs" },
      { key: "insights.view", label: "View insights" },
      { key: "dashboard.view", label: "View dashboard" },
      { key: "dashboard.view_pnl", label: "View Owner's P&L dashboard", description: "Reveals P&L tiles, settlement totals, vendor payables, and trend charts." },
    ],
  },
  {
    id: "admin",
    label: "Administration",
    permissions: [
      { key: "users.view", label: "View users" },
      { key: "users.create", label: "Create users" },
      { key: "users.edit", label: "Edit users" },
      { key: "users.delete", label: "Delete users" },
      { key: "roles.view", label: "View roles" },
      { key: "roles.edit", label: "Edit roles & permissions" },
      { key: "config.edit", label: "Edit system configuration" },
      { key: "audit_logs.view", label: "View audit logs" },
      { key: "backup.run", label: "Run backups" },
      { key: "pos_integrations.manage", label: "Manage POS integrations" },
      // v2.0
      { key: "notifications.manage", label: "Manage notification rules" },
      { key: "global_search.use", label: "Use global search" },
    ],
  },
];

/** Flat list of every valid permission key. */
export const ALL_PERMISSION_KEYS: string[] = PERMISSION_CATEGORIES.flatMap(
  (c) => c.permissions.map((p) => p.key)
);

const ALL_KEYS_SET = new Set(ALL_PERMISSION_KEYS);

export function isValidPermissionKey(key: string): boolean {
  return ALL_KEYS_SET.has(key);
}

export interface BuiltInRoleDef {
  name: string;
  description: string;
  permissions: string[] | "*";
}

export const BUILT_IN_ROLES: BuiltInRoleDef[] = [
  {
    name: "owner",
    description: "Full access to every module — typically the cafe owner.",
    permissions: "*",
  },
  {
    name: "admin",
    description: "Administrator — full access with the ability to manage users and roles.",
    permissions: "*",
  },
  {
    name: "manager",
    description: "Day-to-day operations: sales, tables, KOT, EOD, purchases, inventory, reports.",
    permissions: [
      "dashboard.view",
      "sales.view", "sales.create", "sales.edit", "sales.import",
      "settlements.view", "settlements.create", "settlements.verify",
      "customers.view", "customers.edit",
      "waste.view", "waste.create",
      "vendors.view", "vendors.create", "vendors.edit",
      "purchases.view", "purchases.create", "purchases.edit",
      "purchase_orders.view", "purchase_orders.create",
      "ingredients.view", "menu_items.view",
      "inventory.view", "inventory.edit",
      "stocktakes.view", "stocktakes.manage",
      "expenses.view", "expenses.create",
      "expense_budgets.view",
      "petty_cash.view", "petty_cash.create",
      "vendor_payments.view", "vendor_payments.create",
      "tables.view", "tables.edit",
      "kot.view", "kot.edit",
      "eod.view", "eod.manage",
      "reservations.view", "reservations.edit",
      "timeclock.view", "timeclock.manage",
      "reports.view", "decision_engine.view", "insights.view",
      "global_search.use",
    ],
  },
  {
    name: "cashier",
    description: "Front of house: sales, tables, KOT, petty cash.",
    permissions: [
      "dashboard.view",
      "sales.view", "sales.create", "sales.edit",
      "customers.view",
      "tables.view", "tables.edit",
      "kot.view", "kot.edit",
      "reservations.view",
      "petty_cash.view", "petty_cash.create",
      "menu_items.view",
      "global_search.use",
    ],
  },
  {
    name: "kitchen",
    description: "Kitchen: KOT management, inventory view, waste recording.",
    permissions: [
      "dashboard.view",
      "kot.view", "kot.edit",
      "inventory.view",
      "ingredients.view", "menu_items.view",
      "waste.view", "waste.create",
    ],
  },
  {
    name: "accountant",
    description: "Finance focus: expenses, petty cash, vendor payments, settlements, financial reports.",
    permissions: [
      "dashboard.view",
      "expenses.view", "expenses.create", "expenses.edit", "expenses.delete",
      "expense_budgets.view", "expense_budgets.edit",
      "petty_cash.view", "petty_cash.create", "petty_cash.delete",
      "vendor_payments.view", "vendor_payments.create", "vendor_payments.delete",
      "settlements.view", "settlements.verify",
      "vendors.view", "purchases.view",
      "purchase_orders.view",
      "reports.view", "reports.financial",
      "decision_engine.view", "decision_engine.financial",
      "audit_logs.view",
      "menu_items.view_margin", "dashboard.view_pnl",
      "global_search.use",
    ],
  },
  {
    name: "store",
    description: "Store / kitchen: purchases, inventory, ingredients, waste.",
    permissions: [
      "dashboard.view",
      "vendors.view",
      "purchases.view", "purchases.create", "purchases.edit",
      "purchase_orders.view", "purchase_orders.create",
      "ingredients.view", "ingredients.edit",
      "menu_items.view", "menu_items.edit",
      "inventory.view", "inventory.edit",
      "stocktakes.view", "stocktakes.manage",
      "waste.view", "waste.create",
      "reports.view",
    ],
  },
  {
    name: "hr",
    description: "Human resources: employees, attendance, time clock, leaves, salary.",
    permissions: [
      "dashboard.view",
      "employees.view", "employees.create", "employees.edit",
      "attendance.view", "attendance.create",
      "timeclock.view", "timeclock.manage", "timeclock.approve_overtime",
      "leaves.view", "leaves.approve",
      "salary.view", "salary.create", "salary.edit",
      "salary_advances.view", "salary_advances.create",
      "reports.view",
    ],
  },
  {
    name: "viewer",
    description: "Read-only access across all modules.",
    permissions: [
      "dashboard.view",
      "sales.view", "settlements.view", "customers.view", "waste.view",
      "expenses.view", "expense_budgets.view", "petty_cash.view", "vendor_payments.view",
      "vendors.view", "purchases.view", "purchase_orders.view", "ingredients.view",
      "menu_items.view", "inventory.view", "stocktakes.view",
      "tables.view", "kot.view", "eod.view", "reservations.view",
      "employees.view", "attendance.view", "timeclock.view", "leaves.view", "salary.view",
      "reports.view", "decision_engine.view", "insights.view",
      "global_search.use",
    ],
  },
];
