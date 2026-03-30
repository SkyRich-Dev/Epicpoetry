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
- **Expenses**: GET/POST /expenses, GET/PATCH/DELETE /expenses/:id
- **Inventory**: GET /inventory/stock-overview, GET/POST /inventory/stock-snapshots, POST /inventory/adjustments
- **Sales**: GET/POST /sales, PATCH/DELETE /sales/:id, GET /sales/daily-summary
- **Waste**: GET/POST /waste, PATCH/DELETE /waste/:id, GET /waste/summary
- **Trials**: GET/POST /trials, GET/PATCH/DELETE /trials/:id, POST /trials/:id/versions, POST /trials/:trialId/versions/:versionId/convert
- **Dashboard**: GET /dashboard/summary, /profitability, /daily-pl, /consumption-variance, /sales-trend, /expense-breakdown, /vendor-spend
- **Reports**: GET /reports/export?reportType=...
- **Audit Logs**: GET /audit-logs

## Auth

- Login: admin / admin123
- JWT stored in localStorage, sent as Authorization: Bearer header
- Roles: admin, owner, manager, purchase_store, kitchen_bar, accounts, viewer

## Key Features

- **Costing Engine**: Weighted average (default), latest, or standard cost methods. Uses UOM conversion factor (stock-to-recipe) for accurate recipe line costing.
- **Auto code generation**: VND0001, ING0001, MNU0001, PUR0001, EXP0001, WST0001, TRL0001
- **Purchase -> Inventory**: Purchases auto-update ingredient stock + weighted avg cost
- **Waste -> Stock**: Ingredient waste auto-deducts from stock
- **Trial -> Menu**: Convert approved trial versions to menu item recipes
- **Daily P&L**: Real-time profit/loss calculation from sales, material cost, waste, expenses
- **Consumption Variance**: Compare actual vs theoretical ingredient consumption (converted to stock UOM)
- **Auth Token**: Frontend uses setAuthTokenGetter from custom-fetch for global API auth header injection
- **PATCH operations**: All update schemas use .partial() for optional field updates
