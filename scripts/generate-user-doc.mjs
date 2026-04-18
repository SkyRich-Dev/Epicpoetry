import { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType, PageBreak } from "docx";
import fs from "node:fs";

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: t, bold: true, color: "6750A4" })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: t, bold: true, color: "4A148C" })] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 60 }, children: [new TextRun({ text: t, bold: true })] });
const P  = (t) => new Paragraph({ spacing: { after: 80 }, children: [new TextRun(t)] });
const B  = (label, t) => new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: label + ": ", bold: true }), new TextRun(t)] });
const LI = (t) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun(t)] });
const LI2= (t) => new Paragraph({ bullet: { level: 1 }, spacing: { after: 40 }, children: [new TextRun(t)] });
const SP = () => new Paragraph({ children: [new TextRun("")] });
const PB = () => new Paragraph({ children: [new PageBreak()] });

const title = new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 200 },
  children: [new TextRun({ text: "Epic Poetry Cafe", bold: true, size: 56, color: "6750A4" })],
});
const subtitle = new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 400 },
  children: [new TextRun({ text: "User Guide & Feature Reference", italics: true, size: 32, color: "4A148C" })],
});
const meta = new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 600 },
  children: [new TextRun({ text: "Comprehensive Cafe Operations Management System\nVersion 1.0  •  April 2026", size: 22 })],
});

