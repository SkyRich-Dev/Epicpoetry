/**
 * Platr permission catalog.
 *
 * Permissions are organised into feature CATEGORIES (Account, Operation,
 * Purchase, HR, Reports, Admin). The Role Management UI uses these
 * categories to render a grouped checkbox matrix so an owner can assign
 * permissions in bulk by category.
 *
 * Each permission has a stable string key (e.g. "expenses.create") that
 * is what gets stored in role_permissions.permission_key.
 *
 * The frontend reads this catalog from GET /api/permissions and uses
 * effective permissions from GET /api/auth/me to gate buttons / nav.
 *
 * NOTE: existing route-level guards (`adminOnly`, `managerOrAdmin`) are
 * preserved as-is. The richer `requirePermission(key)` middleware is
 * available for new endpoints and can be wired into existing routes
 * incrementally without breaking them.
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
      { key: "inventory.view", label: "View inventory" },
      { key: "inventory.edit", label: "Adjust inventory" },
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

/**
 * Default built-in roles. These are seeded on first boot. The owner can
 * tweak the permission set from the Roles tab, but cannot delete a
 * built-in role.
 */
export interface BuiltInRoleDef {
  name: string;
  description: string;
  /** "*" means all permissions */
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
    description: "Day-to-day operations: sales, settlements, customers, purchases, inventory, reports view.",
    permissions: [
      "dashboard.view",
      "sales.view", "sales.create", "sales.edit", "sales.import",
      "settlements.view", "settlements.create", "settlements.verify",
      "customers.view", "customers.edit",
      "waste.view", "waste.create",
      "vendors.view", "vendors.create", "vendors.edit",
      "purchases.view", "purchases.create", "purchases.edit",
      "ingredients.view", "menu_items.view",
      "inventory.view", "inventory.edit",
      "expenses.view", "expenses.create",
      "petty_cash.view", "petty_cash.create",
      "vendor_payments.view", "vendor_payments.create",
      "reports.view", "decision_engine.view", "insights.view",
    ],
  },
  {
    name: "accountant",
    description: "Finance focus: expenses, petty cash, vendor payments, settlements, financial reports.",
    permissions: [
      "dashboard.view",
      "expenses.view", "expenses.create", "expenses.edit", "expenses.delete",
      "petty_cash.view", "petty_cash.create", "petty_cash.delete",
      "vendor_payments.view", "vendor_payments.create", "vendor_payments.delete",
      "settlements.view", "settlements.verify",
      "vendors.view", "purchases.view",
      "reports.view", "reports.financial",
      "decision_engine.view", "decision_engine.financial",
      "audit_logs.view",
    ],
  },
  {
    name: "store",
    description: "Store / kitchen: purchases, inventory, ingredients, waste.",
    permissions: [
      "dashboard.view",
      "vendors.view",
      "purchases.view", "purchases.create", "purchases.edit",
      "ingredients.view", "ingredients.edit",
      "menu_items.view", "menu_items.edit",
      "inventory.view", "inventory.edit",
      "waste.view", "waste.create",
      "reports.view",
    ],
  },
  {
    name: "hr",
    description: "Human resources: employees, attendance, leaves, salary.",
    permissions: [
      "dashboard.view",
      "employees.view", "employees.create", "employees.edit",
      "attendance.view", "attendance.create",
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
      "expenses.view", "petty_cash.view", "vendor_payments.view",
      "vendors.view", "purchases.view", "ingredients.view",
      "menu_items.view", "inventory.view",
      "employees.view", "attendance.view", "leaves.view", "salary.view",
      "reports.view", "decision_engine.view", "insights.view",
    ],
  },
];
