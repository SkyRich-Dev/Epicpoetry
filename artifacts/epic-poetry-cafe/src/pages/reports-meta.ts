export type RangePreset =
  | 'today'
  | 'yesterday'
  | '7d'
  | '30d'
  | '90d'
  | 'mtd'
  | 'last-month'
  | 'qtd'
  | 'last-quarter'
  | 'fytd';

export type ReportMeta = {
  description: string;
  defaultRange?: RangePreset;
  highlightCols?: string[];
};

export const REPORT_META: Record<string, ReportMeta> = {
  // Sales
  'daily-sales-summary': {
    description: 'How much you sold each day, split by cash, UPI and card.',
    defaultRange: 'today',
    highlightCols: ['net', 'invoiceCount'],
  },
  'sales-by-item': {
    description: 'Which menu items sold and how much revenue each one brought in.',
    defaultRange: 'today',
    highlightCols: ['qty', 'net'],
  },
  'sales-by-category': {
    description: 'Sales rolled up by category — coffee, food, desserts, etc.',
    defaultRange: '7d',
  },
  'sales-by-payment-mode': {
    description: 'Cash vs UPI vs card vs wallet — see where the money is coming in.',
    defaultRange: '7d',
  },
  'sales-hour-day': {
    description: 'Busiest hours and busiest days of the week.',
    defaultRange: '30d',
  },
  'discount-report': {
    description: 'Every invoice where a discount was given, with %.',
    defaultRange: '30d',
  },
  'gst-output': {
    description: 'GST collected on sales — month by month for filing.',
    defaultRange: 'fytd',
  },
  'settlement-reconciliation': {
    description: 'Did the cash in the till and the bank match what invoices say?',
    defaultRange: '7d',
  },
  'top-bottom-items': {
    description: 'Best sellers and the slowest movers, side by side.',
    defaultRange: '30d',
  },
  'customer-sales': {
    description: 'Which customers bought how much in the chosen window.',
    defaultRange: '30d',
  },

  // Purchase
  'purchase-register': {
    description: 'Every purchase bill recorded, with vendor and amount.',
    defaultRange: '30d',
  },
  'purchase-by-vendor': {
    description: 'Total bought from each vendor, ranked.',
    defaultRange: '30d',
  },
  'purchase-by-ingredient': {
    description: 'How much of each ingredient you bought and what you paid.',
    defaultRange: '30d',
  },
  'vendor-payments': {
    description: 'Payments made to vendors with mode and reference.',
    defaultRange: '30d',
  },
  'vendor-outstanding': {
    description: 'How much you still owe each vendor, with ageing buckets.',
    defaultRange: 'today',
  },
  'price-trend': {
    description: 'How the price of each ingredient has moved over time.',
    defaultRange: '90d',
  },
  'gst-input': {
    description: 'GST paid on purchases — claim this in your returns.',
    defaultRange: 'fytd',
  },

  // Inventory
  'current-stock': {
    description: 'A snapshot of how much stock is on the shelf right now.',
    defaultRange: 'today',
  },
  'stock-movement': {
    description: 'Every stock in / stock out movement in the chosen window.',
    defaultRange: '7d',
  },
  'low-stock': {
    description: 'Ingredients that are at or below the reorder point — buy now.',
    defaultRange: 'today',
  },
  'stock-adjustments': {
    description: 'Manual stock corrections and the reason given.',
    defaultRange: '30d',
  },
  'inventory-valuation': {
    description: 'Value of stock on hand at current cost.',
    defaultRange: 'today',
  },
  'slow-moving': {
    description: 'Ingredients that have not moved in a long time — risk of waste.',
    defaultRange: '90d',
  },
  'expiry-report': {
    description: 'Stock approaching expiry, sorted by closest.',
    defaultRange: 'today',
  },

  // Recipe
  'recipe-cost-card': {
    description: 'Per-item recipe cost: what each menu item costs to make.',
    defaultRange: 'today',
  },
  'food-cost-percent': {
    description: 'Food cost % per item — lower is better margin.',
    defaultRange: '30d',
  },
  'menu-profitability-matrix': {
    description: 'Stars vs Dogs — items by sales volume × profit margin.',
    defaultRange: '30d',
  },
  'below-target-margin': {
    description: 'Items where the profit margin is lower than your target.',
    defaultRange: '30d',
  },
  'ingredient-demand': {
    description: 'How much of each ingredient your sales will need next.',
    defaultRange: '30d',
  },

  // Expense
  'expense-register': {
    description: 'Every expense recorded — date, category, paid by, amount.',
    defaultRange: '7d',
  },
  'expense-by-category': {
    description: 'Spend grouped by category — rent, salaries, utilities, etc.',
    defaultRange: 'mtd',
  },
  'fixed-vs-variable': {
    description: 'How much of your spend is fixed vs variable.',
    defaultRange: 'mtd',
  },
  'recurring-expenses': {
    description: 'Recurring bills coming up — rent, subscriptions, utilities.',
    defaultRange: '30d',
  },
  'petty-cash-ledger': {
    description: 'Every petty cash in/out, with closing balance.',
    defaultRange: '30d',
  },

  // HR
  'attendance-register': {
    description: 'Day-by-day attendance grid for every employee.',
    defaultRange: 'mtd',
  },
  'monthly-attendance-summary': {
    description: 'Days present, absent, half-day for the month per employee.',
    defaultRange: 'mtd',
  },
  'leaves-report': {
    description: 'Approved and pending leaves per employee.',
    defaultRange: 'mtd',
  },
  'salary-register': {
    description: 'Salary paid to every employee for the month.',
    defaultRange: 'last-month',
  },
  'salary-advances-report': {
    description: 'Advances given against salary, recovered or pending.',
    defaultRange: 'mtd',
  },
  'bonus-penalty-log': {
    description: 'Bonuses, incentives and penalties recorded for staff.',
    defaultRange: 'mtd',
  },
  'employee-cost-percent': {
    description: 'Total staff cost as a % of sales — keep this under target.',
    defaultRange: 'mtd',
  },

  // Financial
  'daily-pnl': {
    description: 'Daily profit & loss — sales minus cost of goods minus expenses.',
    defaultRange: 'mtd',
  },
  'monthly-pnl': {
    description: 'Profit & loss for the month at a glance.',
    defaultRange: 'mtd',
  },
  'cash-flow': {
    description: 'Money in and money out over the chosen window.',
    defaultRange: 'mtd',
  },
  'gst-summary': {
    description: 'Net GST liability — what you collected minus what you paid.',
    defaultRange: 'mtd',
  },

  // Operational
  'waste-report': {
    description: 'What was wasted, why, and how much it cost.',
    defaultRange: '30d',
  },
  'audit-log-report': {
    description: 'Sensitive actions taken in the system, who did what and when.',
    defaultRange: '7d',
  },
  'trial-report': {
    description: 'R&D / trial recipes logged with version notes.',
    defaultRange: '30d',
  },
  'customer-clv': {
    description: 'Each customer’s total spend and visit count — find your VIPs.',
    defaultRange: '90d',
  },
};