const sections = [
  title, subtitle, meta,

  H1("1. Introduction"),
  P("Epic Poetry Cafe is an end-to-end operations management system that runs every part of your cafe — sales, inventory, recipes, employees, vendors, finance, and decision-making — from a single web app. It is designed for cafe owners and managers who need a clear daily picture of money, stock, and people, without juggling spreadsheets."),
  B("Who it is for", "Cafe owners, store managers, accountants, and staff (with role-based access)."),
  B("Core principle", "All sales flow through invoices only — either pulled automatically from your Petpooja POS or entered manually. Nothing is recorded twice."),
  B("Tech at a glance", "Modern web app, secure login, works in any browser, mobile-friendly."),
  SP(),

  H1("2. Getting Started"),
  H2("2.1 Logging In"),
  LI("Open the app URL in your browser."),
  LI("Enter your username and password."),
  LI("Default roles: Admin (full access) and Manager (operations only — no financial decision data)."),
  LI("Sessions stay active until you log out or your token expires."),
  H2("2.2 Navigation Layout"),
  P("The left sidebar groups every feature into clear sections so you can find anything in two clicks:"),
  LI("Overview — Dashboard, Insights, Decision Engine"),
  LI("Sales — Sales Invoices, Settlements, Trials"),
  LI("Inventory — Ingredients, Stock, Waste, Purchases"),
  LI("Menu — Menu Items, Categories"),
  LI("People — Customers, Employees, Attendance"),
  LI("Finance — Expenses, Petty Cash, Vendors, Vendor Payments"),
  LI("Reports — Pre-built reports by category"),
  LI("Admin — Masters, Upload, Users, Settings, Audit Logs"),
  H2("2.3 Roles & Permissions"),
  B("Admin", "Sees everything, including financial intelligence (margins, profitability, payroll, decision engine money tabs)."),
  B("Manager", "Runs daily operations — sales, inventory, attendance, customers — but financial decision endpoints are locked."),
  PB(),

  H1("3. Daily Workflow at a Glance"),
  P("A typical day in the cafe looks like this in the system:"),
  LI("Morning — Open Dashboard to see yesterday's sales, today's expected covers, low-stock alerts."),
  LI("Throughout the day — Petpooja invoices auto-sync; manual invoices can be added for off-POS sales."),
  LI("Mid-day — Mark employee attendance; record any waste or breakage."),
  LI("Evening — Reconcile cash settlements; pay vendors; log petty cash."),
  LI("End of day — Review Insights and the Decision Engine for stock-up suggestions, slow movers, and margin alerts."),
  PB(),

  H1("4. Module-by-Module Feature List"),

  H2("4.1 Dashboard"),
  LI("Today's revenue, invoice count, average order value."),
  LI("Quick KPIs: top-selling items, top categories."),
  LI("Inventory health snapshot."),
  LI("Cash position summary."),

  H2("4.2 Sales"),
  H3("Sales Invoices"),
  LI("View every invoice (Petpooja-synced and manual) in one list."),
  LI("Filter by date range, payment mode, customer, or source."),
  LI("Drill into invoice line items, taxes, discounts, and settlement status."),
  LI("Manually create an invoice for off-POS sales (catering, events, staff meals)."),
  H3("Settlements"),
  LI("Reconcile invoices against cash, card, UPI, and online aggregator payouts."),
  LI("Track unsettled amounts and aging."),
  H3("Trials"),
  LI("Log free trial / tasting servings without affecting revenue."),
  LI("Useful for new menu testing and customer sampling."),

  H2("4.3 Inventory"),
  H3("Ingredients"),
  LI("Master list of every raw material with unit-of-measure, category, and reorder level."),
  LI("Per-ingredient cost history."),
  H3("Stock"),
  LI("Real-time stock on hand, calculated from purchases minus consumption minus waste."),
  LI("Low-stock and out-of-stock highlights."),
  LI("Manual stock adjustments with reason and audit trail."),
  H3("Purchases"),
  LI("Record vendor purchase invoices with line items, taxes, and payment terms."),
  LI("Auto-updates stock on hand and weighted-average cost."),
  H3("Waste"),
  LI("Log breakage, expiry, or operational waste with reason codes."),
  LI("Feeds into waste reports and shrinkage analysis."),

  H2("4.4 Menu"),
  H3("Menu Items"),
  LI("Maintain every item served, with selling price, category, and recipe (BoM)."),
  LI("Recipe links each menu item to ingredients with exact quantities and units."),
  LI("System computes plate cost and gross margin per item automatically."),
  H3("Categories"),
  LI("Group menu items (Beverages, Desserts, Mains, etc.) for reporting and POS mapping."),

  H2("4.5 People"),
  H3("Customers"),
  LI("Customer master with contact info, visit history, and lifetime value."),
  LI("Identify repeat customers and dormant ones."),
  H3("Employees"),
  LI("Employee profiles, role, salary structure, joining date, status (active / on leave)."),
  LI("Salary advances with future-date guard (cannot post advances dated in the future)."),
  H3("Attendance"),
  LI("Daily attendance marking — Present / Absent / Half-day / Leave."),
  LI("Employees marked on leave are hidden from the active operational list."),
  LI("Feeds payroll calculations."),

  H2("4.6 Finance"),
  H3("Expenses"),
  LI("Capture every operating expense (rent, utilities, marketing) with category and vendor."),
  H3("Petty Cash"),
  LI("Daily petty cash in/out register with running balance."),
  LI("Reconcile against actual cash drawer."),
  H3("Vendors"),
  LI("Vendor master with GST, contact, payment terms."),
  LI("Vendor detail page shows all purchases, payments, and outstanding balance."),
  H3("Vendor Payments"),
  LI("Record payments against specific purchase invoices or as on-account."),
  LI("Auto-updates vendor outstanding."),

  H2("4.7 Insights (Master Data Insights)"),
  P("Insights turns your raw data into easy answers:"),
  LI("Top and bottom sellers by revenue and units."),
  LI("Category contribution to revenue."),
  LI("Day-of-week and hour-of-day patterns."),
  LI("Customer cohorts: new vs repeat."),
  LI("Inventory turnover and slow-moving stock."),
  LI("Vendor concentration risk."),

  H2("4.8 Decision Engine"),
  P("The Decision Engine sits on top of Insights and tells you what to do, not just what happened. It is organised into eight tabs:"),
  LI("Overview — daily action list and headline KPIs."),
  LI("Revenue — pricing opportunities, margin alerts, item mix optimisation."),
  LI("Customer — repeat-rate trends, churn risk, segment recommendations."),
  LI("Operational — staffing fit, peak-hour coverage, attendance impact."),
  LI("Inventory — what to order today, slow movers to discount, consumption-variance alerts (reconciles recipe-based expected use vs actual stock movement)."),
  LI("Financial — gross margin, contribution by category, cost creep alerts."),
  LI("Predictive — short-horizon forecasts for sales and ingredient demand."),
  LI("Alerts — consolidated red flags requiring attention."),
  B("Note", "Financial decision tabs are visible to Admin role only."),

  H2("4.9 Reports"),
  P("Pre-built, ready-to-export reports across all domains:"),
  LI("Sales reports — daily, weekly, monthly, by category, by item, by payment mode."),
  LI("Inventory reports — stock on hand, valuation, movement, waste."),
  LI("Purchase reports — vendor-wise, item-wise, GST summary."),
  LI("Finance reports — expense ledger, petty-cash register, vendor outstanding."),
  LI("HR reports — attendance summary, payroll, salary advances."),

  H2("4.10 Admin"),
  H3("Masters"),
  LI("Manage all master data in one place: Categories, Units, Tax rates, Payment modes."),
  H3("Upload"),
  LI("Bulk-import historical data via CSV (ingredients, menu items, purchases, customers)."),
  H3("Users"),
  LI("Create / disable users and assign Admin or Manager role."),
  H3("Settings"),
  LI("Cafe profile, GST details, currency, financial year."),
  LI("POS integration configuration (Petpooja credentials, sync schedule)."),
  H3("Audit Logs"),
  LI("Every create / update / delete action is logged with user, timestamp, and old vs new values."),
  H3("Backup"),
  LI("On-demand database backup."),
  PB(),

  H1("5. Integrations"),
  H2("5.1 Petpooja POS"),
  LI("Automatic invoice sync — orders punched at the POS appear in Sales Invoices."),
  LI("Item, category, and tax mapping handled in Settings."),
  LI("Manual invoice creation remains available for off-POS sales."),
  H2("5.2 Reports & Export"),
  LI("All listing screens support CSV / Excel export."),
  LI("Reports can be downloaded for sharing with accountants."),

  H1("6. Security & Data Safety"),
  LI("Secure login with hashed passwords and session tokens."),
  LI("Role-based access — financial intelligence restricted to Admin."),
  LI("Full audit log of every change."),
  LI("Database backups available on demand."),
  LI("All data hosted on managed PostgreSQL with daily checkpoints."),

  H1("7. Tips for Best Results"),
  LI("Keep ingredient unit-of-measure consistent with how you buy AND how you cook (the system converts between them, but mistakes here distort margin)."),
  LI("Mark waste daily — it is the single biggest hidden cost in most cafes."),
  LI("Reconcile petty cash and settlements every evening; small daily fixes prevent big month-end mysteries."),
  LI("Review the Decision Engine Alerts tab every morning — it surfaces what changed overnight."),
  LI("Use the Trials module for tastings so they don't pollute revenue numbers."),

  H1("8. Glossary"),
  B("Invoice", "A single sale transaction. The only object that creates revenue in the system."),
  B("BoM (Bill of Materials)", "The recipe — the list of ingredients and quantities that make one menu item."),
  B("Plate cost", "Total ingredient cost to produce one serving of a menu item."),
  B("Gross margin", "Selling price minus plate cost, as a percentage of selling price."),
  B("Settlement", "Reconciling an invoice against the actual money received (cash, card, UPI, aggregator payout)."),
  B("Consumption variance", "Difference between ingredients the recipes say you should have used versus what actually left stock. A key shrinkage signal."),
  B("Decision Engine", "The recommendation layer — turns insights into specific actions."),

  H1("9. Support"),
  P("For help, change requests, or to report a bug, contact your system administrator. Every action you take is safely logged, so issues can be traced and fixed quickly."),
  SP(),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "— End of Document —", italics: true, color: "6750A4" })] }),
];

const doc = new Document({
  creator: "Epic Poetry Cafe",
  title: "Epic Poetry Cafe — User Guide & Feature Reference",
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 22 } },
    },
  },
  sections: [{ properties: {}, children: sections }],
});

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync("exports/Epic-Poetry-Cafe-User-Guide.docx", buffer);
console.log("Wrote", "exports/Epic-Poetry-Cafe-User-Guide.docx", buffer.length, "bytes");
