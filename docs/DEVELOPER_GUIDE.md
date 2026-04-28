# Developer Guide
# Epic Poetry Cafe - Operations Management System

**Version:** 1.0
**Date:** April 4, 2026

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Repository Structure](#4-repository-structure)
5. [Getting Started](#5-getting-started)
6. [Database Schema](#6-database-schema)
7. [Backend (API Server)](#7-backend-api-server)
8. [Frontend (Epic Poetry Cafe)](#8-frontend-epic-poetry-cafe)
9. [Shared Libraries](#9-shared-libraries)
10. [API Reference](#10-api-reference)
11. [Authentication & Authorization](#11-authentication--authorization)
12. [Business Logic](#12-business-logic)
13. [POS Integration](#13-pos-integration)
14. [Coding Conventions](#14-coding-conventions)
15. [Common Operations](#15-common-operations)
16. [Known Limitations & Deferred Issues](#16-known-limitations--deferred-issues)
17. [Deployment](#17-deployment)

---

## 1. Project Overview

Epic Poetry Cafe is a single-cafe operations management system where **all sales flow through invoices only** (via Petpooja POS integration or manual entry). The system manages the complete operational lifecycle: vendor procurement, ingredient inventory, recipe costing, sales tracking, expense management, waste tracking, employee management, daily settlements, and financial analytics.

**Default Credentials:**
- Admin: `admin` / `admin123`
- Manager: `manager` / `manager123`

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (SPA)                           │
│                  React + Vite + React Query                     │
│              artifacts/epic-poetry-cafe/                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP (JSON)
                           │ Authorization: Bearer <JWT>
┌──────────────────────────▼──────────────────────────────────────┐
│                      API Server (Express 5)                     │
│                   artifacts/api-server/                          │
│                                                                 │
│   ┌───────────┐  ┌────────────┐  ┌────────────┐                │
│   │ Auth MW   │→ │ Route      │→ │ Drizzle    │                │
│   │ (JWT)     │  │ Handlers   │  │ ORM        │                │
│   └───────────┘  └────────────┘  └─────┬──────┘                │
│                                        │                        │
│   ┌────────────────────────────────────▼──────────────────────┐ │
│   │           Shared DB Package (lib/db/)                     │ │
│   │           Schema + Drizzle Config                         │ │
│   └────────────────────────────────────┬──────────────────────┘ │
└────────────────────────────────────────┼────────────────────────┘
                                         │
                              ┌──────────▼──────────┐
                              │    PostgreSQL DB     │
                              │    (Replit-hosted)   │
                              └─────────────────────┘
```

**Key architectural decisions:**
- **Custom JWT** (no library dependency): HMAC-SHA256 signing with manual token creation/verification in `lib/auth.ts`.
- **No ORM migrations**: Drizzle Kit `push` is used for schema sync (not migration files).
- **Monorepo**: npm workspaces with shared packages (`lib/db`, `lib/api-zod`, `lib/api-client-react`, `lib/api-spec`).
- **Code generation**: OpenAPI spec → Orval → React Query hooks + Zod schemas.

---

## 3. Technology Stack

| Layer | Technology | Version |
|:---|:---|:---|
| Runtime | Node.js | 24+ |
| Language | TypeScript | 5.9 |
| Frontend | React | 19 |
| Build Tool | Vite | 6 |
| Backend Framework | Express | 5 |
| ORM | Drizzle ORM | Latest |
| Database | PostgreSQL | 16+ |
| Validation | Zod (v4) | Latest |
| State Management | React Query (TanStack) | v5 |
| Routing (Frontend) | Wouter | Latest |
| Charts | Recharts | Latest |
| UI Components | Custom (Tailwind CSS + Radix) | — |
| Package Manager | npm workspaces | 11+ |
| Bundler (Backend) | esbuild | Latest |
| API Codegen | Orval | Latest |

---

## 4. Repository Structure

```
/
├── artifacts/
│   ├── api-server/                    # Express 5 backend
│   │   ├── src/
│   │   │   ├── app.ts                 # Express app setup, global middleware
│   │   │   ├── index.ts               # Server entry point (port binding)
│   │   │   ├── seed.ts                # Database seeding (admin user, default config)
│   │   │   ├── lib/
│   │   │   │   ├── auth.ts            # JWT creation/verification, password hashing, RBAC middleware
│   │   │   │   ├── audit.ts           # Audit log helper
│   │   │   │   ├── codeGenerator.ts   # Auto-incrementing code generator (VND0001, ING0001, etc.)
│   │   │   │   ├── dateValidation.ts  # Future date validation helper
│   │   │   │   └── logger.ts          # Console logger
│   │   │   └── routes/
│   │   │       ├── index.ts           # Route registration
│   │   │       ├── auth.ts            # Login, me, change-password
│   │   │       ├── users.ts           # User CRUD (admin-only)
│   │   │       ├── categories.ts      # Category CRUD
│   │   │       ├── vendors.ts         # Vendor CRUD + finance
│   │   │       ├── vendorPayments.ts  # Vendor payment recording + ledger
│   │   │       ├── ingredients.ts     # Ingredient CRUD + vendor mapping
│   │   │       ├── menuItems.ts       # Menu items + recipe + costing
│   │   │       ├── purchases.ts       # Purchase recording + stock update
│   │   │       ├── salesInvoices.ts   # Sales invoice management
│   │   │       ├── sales.ts           # Legacy sales data (kept for templates)
│   │   │       ├── expenses.ts        # Expense management
│   │   │       ├── waste.ts           # Waste tracking
│   │   │       ├── inventory.ts       # Stock overview, snapshots, adjustments
│   │   │       ├── settlements.ts     # Daily settlement reconciliation
│   │   │       ├── pettyCash.ts       # Petty cash ledger
│   │   │       ├── employees.ts       # Employees, attendance, salary
│   │   │       ├── trials.ts          # R&D trials
│   │   │       ├── dashboard.ts       # Dashboard metrics + P&L
│   │   │       ├── reports.ts         # Profitability + export
│   │   │       ├── config.ts          # System configuration
│   │   │       ├── auditLogs.ts       # Audit log retrieval
│   │   │       ├── backup.ts          # Database backup download
│   │   │       ├── upload.ts          # Excel bulk import
│   │   │       ├── posIntegrations.ts # POS integration config
│   │   │       ├── uom.ts            # Unit of measure CRUD
│   │   │       └── health.ts          # Health check endpoint
│   │   ├── build.mjs                  # esbuild configuration
│   │   └── package.json
│   │
│   ├── epic-poetry-cafe/              # React + Vite frontend
│   │   ├── src/
│   │   │   ├── App.tsx                # Route definitions, auth guards
│   │   │   ├── main.tsx               # Entry point
│   │   │   ├── context/
│   │   │   │   └── auth.tsx           # AuthContext (JWT token + user state)
│   │   │   ├── pages/
│   │   │   │   ├── login.tsx          # Login page
│   │   │   │   ├── dashboard.tsx      # Role-based dashboard
│   │   │   │   ├── menu-items.tsx     # Menu items + recipe builder
│   │   │   │   ├── ingredients.tsx    # Ingredient management
│   │   │   │   ├── vendors.tsx        # Vendor list
│   │   │   │   ├── vendor-detail.tsx  # Vendor detail + payments
│   │   │   │   ├── purchases.tsx      # Purchase management
│   │   │   │   ├── sales.tsx          # Sales invoice views
│   │   │   │   ├── inventory.tsx      # Stock overview + EOD snapshots
│   │   │   │   ├── settlements.tsx    # Daily settlements
│   │   │   │   ├── petty-cash.tsx     # Petty cash ledger
│   │   │   │   ├── expenses.tsx       # Expense management
│   │   │   │   ├── waste.tsx          # Waste tracking
│   │   │   │   ├── trials.tsx         # R&D trials (admin-only)
│   │   │   │   ├── employees.tsx      # Employee management
│   │   │   │   ├── attendance.tsx     # Attendance tracking
│   │   │   │   ├── analytics.tsx      # Advanced analytics (admin-only)
│   │   │   │   ├── reports.tsx        # Reports
│   │   │   │   ├── masters.tsx        # System admin (config, users, POS)
│   │   │   │   ├── upload.tsx         # Bulk data import
│   │   │   │   ├── petpooja-mappings.tsx  # POS item mappings
│   │   │   │   └── not-found.tsx      # 404 page
│   │   │   ├── components/
│   │   │   │   ├── layout.tsx         # Sidebar + topbar layout wrapper
│   │   │   │   ├── ui/               # Shared UI primitives (button, card, modal, etc.)
│   │   │   │   └── ui-extras.tsx      # Domain-specific components (PageHeader, DateFilter, StatCard, etc.)
│   │   │   ├── hooks/
│   │   │   │   ├── use-toast.ts       # Toast notification hook
│   │   │   │   └── use-mobile.tsx     # Mobile detection hook
│   │   │   └── lib/
│   │   │       └── utils.ts           # Helpers: formatCurrency, formatDate, cn()
│   │   └── package.json
│   │
│   └── mockup-sandbox/                # Design mockup preview server
│
├── lib/
│   ├── db/                            # Shared database package
│   │   ├── src/
│   │   │   ├── index.ts               # DB connection + Drizzle instance
│   │   │   └── schema/                # All Drizzle table definitions (21 files)
│   │   └── drizzle.config.ts
│   ├── api-spec/                      # OpenAPI specification (GENERATED — do not edit)
│   ├── api-zod/                       # Zod schemas from OpenAPI (GENERATED — do not edit)
│   └── api-client-react/              # React Query hooks from OpenAPI (GENERATED — do not edit)
│
├── pnpm-workspace.yaml            # Legacy workspace metadata retained for compatibility
├── package.json
└── replit.md
```

**Important: Do NOT manually edit files in `lib/api-spec/`, `lib/api-zod/`, or `lib/api-client-react/`** — these are auto-generated by Orval from the OpenAPI specification.

---

## 5. Getting Started

### 5.1 Prerequisites
- Node.js 24+
- npm 11+
- PostgreSQL database (provided by Replit environment via `DATABASE_URL`)

### 5.2 Installation

```bash
# Install all dependencies
npm install --legacy-peer-deps

# Prepare and push database schema
npm run db:prepare
npm run db:push

# Start the API server (builds + starts)
npm run dev:api

# Start the frontend (separate terminal)
npm run dev:web
```

### 5.3 Environment Variables

| Variable | Description | Required |
|:---|:---|:---|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `SESSION_SECRET` | JWT signing secret | Yes (falls back to random bytes) |
| `PORT` | Server port (assigned by Replit) | Yes |
| `NODE_ENV` | `development` or `production` | Optional |

### 5.4 Database Seeding
On first startup, `seed.ts` runs automatically and creates:
- Default admin user (`admin` / `admin123`)
- Default manager user (`manager` / `manager123`)
- Default system configuration record

---

## 6. Database Schema

### 6.1 Table Overview

The database contains 30+ tables organized into these domains:

| Domain | Tables |
|:---|:---|
| **User Management** | `users` |
| **Core Masters** | `categories`, `uom`, `vendors`, `ingredient_vendor_mapping` |
| **Inventory** | `ingredients`, `stock_snapshots`, `stock_adjustments` |
| **Menu & Recipes** | `menu_items`, `recipe_lines` |
| **Purchases** | `purchases`, `purchase_lines` |
| **Sales** | `sales_invoices`, `sales_invoice_lines`, `sales_entries` |
| **Expenses** | `expenses` |
| **Waste** | `waste_entries` |
| **Finance** | `vendor_payments`, `vendor_payment_allocations`, `vendor_ledger`, `petty_cash_ledger`, `daily_sales_settlements`, `settlement_lines` |
| **HR** | `employees`, `shifts`, `attendance`, `leaves`, `salary_records` |
| **R&D** | `trials`, `trial_versions`, `trial_ingredient_lines` |
| **Integration** | `pos_integrations`, `petpooja_item_mappings` |
| **System** | `system_config`, `audit_logs` |

### 6.2 Key Tables Detail

#### users
```
id              serial PRIMARY KEY
username        text UNIQUE NOT NULL
passwordHash    text NOT NULL          -- PBKDF2 format: "salt:hash"
fullName        text NOT NULL
email           text
role            text DEFAULT 'viewer'  -- 'admin' | 'manager' | 'viewer'
active          boolean DEFAULT true
createdAt       timestamp DEFAULT now()
updatedAt       timestamp DEFAULT now()
```

#### ingredients
```
id              serial PRIMARY KEY
code            text UNIQUE NOT NULL    -- Auto: ING0001
name            text NOT NULL
categoryId      integer → categories.id
stockUom        text NOT NULL           -- e.g., 'g', 'ml', 'unit'
purchaseUom     text NOT NULL           -- e.g., 'kg', 'litre', 'box'
recipeUom       text NOT NULL           -- e.g., 'g', 'ml'
conversionFactor doublePrecision DEFAULT 1  -- purchase→stock conversion
currentCost     doublePrecision DEFAULT 0
latestCost      doublePrecision DEFAULT 0
weightedAvgCost doublePrecision DEFAULT 0
currentStock    doublePrecision DEFAULT 0
reorderLevel    doublePrecision DEFAULT 0
perishable      boolean DEFAULT false
shelfLifeDays   integer
active          boolean DEFAULT true
verified        boolean DEFAULT false
```

#### menu_items
```
id              serial PRIMARY KEY
code            text UNIQUE             -- Auto: MENU0001
name            text NOT NULL
categoryId      integer → categories.id
sellingPrice    doublePrecision
dineInPrice     doublePrecision
takeawayPrice   doublePrecision
deliveryPrice   doublePrecision
active          boolean DEFAULT true
verified        boolean DEFAULT false
```

#### recipe_lines
```
id              serial PRIMARY KEY
menuItemId      integer → menu_items.id
ingredientId    integer → ingredients.id
quantity        doublePrecision
uom             text
wastagePercent  doublePrecision
mandatory       boolean DEFAULT true
```

#### purchases
```
id              serial PRIMARY KEY
purchaseNumber  text UNIQUE             -- Auto: PUR0001
vendorId        integer → vendors.id
purchaseDate    text NOT NULL
invoiceNumber   text
paymentMode     text
grossAmount     doublePrecision
taxAmount       doublePrecision
totalAmount     doublePrecision
paidAmount      doublePrecision DEFAULT 0
pendingAmount   doublePrecision
paymentStatus   text DEFAULT 'unpaid'   -- 'unpaid' | 'partial' | 'paid'
verified        boolean DEFAULT false
```

#### sales_invoices
```
id              serial PRIMARY KEY
invoiceNumber   text NOT NULL
salesDate       text NOT NULL
sourceType      text DEFAULT 'MANUAL'   -- 'MANUAL' | 'PETPOOJA' | 'IMPORT'
orderType       text                    -- 'dine-in' | 'takeaway' | 'delivery' | 'online'
paymentMode     text
grossAmount     doublePrecision
discount        doublePrecision DEFAULT 0
taxAmount       doublePrecision
netAmount       doublePrecision
gstInclusive    boolean DEFAULT false
verified        boolean DEFAULT false
```

### 6.3 Foreign Key Relationships & Delete Guards

The following delete guards are enforced at the application level (not DB-level CASCADE):

| Entity | Blocked If | Error Message |
|:---|:---|:---|
| Vendor | Has purchases | "Cannot delete vendor with existing purchases" |
| Ingredient | Has recipe lines or purchase lines | "Cannot delete ingredient used in recipes/purchases" |
| Category | Has menu items or ingredients | "Cannot delete category with linked items" |
| Menu Item | Has invoice lines | "Cannot delete menu item with sales records. Deactivate instead." |

All delete routes also catch PostgreSQL FK violation error code `23503` as a safety net.

### 6.4 Schema Changes

Schema changes are applied via Drizzle Kit push (no migration files):

```bash
cd lib/db
npx drizzle-kit push --force
```

**Critical:** Never change primary key column types (serial ↔ varchar). This generates destructive ALTER TABLE statements.

---

## 7. Backend (API Server)

### 7.1 Application Setup (`app.ts`)

The Express 5 app configures:
1. **JSON body parser** with 10MB limit
2. **Static file serving** for uploaded files
3. **Global auth middleware** that:
   - Skips `PUBLIC_PATHS`: `/api/healthz`, `/api/auth/login`
   - Skips `PUBLIC_PREFIXES`: `/api/webhook/`
   - Extracts Bearer token, verifies JWT
   - Attaches `req.userId` and `req.userRole` to the request

### 7.2 Authentication Library (`lib/auth.ts`)

```typescript
// Password hashing (PBKDF2 + random salt)
hashPassword(password: string): string
// Returns: "salt:derivedKey" (hex-encoded)
// Algorithm: pbkdf2Sync, 100,000 iterations, sha512, 64-byte key

verifyPassword(password: string, storedHash: string): boolean
// Handles both new PBKDF2 format (contains ":") and legacy SHA-256

// JWT management (custom, no library)
createToken(payload: object): string
// Signs with HMAC-SHA256, expires in 7 days

verifyToken(token: string): object | null
// Manual base64url decode + HMAC verification + expiry check

// Middleware
authMiddleware(req, res, next)   // Requires valid JWT
adminOnly(req, res, next)        // Requires role === 'admin'
```

### 7.3 Code Generator (`lib/codeGenerator.ts`)

Auto-generates sequential codes per entity:
```typescript
generateCode(prefix: string, table: any, codeColumn: any): string
// Queries MAX existing code, extracts numeric part, increments
// Example: VND0001, VND0002, ING0001, PUR0001
```

### 7.4 Audit Logger (`lib/audit.ts`)

```typescript
logAudit(db, { module, action, recordId, oldValue, newValue, userId })
// Records all CUD operations with before/after snapshots
```

### 7.5 Date Validation (`lib/dateValidation.ts`)

```typescript
validateNotFutureDate(dateStr: string): { valid: boolean, error?: string }
// Rejects dates beyond today (prevents accidental future entries)
```

### 7.6 Route Pattern

All route files follow this consistent pattern:

```typescript
import { Router } from 'express';
import { db } from '@workspace/db';
import { someTable } from '@workspace/db/schema';
import { authMiddleware, adminOnly } from '../lib/auth';

const router = Router();

// List (usually no extra auth beyond global middleware)
router.get('/', async (req, res) => { ... });

// Create (uses authMiddleware or adminOnly)
router.post('/', authMiddleware, async (req, res) => { ... });

// Update
router.patch('/:id', authMiddleware, async (req, res) => { ... });

// Delete (with FK guard)
router.delete('/:id', authMiddleware, async (req, res) => {
  // 1. Check for FK references
  // 2. If references exist, return 400 with message
  // 3. Delete and reverse any side effects (stock, ledger)
  // 4. Catch Postgres error 23503 as safety net
});

// Verify / Unverify (admin-only)
router.post('/:id/verify', adminOnly, async (req, res) => { ... });
router.post('/:id/unverify', adminOnly, async (req, res) => { ... });

export default router;
```

### 7.7 Request/Response Casting

Auth data is attached to the request object via type assertion:

```typescript
const userId = (req as any).userId;
const userRole = (req as any).userRole;
```

---

## 8. Frontend (Epic Poetry Cafe)

### 8.1 Routing (`App.tsx`)

Routes are defined using Wouter with role-based guards:

```typescript
<ProtectedRoute>              {/* Requires authenticated user */}
  <Route path="/" component={Dashboard} />
  <Route path="/menu" component={MenuItems} />
  ...
  <AdminRoute path="/trials">  {/* Requires admin role */}
    <Trials />
  </AdminRoute>
</ProtectedRoute>
```

Admin-only routes: `/trials`, `/analytics`, `/masters`, `/petpooja-mappings`

### 8.2 Auth Context (`context/auth.tsx`)

```typescript
// Provides:
const { user, token, login, logout, isAuthenticated, isAdmin } = useAuth();

// Token stored in localStorage as 'token'
// User profile stored as 'user' (JSON)
// All API calls include: Authorization: Bearer <token>
```

### 8.3 API Integration

API calls are made through generated React Query hooks from Orval, or via direct `fetch` with the auth token:

```typescript
// Pattern used across pages:
const apiFetch = async (url: string, options?: RequestInit) => {
  const res = await fetch(`${BASE_URL}api${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options?.headers,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};
```

### 8.4 UI Component Library

#### Core Components (`components/ui/`)
Standard shadcn/ui-style components built with Tailwind CSS + Radix UI primitives:
- `button.tsx` — Variants: `default`, `outline`, `ghost`, `danger` (NOT "destructive")
- `card.tsx`, `input.tsx`, `select.tsx`, `textarea.tsx`
- `table.tsx`, `badge.tsx`, `modal.tsx`, `tabs.tsx`
- `toast.tsx` + `toaster.tsx`

#### Domain Components (`ui-extras.tsx`)
- `PageHeader` — Title, description, action buttons
- `DateFilter` / `DateFilterBar` — Standard date range picker
- `StatCard` — KPI metric display with trend indicator
- `VerifyButton` — Maker-checker verification toggle
- `StatusBadge` / `TypeBadge` / `RoleBadge` — Semantic status indicators

### 8.5 Formatting Utilities (`lib/utils.ts`)

```typescript
formatCurrency(value: number): string
// Uses Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })
// Output: "₹1,23,456.00"

formatDate(dateStr: string): string
// Formats to Indian locale date

cn(...classes): string
// Tailwind class merger (clsx + tailwind-merge)
```

**Important:** Always use `formatCurrency()` for monetary values. Never hardcode `₹`.

### 8.6 Toast Notifications

```typescript
import { useToast } from '@/hooks/use-toast';

const { toast } = useToast();

// Success
toast({ title: "Success", description: "Record saved" });

// Error
toast({ title: "Error", description: error.message, variant: "destructive" });
```

**Every page component** and **every sub-component that handles API calls** (like `RecipeBuilderModal`) must have its own `useToast()` hook instance. Never use `console.error` for user-facing errors.

### 8.7 CSS Conventions

- `font-numbers` class: Applied to numeric displays for tabular number alignment
- All spacing uses Tailwind utility classes
- Color scheme: Slate/zinc grays, amber accents for cafe branding
- Dark mode: Not supported

---

## 9. Shared Libraries

### 9.1 `lib/db` — Database Package

- **Connection**: Uses `DATABASE_URL` environment variable
- **ORM**: Drizzle ORM with PostgreSQL driver (`postgres` package)
- **Schema**: 21 schema files in `src/schema/`, re-exported from `src/schema/index.ts`
- **Usage**:
  ```typescript
  import { db } from '@workspace/db';
  import { ingredientsTable } from '@workspace/db/schema';
  ```

### 9.2 `lib/api-spec` — OpenAPI Specification (Generated)

Contains the OpenAPI 3.0 specification used by Orval for code generation. **Do not edit manually.**

### 9.3 `lib/api-zod` — Zod Schemas (Generated)

Auto-generated Zod validation schemas from the OpenAPI spec. Used by the API server for request validation.

### 9.4 `lib/api-client-react` — React Query Hooks (Generated)

Auto-generated TanStack Query hooks for the frontend. Provides type-safe API calls with automatic caching and refetching.

---

## 10. API Reference

### 10.1 Authentication

| Method | Endpoint | Auth | Description |
|:---|:---|:---|:---|
| POST | `/api/auth/login` | Public | Login with username/password |
| GET | `/api/auth/me` | User | Get current user profile |
| POST | `/api/auth/change-password` | User | Change own password |

### 10.2 User Management

| Method | Endpoint | Auth | Description |
|:---|:---|:---|:---|
| GET | `/api/users` | Admin | List all users |
| POST | `/api/users` | Admin | Create new user |
| PATCH | `/api/users/:id` | Admin | Update user |

### 10.3 Categories

| Method | Endpoint | Auth | Description |
|:---|:---|:---|:---|
| GET | `/api/categories` | User | List categories |
| POST | `/api/categories` | User | Create category |
| PATCH | `/api/categories/:id` | User | Update category |
| DELETE | `/api/categories/:id` | User | Delete (guarded) |

### 10.4 Vendors

| Method | Endpoint | Auth | Description |
|:---|:---|:---|:---|
| GET | `/api/vendors` | Public | List vendors with finance summary |
| POST | `/api/vendors` | User | Create vendor |
| GET | `/api/vendors/:id` | Public | Get vendor detail |
| PATCH | `/api/vendors/:id` | User | Update vendor |
| DELETE | `/api/vendors/:id` | User | Delete (guarded against purchases) |

### 10.5 Vendor Payments

| Method | Endpoint | Auth | Description |
|:---|:---|:---|:---|
| GET | `/api/vendor-payments` | User | List payments (filter by vendor/date) |
| POST | `/api/vendor-payments` | User | Record payment with bill allocations |

### 10.6 Ingredients

| Method | Endpoint | Auth | Description |
|:---|:---|:---|:---|
| GET | `/api/ingredients` | Public | List all ingredients |
| POST | `/api/ingredients` | User | Create ingredient |
| PATCH | `/api/ingredients/:id` | User | Update ingredient |
| DELETE | `/api/ingredients/:id` | User | Delete (guarded against recipes/purchases) |
| POST | `/api/ingredients/:id/verify` | Admin | Verify ingredient |
| GET | `/api/ingredients/:id/vendor-mappings` | User | Get vendor mappings |
| POST | `/api/ingredients/:id/vendor-mappings` | User | Create vendor mapping |

### 10.7 Menu Items & Recipes

| Method | Endpoint | Auth | Description |
|:---|:---|:---|:---|
| GET | `/api/menu-items` | Public | List items with production cost |
| POST | `/api/menu-items` | User | Create menu item |
| PATCH | `/api/menu-items/:id` | User | Update menu item |
| DELETE | `/api/menu-items/:id` | User | Delete (guarded against invoices) |
| GET | `/api/menu-items/:id/recipe` | Public | Get recipe lines |
| PUT | `/api/menu-items/:id/recipe` | User | Save recipe (replace all lines) |
| GET | `/api/menu-items/:id/costing` | Public | Get cost breakdown |
| POST | `/api/menu-items/:id/verify` | Admin | Verify menu item |

### 10.8 Purchases

| Method | Endpoint | Auth | Description |
|:---|:---|:---|:---|
| GET | `/api/purchases` | User | List purchases (filter by date/vendor) |
| POST | `/api/purchases` | User | Create purchase + update stock |
| DELETE | `/api/purchases/:id` | User | Delete + reverse stock |
| POST | `/api/purchases/:id/verify` | Admin | Verify purchase |

### 10.9 Sales Invoices

| Method | Endpoint | Auth | Description |
|:---|:---|:---|:---|
| GET | `/api/sales-invoices` | User | List invoices (filter by date/source/type) |
| POST | `/api/sales-invoices` | User | Create invoice with lines |
| DELETE | `/api/sales-invoices/:id` | User | Delete invoice + lines |
| POST | `/api/sales-invoices/:id/verify` | Admin | Verify invoice |
| GET | `/api/sales-invoices/daily-summary` | User | Day-by-day totals |
| GET | `/api/sales-invoices/item-summary` | User | Item-wise aggregates |
| GET | `/api/sales-invoices/consumption` | User | Theoretical ingredient consumption |

### 10.10 Expenses

| Method | Endpoint | Auth | Description |
|:---|:---|:---|:---|
| GET | `/api/expenses` | Public | List expenses (filter by date) |
| POST | `/api/expenses` | User | Create expense (+ petty cash link) |
| PATCH | `/api/expenses/:id` | User | Update expense |
| DELETE | `/api/expenses/:id` | User | Delete expense |
| POST | `/api/expenses/:id/verify` | Admin | Verify expense |

### 10.11 Waste

| Method | Endpoint | Auth | Description |
|:---|:---|:---|:---|
| GET | `/api/waste` | User | List waste entries (filter by date) |
| POST | `/api/waste` | User | Create waste + deduct stock |
| DELETE | `/api/waste/:id` | User | Delete + restore stock |
| POST | `/api/waste/:id/verify` | Admin | Verify waste entry |

### 10.12 Inventory

| Method | Endpoint | Auth | Description |
|:---|:---|:---|:---|
| GET | `/api/inventory/stock-overview` | Public | Current stock levels |
| GET | `/api/inventory/stock-snapshots` | User | List snapshots |
| POST | `/api/inventory/stock-snapshots` | Admin | Record EOD snapshot |
| POST | `/api/inventory/stock-adjustments` | Admin | Manual stock adjustment |

### 10.13 Settlements

| Method | Endpoint | Auth | Description |
|:---|:---|:---|:---|
| GET | `/api/settlements` | User | List settlements (filter by date) |
| POST | `/api/settlements` | User | Create settlement with payment lines |
| DELETE | `/api/settlements/:id` | User | Delete settlement |
| POST | `/api/settlements/:id/verify` | Admin | Verify settlement |

### 10.14 Petty Cash

| Method | Endpoint | Auth | Description |
|:---|:---|:---|:---|
| GET | `/api/petty-cash` | User | List ledger entries (filter by date) |
| POST | `/api/petty-cash` | User | Create ledger entry |
| GET | `/api/petty-cash/summary` | User | Get running balance summary |

### 10.15 Employees & Attendance

| Method | Endpoint | Auth | Description |
|:---|:---|:---|:---|
| GET | `/api/employees` | User | List employees |
| POST | `/api/employees` | User | Create employee |
| PATCH | `/api/employees/:id` | User | Update employee |
| GET | `/api/shifts` | User | List shifts |
| POST | `/api/shifts` | User | Create shift |
| GET | `/api/attendance` | User | Get attendance records |
| POST | `/api/attendance` | User | Mark attendance |
| POST | `/api/salary/generate` | Admin | Generate monthly salary |
| GET | `/api/salary` | User | List salary records |

### 10.16 Trials

| Method | Endpoint | Auth | Description |
|:---|:---|:---|:---|
| GET | `/api/trials` | Admin | List trials |
| POST | `/api/trials` | Admin | Create trial |
| PATCH | `/api/trials/:id` | Admin | Update trial |
| POST | `/api/trials/:id/versions` | Admin | Add trial version |

### 10.17 Dashboard & Reports

| Method | Endpoint | Auth | Description |
|:---|:---|:---|:---|
| GET | `/api/dashboard/summary` | Public | KPI summary |
| GET | `/api/dashboard/daily-pl` | User | Daily P&L calculation |
| GET | `/api/dashboard/consumption-variance` | User | Actual vs theoretical usage |
| GET | `/api/reports/item-profitability` | User | Item-level profitability |
| GET | `/api/reports/export` | User | CSV export |

### 10.18 System

| Method | Endpoint | Auth | Description |
|:---|:---|:---|:---|
| GET | `/api/healthz` | Public | Health check |
| GET | `/api/config` | User | Get system config |
| PATCH | `/api/config` | Admin | Update system config |
| GET | `/api/audit-logs` | Admin | Get audit logs |
| GET | `/api/backup/download` | Admin | Download full backup (JSON) |
| POST | `/api/upload/sales` | User | Upload Excel file |
| POST | `/api/webhook/petpooja/:id` | Public | Petpooja POS webhook |

---

## 11. Authentication & Authorization

### 11.1 Login Flow

```
User → POST /api/auth/login { username, password }
  → Server: find user by username
  → Server: verifyPassword(password, user.passwordHash)
  → Server: check user.active === true
  → Server: createToken({ userId, userRole })
  → Response: { token, user: { id, username, fullName, role } }
  → Client: store token + user in localStorage
  → Client: redirect to dashboard
```

### 11.2 Request Authentication Flow

```
Client → Any /api/* request with Authorization: Bearer <token>
  → Global middleware (app.ts):
    1. Skip if PUBLIC_PATH or PUBLIC_PREFIX
    2. Extract token from header
    3. verifyToken(token) → { userId, userRole, exp }
    4. Check exp > current time
    5. Attach req.userId, req.userRole
    6. next()
  → If invalid/expired: 401 Unauthorized
```

### 11.3 Role Hierarchy

```
admin > manager > viewer

admin:   Full access. Can verify records, manage users, system config,
         inventory adjustments, salary generation, analytics, trials.

manager: Operational access. Can create/edit transactions.
         Cannot access admin-only features.

viewer:  Read-only. Can view all operational data.
         Cannot create, update, or delete records.
```

### 11.4 Password Hash Format

```
Current (PBKDF2): "a1b2c3d4e5f6...:9f8e7d6c5b4a..."
                   ↑ 16-byte salt      ↑ 64-byte derived key
                   (hex)                (hex)

Legacy (SHA-256):  "e3b0c44298fc..." (no colon = legacy format)
```

Legacy passwords are verified using plain SHA-256 hash comparison. New passwords always use PBKDF2.

---

## 12. Business Logic

### 12.1 Costing Engine

The system supports three costing methods (configurable in system config):
- **Weighted Average Cost (WAC)** — Default. Recalculated on each purchase.
- **Latest Cost** — Uses most recent purchase price.
- **Standard Cost** — Uses a fixed predetermined cost.

**Production cost formula:**
```
For each recipe line:
  unitCost = ingredient.weightedAvgCost / ingredient.conversionFactor
  netQuantity = line.quantity × (1 + line.wastagePercent / 100)
  lineCost = unitCost × netQuantity

totalProductionCost = Σ lineCost
margin = sellingPrice - totalProductionCost
marginPercent = (margin / sellingPrice) × 100
```

### 12.2 Weighted Average Cost Recalculation

Triggered on every purchase:

```
oldTotal = ingredient.currentStock × ingredient.weightedAvgCost
newValue = purchaseLine.quantity × purchaseLine.unitRate
newStock = ingredient.currentStock + purchaseLine.quantity

newWeightedAvgCost = (oldTotal + newValue) / newStock
```

### 12.3 Stock Management

Stock is updated automatically by these events:

| Event | Effect on `currentStock` |
|:---|:---|
| Purchase created | + line.quantity (per ingredient) |
| Purchase deleted | - line.quantity (clamped to 0) |
| Waste created (ingredient type) | - waste.quantity (clamped to 0) |
| Waste deleted (ingredient type) | + waste.quantity (restored) |
| Stock adjustment (admin) | ± adjustment.quantity (negative stock prevented) |
| Stock snapshot | Records `closingQty`, computes `consumedQty` |

### 12.4 Daily P&L Calculation

```
Total Sales     = Σ sales_invoices.netAmount (for date range)
Material Cost   = Σ (sales_invoice_lines.quantity × recipe ingredient costs)
Waste Cost      = Σ waste_entries.costValue (for date range)
Expenses        = Σ expenses.totalAmount (for date range)

Gross Profit    = Total Sales - Material Cost
Operating Profit = Gross Profit - Waste Cost - Expenses
```

### 12.5 Consumption Variance

```
Theoretical Consumption (per ingredient):
  = Σ (invoice_line.quantity × recipe_line.quantity × wastage_factor / conversion_factor)
  (across all sold items in the period)

Actual Consumption (per ingredient):
  = stock_snapshot.consumedQty
  (from physical stock counts)

Variance = Actual - Theoretical
VariancePercent = (Variance / Theoretical) × 100
```

### 12.6 Settlement Reconciliation

```
Net Sales       = Σ sales_invoices.netAmount (for settlement date)
Total Settled   = Σ settlement_lines.amount

Difference      = Total Settled - Net Sales
DifferenceType  = "matched" (0) | "shortage" (< 0) | "excess" (> 0)
```

### 12.7 Vendor Ledger

Every purchase creates a **debit** entry. Every payment creates a **credit** entry. Running balance is maintained per vendor.

```
Debit (purchase):  runningBalance += purchase.totalAmount
Credit (payment):  runningBalance -= payment.totalAmount
```

### 12.8 GST Calculation on Invoices

```
If GST inclusive:
  taxableAmount = lineAmount / (1 + gstPercent/100)
  gstAmount = lineAmount - taxableAmount

If GST exclusive:
  taxableAmount = lineAmount
  gstAmount = lineAmount × gstPercent / 100

netAmount = taxableAmount + gstAmount
```

### 12.9 Salary Generation

```
For each employee in given month/year:
  presentDays = count(attendance.status = 'present')
  halfDays = count(attendance.status = 'half-day')
  workingDays = presentDays + (halfDays × 0.5)

  dailyRate = employee.salary / totalDaysInMonth
  grossSalary = dailyRate × workingDays
  deductions = (calculated based on leaves/absences)
  netSalary = grossSalary - deductions
```

---

## 13. POS Integration

### 13.1 Petpooja Webhook

**Endpoint:** `POST /api/webhook/petpooja/:integrationId`

This endpoint is **public** (no JWT required) but is expected to be called only from Petpooja's servers.

**Flow:**
1. Receive order payload from Petpooja
2. Look up integration config by `:integrationId`
3. Map Petpooja item IDs to internal menu item IDs via `petpooja_item_mappings`
4. Create `sales_invoice` with `sourceType = 'PETPOOJA'`
5. Return success/failure counts

### 13.2 Item Mapping

Admin UI at `/petpooja-mappings` allows mapping between Petpooja menu items and internal menu items. Each mapping stores:
- `externalItemId` (Petpooja's ID)
- `externalItemName` (Petpooja's name)
- `menuItemId` (internal menu item)

---

## 14. Coding Conventions

### 14.1 SQL & Drizzle Patterns

**Parameterized IN clause** (never use `sql.raw()`):
```typescript
import { sql } from 'drizzle-orm';

const ids = [1, 2, 3];
const inList = sql.join(ids.map(id => sql`${id}`), sql`, `);
const result = await db.select()
  .from(table)
  .where(sql`${table.id} IN (${inList})`);
```

**Standard select with filter:**
```typescript
const rows = await db.select()
  .from(ingredientsTable)
  .where(eq(ingredientsTable.active, true))
  .orderBy(ingredientsTable.name);
```

### 14.2 Error Handling

**Backend:**
```typescript
// FK violation catch (on all delete routes)
catch (err: any) {
  if (err?.code === '23503') {
    return res.status(400).json({ message: 'Cannot delete: referenced by other records' });
  }
  throw err;
}
```

**Frontend:**
```typescript
// Always use toast, never console.error for user-facing errors
try {
  await apiFetch('/api/something', { method: 'POST', body: JSON.stringify(data) });
  toast({ title: 'Success', description: 'Saved successfully' });
} catch (err: any) {
  toast({ title: 'Error', description: err.message, variant: 'destructive' });
}
```

### 14.3 Button Variants

Use these variant names (NOT "destructive" for danger buttons):
```typescript
<Button variant="default">Primary</Button>
<Button variant="outline">Secondary</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="danger">Delete</Button>
```

### 14.4 Number Formatting

- Monetary values: `formatCurrency(value)` → `₹1,23,456.00`
- Integer counts (items sold, waste entries): `Math.round(value).toLocaleString()`
- Decimal quantities: `value.toFixed(2)`
- CSS class for tabular numbers: `font-numbers`

### 14.5 Date Handling

- All dates stored as `text` (ISO date string `YYYY-MM-DD`) in the database
- Frontend enforces `max={today}` on all date inputs
- Backend validates with `validateNotFutureDate(dateStr)`

---

## 15. Common Operations

### 15.1 Adding a New Module

1. **Schema**: Create `lib/db/src/schema/newModule.ts`, export from `schema/index.ts`
2. **Push schema**: `cd lib/db && npx drizzle-kit push --force`
3. **Route**: Create `artifacts/api-server/src/routes/newModule.ts`
4. **Register route**: Add to `artifacts/api-server/src/routes/index.ts`
5. **Frontend page**: Create `artifacts/epic-poetry-cafe/src/pages/new-module.tsx`
6. **Add route**: Register in `App.tsx` with appropriate auth guard
7. **Add sidebar link**: Update `components/layout.tsx`

### 15.2 Adding a New API Endpoint

```typescript
// In the appropriate route file:
router.get('/new-endpoint', authMiddleware, async (req, res) => {
  try {
    const result = await db.select().from(table);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Internal error' });
  }
});
```

### 15.3 Adding Form Validation

**Frontend (before API call):**
```typescript
if (!formData.name?.trim()) {
  toast({ title: 'Validation Error', description: 'Name is required', variant: 'destructive' });
  return;
}
if (formData.amount <= 0) {
  toast({ title: 'Validation Error', description: 'Amount must be greater than 0', variant: 'destructive' });
  return;
}
```

**Backend (in route handler):**
```typescript
const parsed = CreateSomethingBody.safeParse(req.body);
if (!parsed.success) {
  return res.status(400).json({ message: parsed.error.message });
}
```

### 15.4 Adding Delete Guards

```typescript
router.delete('/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  try {
    // Check FK references
    const refs = await db.select({ id: relatedTable.id })
      .from(relatedTable)
      .where(eq(relatedTable.foreignKeyCol, id))
      .limit(1);
    if (refs.length > 0) {
      return res.status(400).json({
        message: 'Cannot delete: referenced by other records'
      });
    }
    // Perform delete
    await db.delete(mainTable).where(eq(mainTable.id, id));
    res.json({ message: 'Deleted' });
  } catch (err: any) {
    if (err?.code === '23503') {
      return res.status(400).json({ message: 'Cannot delete: referenced by other records' });
    }
    throw err;
  }
});
```

### 15.5 Rebuilding After Schema Change

```bash
# 1. Push schema changes
cd lib/db && npx drizzle-kit push --force

# 2. Restart the API server
# (handled by workflow restart in Replit)
```

---

## 16. Known Limitations & Deferred Issues

### 16.1 Deferred Bugs

| # | Issue | Priority | Reason |
|:---|:---|:---|:---|
| 4, 12 | Race conditions in stock updates | Low | Requires DB-level transactions; low risk in single-user cafe |
| 9 | Duplicate invoice numbers possible | Low | Auto-generation handles most cases |
| 10 | No rate limiting on login | Medium | Infrastructure concern; single-user deployment |
| 18 | No fromDate < toDate validation in reports | Low | Minor UX issue |
| 19 | Attendance deleteLeave lacks error handling | Low | Minor |
| 22 | Missing loading states on some mutations | Low | Buttons already disable with `isPending` |
| 24 | Dashboard chart Y-axis hardcoded "k" formatter | Low | Cosmetic |
| 26 | No pagination on data tables | Medium | Feature request, not bug |
| 27 | Missing empty states on some pages | Low | Cosmetic |
| 28-29 | Missing aria-labels | Low | Accessibility improvement |

### 16.2 Architectural Limitations

- **Single-tenant only**: No multi-cafe support.
- **No offline mode**: Requires internet connection.
- **No real-time updates**: Uses polling via React Query refetchInterval.
- **No file versioning**: Uploaded files overwrite without history.
- **Custom JWT**: No refresh token mechanism; token expires after 7 days requiring re-login.

---

## 17. Deployment

### 17.1 Build Commands

```bash
# Backend
npm run build --workspace=@workspace/api-server
# Produces: artifacts/api-server/dist/index.mjs

# Frontend
npm run build --workspace=@workspace/epic-poetry-cafe
# Produces: artifacts/epic-poetry-cafe/dist/
```

### 17.2 Production Configuration

- Set `NODE_ENV=production`
- Ensure `SESSION_SECRET` is set (do not rely on random fallback)
- Ensure `DATABASE_URL` points to production PostgreSQL
- Frontend serves from the built `dist/` folder

### 17.3 Health Check

```
GET /api/healthz → { "status": "ok" }
```

### 17.4 Backup

```
GET /api/backup/download (Admin only)
→ Downloads complete database as JSON file
```