export type QuickReport = {
  key: string;
  label: string;
  range: RangePreset;
  icon: 'sales' | 'item' | 'stock' | 'pnl' | 'vendor' | 'expense';
};

export const QUICK_REPORTS: QuickReport[] = [
  { key: 'daily-sales-summary', label: "Today's Sales", range: 'today', icon: 'sales' },
  { key: 'sales-by-item', label: 'Top Items Today', range: 'today', icon: 'item' },
  { key: 'low-stock', label: 'Low Stock Now', range: 'today', icon: 'stock' },
  { key: 'monthly-pnl', label: "This Month's P&L", range: 'mtd', icon: 'pnl' },
  { key: 'vendor-outstanding', label: 'Vendor Outstanding', range: 'today', icon: 'vendor' },
  { key: 'expense-register', label: "This Week's Expenses", range: '7d', icon: 'expense' },
];

export const RANGE_LABELS: Record<RangePreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  mtd: 'This month',
  'last-month': 'Last month',
  qtd: 'This quarter',
  'last-quarter': 'Last quarter',
  fytd: 'Financial year to date',
};

function isoDay(d: Date): string {
  return d.toISOString().split('T')[0];
}

export function resolveRange(preset: RangePreset): { from: string; to: string } {
  const today = new Date();
  const todayStr = isoDay(today);
  const day = (n: number) => {
    const d = new Date(today); d.setUTCDate(d.getUTCDate() - n); return isoDay(d);
  };
  const monthStart = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const lastDayOfMonth = (year: number, monthIdx: number) =>
    new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();

  switch (preset) {
    case 'today':
      return { from: todayStr, to: todayStr };
    case 'yesterday': {
      const y = day(1); return { from: y, to: y };
    }
    case '7d': return { from: day(6), to: todayStr };
    case '30d': return { from: day(29), to: todayStr };
    case '90d': return { from: day(89), to: todayStr };
    case 'mtd': return { from: monthStart(today), to: todayStr };
    case 'last-month': {
      const d = new Date(today); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
      const from = monthStart(d);
      const to = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(lastDayOfMonth(d.getUTCFullYear(), d.getUTCMonth())).padStart(2, '0')}`;
      return { from, to };
    }
    case 'qtd': {
      const m = today.getUTCMonth();
      const qStartMonth = m - (m % 3);
      const from = `${today.getUTCFullYear()}-${String(qStartMonth + 1).padStart(2, '0')}-01`;
      return { from, to: todayStr };
    }
    case 'last-quarter': {
      const m = today.getUTCMonth();
      const thisQStart = m - (m % 3);
      const lastQEndMonth = thisQStart - 1;
      const d = new Date(today);
      d.setUTCMonth(lastQEndMonth - 2, 1);
      const from = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
      const endD = new Date(today); endD.setUTCMonth(lastQEndMonth + 1, 0);
      const to = isoDay(endD);
      return { from, to };
    }
    case 'fytd': {
      // Indian FY: Apr 1 of (year if month >= Apr else year-1)
      const m = today.getUTCMonth();
      const y = m >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
      return { from: `${y}-04-01`, to: todayStr };
    }
  }
}
