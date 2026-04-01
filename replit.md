# Epic Poetry Cafe - Operations Management System

## Overview

Comprehensive cafe operations management system with modules for vendors, ingredients, menu/recipes with costing engine, purchases, expenses, inventory/stock tracking, sales, waste management, trials/R&D, daily P&L analytics, dashboards, reports, and audit logs.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/epic-poetry-cafe)
- **API framework**: Express 5 (artifacts/api-server)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Auth**: Custom JWT (HMAC-SHA256) with SESSION_SECRET env var

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (port from PORT env)
│   │   └── src/
│   │       ├── routes/     # All API route files (auth, users, categories, uom, config, vendors, ingredients, menuItems, purchases, expenses, inventory, sales, waste, trials, dashboard, reports, auditLogs)
│   │       ├── lib/        # Auth (JWT), audit logging, code generator
│   │       └── seed.ts     # Seeds admin user + categories + UOMs + config
│   └── epic-poetry-cafe/   # React frontend (Vite)
│       └── src/
│           ├── pages/      # Login, Dashboard, Vendors, Ingredients, Menu, Purchases, Expenses, Sales, Inventory, Waste, Trials, Reports, AuditLogs, Masters
│           ├── components/ # Layout (sidebar+topbar), UI extras
│           └── lib/        # Auth context (JWT token in localStorage)
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
│       └── src/schema/     # 14 schema files (users, categories, uom, config, vendors, ingredients, menuItems, purchases, expenses, inventory, sales, waste, trials, auditLogs)
├── scripts/                # Utility scripts
└── pnpm-workspace.yaml
```

## Database Tables (14)

users, categories, uom, system_config, vendors, ingredients, ingredient_vendor_mapping, menu_items, recipe_lines, purchases, purchase_lines, expenses, stock_snapshots, stock_adjustments, sales_entries, waste_entries, trials, trial_versions, trial_ingredient_lines, audit_logs

## API Routes

All routes under `/api` prefix. Global auth middleware requires Bearer token for all routes except `/api/healthz` and `/api/auth/login`.

- **Auth**: POST /auth/login, GET /auth/me
- **Users**: GET/POST /users, PATCH /users/:id
- **Categories**: GET/POST /categories, PATCH/DELETE /categories/:id
- **UOM**: GET/POST /uom, PATCH /uom/:id
- **Config**: GET/PATCH /config
- **Vendors**: GET/POST /vendors, GET/PATCH/DELETE /vendors/:id, GET /vendors/:id/spend-summary
- **Ingredients**: GET/POST /ingredients, GET/PATCH/DELETE /ingredients/:id, GET/POST /ingredients/:id/vendor-mappings
- **Menu Items**: GET/POST /menu-items, GET/PATCH/DELETE /menu-items/:id, GET/PUT /menu-items/:id/recipe, GET /menu-items/:id/costing
- **Purchases**: GET/POST /purchases, GET /purchases/:id
- **Expenses**: GET/POST /expenses, GET/PATCH/DELETE /expenses/:id (Petty Cash payment mode auto-creates linked petty cash ledger entry)
- **Settlements**: GET/POST /settlements, GET/PATCH/DELETE /settlements/:id, POST /settlements/:id/verify, GET /settlements/sales-summary?date=
- **Petty Cash**: GET/POST /petty-cash, DELETE /petty-cash/:id, GET /petty-cash/summary
- **Inventory**: GET /inventory/stock-overview, GET/POST /inventory/stock-snapshots, POST /inventory/adjustments
- **Sales**: GET/POST /sales, PATCH/DELETE /sales/:id, GET /sales/daily-summary
- **Waste**: GET/POST /waste, PATCH/DELETE /waste/:id, GET /waste/summary
- **Trials**: GET/POST /trials, GET/PATCH/DELETE /trials/:id, POST /trials/:id/versions, POST /trials/:trialId/versions/:versionId/convert
- **Upload**: POST /upload/sales, /upload/purchases, /upload/expenses, /upload/menu (multipart file), GET /upload/template/:type (xlsx template download, type=sales|purchases|expenses|menu)
- **Reports (Analytics)**: GET /reports/item-profitability, /reports/item-wastage (params: period=daily|weekly|monthly|custom, fromDate, toDate)
- **Dashboard**: GET /dashboard/summary, /profitability, /daily-pl, /consumption-variance, /sales-trend, /expense-breakdown, /vendor-spend
- **Reports**: GET /reports/export?reportType=...
- **Audit Logs**: GET /audit-logs

## Auth

- Custom JWT auth: POST /auth/login, GET /auth/me
- Roles: `admin` (full access), `manager` (daily operations only), `viewer` (read-only)
- Admin-only routes: config PATCH, users CRUD, audit-logs, upload, reports, trials
- **User Management page**: Admin can create users, assign roles (Admin/Manager/Viewer), edit profiles, change passwords, activate/deactivate accounts
- Manager can access: dashboard, sales, purchases, expenses, waste, menu, ingredients, inventory, vendors
- Default users: admin / admin123 (admin role), manager / manager123 (manager role)
- JWT stored in localStorage, sent as Authorization: Bearer header

## Verification System

- **Admin verification** on 6 modules: Ingredients, Menu Items, Sales, Purchases, Expenses, Waste
- DB columns: `verified` (boolean, default false), `verifiedBy` (int, nullable), `verifiedAt` (timestamp, nullable)
- API endpoints: `PATCH /:id/verify` and `PATCH /:id/unverify` (admin-only via `adminOnly` middleware)
- Edit/delete guards: If `verified=true` AND `userRole !== "admin"` → 403 on PATCH/DELETE (including recipe updates for menu items)
- Admin can always edit/delete regardless of verification status
- Frontend: `VerifyButton` component in ui-extras.tsx; each table shows Verified column with toggle buttons for admin, read-only badges for non-admin
- `apiVerify(module, id)` and `apiUnverify(module, id)` helper functions use `customFetch` directly (not generated hooks)

## Key Features

- **Costing Engine**: Weighted average (default), latest, or standard cost methods. Uses UOM conversion factor (stock-to-recipe) for accurate recipe line costing.
- **Auto code generation**: VND0001, ING0001, MNU0001, PUR0001, EXP0001, WST0001, TRL0001
- **Purchase -> Inventory**: Purchases auto-update ingredient stock + weighted avg cost
- **Waste -> Stock**: Ingredient waste auto-deducts from stock
- **Trial -> Menu**: Convert approved trial versions to menu item recipes
- **Daily Sales Settlement**: Reconcile daily sales against payment collections (Cash, Card, QR, UPI, etc.); one settlement per date; auto-calculates difference (matched/short/excess); admin-only verification workflow
- **Petty Cash Ledger**: Full petty cash management (receipts, expenses, adjustments); running balance tracking; negative balance protection; auto-linked when expenses use "Petty Cash" payment mode
- **Expense-Petty Cash Link**: Creating expense with "Petty Cash" payment mode auto-creates petty cash ledger entry; deleting expense auto-removes linked petty cash entry; linked entries cannot be deleted directly from petty cash
- **Daily P&L**: Real-time profit/loss calculation from sales, material cost, waste, expenses
- **Consumption Variance**: Compare actual vs theoretical ingredient consumption (converted to stock UOM)
- **Excel Upload**: Bulk import sales, purchases, expenses from .xlsx/.xls files with row-by-row validation, auto name-matching (vendors, ingredients, menu items), and detailed import results
- **Auth Token**: Frontend uses setAuthTokenGetter from custom-fetch for global API auth header injection
- **PATCH operations**: All update schemas use .partial() for optional field updates
- **Role-based Dashboard**: Admin sees "Owner's Dashboard" with full P&L, settlements, insights, top items. Manager/viewer sees "Operations Dashboard" with only: sales (with comparison badges), expenses, waste, petty cash balance, petty cash spent
- **Dashboard Date Filters**: Filter bar with Today/Date/Date Range/This Week/This Month modes. Week and month modes have prev/next navigation arrows. Labels dynamically adjust (e.g., "Today's Sales" → "Weekly Sales" → "Monthly Sales"). Backend accepts fromDate/toDate query params, falling back to single date for backward compat. Range mode compares vs previous equivalent period
- **Menu Cost Visibility**: Production cost and margin columns on Menu Items page are hidden from non-admin users
- **Route-level Access Control**: Admin-only pages (Trials, Analytics, Reports, Masters, Upload) show "Access Restricted" page for non-admin users, even if accessed via direct URL
- **Employee Module**: Full employee management with auto-generated codes (EMP0001...), contact, position, salary, part-time/full-time. Admin-only CRUD; non-admin sees only name, code, position, type (no salary/contact)
- **Shifts**: Define shifts with name, start/end time. Used in attendance marking
- **Attendance**: Daily attendance with bulk save — statuses: present, half-day, absent, week-off. All users can mark attendance
- **Leave Management**: Record paid/unpaid leaves per employee per date. Week-off = paid leave (no deduction). All users can record leaves
- **Salary Generation**: Admin-only. Auto-computes net salary from base salary, attendance, leaves. Deductions for unpaid leaves, absences, and half-days (0.5× per-day rate). DB-level date filtering with LIKE on YYYY-MM prefix
