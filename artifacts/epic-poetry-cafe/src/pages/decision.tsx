import React, { useState, useEffect } from 'react';
import { PageHeader, formatCurrency } from '../components/ui-extras';
import {
  Brain, AlertTriangle, TrendingUp, TrendingDown, IndianRupee, Users,
  ChefHat, Package, Wallet, LineChart as LineIcon, Bell, ArrowRight,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Cell, Legend,
} from 'recharts';

const BASE = import.meta.env.BASE_URL || '/';
async function apiFetch(path: string, opts?: any) {
  const token = localStorage.getItem('token');
  const headers: any = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}api/${path}`, { ...opts, headers: { ...headers, ...opts?.headers } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: Brain },
  { id: 'revenue', label: 'Revenue', icon: IndianRupee },
  { id: 'customer', label: 'Customer', icon: Users },
  { id: 'operational', label: 'Operational', icon: ChefHat },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'financial', label: 'Financial', icon: Wallet },
  { id: 'predictive', label: 'Predictive', icon: LineIcon },
  { id: 'alerts', label: 'Alerts', icon: Bell },
] as const;

type TabId = typeof TABS[number]['id'];

const PIE_COLORS = ['#6750A4', '#7D5260', '#B58392', '#DEC2CB'];

export default function DecisionPage() {
  const [tab, setTab] = useState<TabId>('overview');
  const [alertCount, setAlertCount] = useState({ critical: 0, warning: 0 });

  useEffect(() => {
    apiFetch('decision/alerts').then(d => setAlertCount(d.counts)).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Decision Engine"
        subtitle="Intelligence layer that turns operational data into business decisions"
        icon={Brain}
      />

      {/* Tab strip */}
      <div className="flex flex-wrap gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-1">
        {TABS.map(t => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          const isAlerts = t.id === 'alerts';
          const badge = isAlerts && (alertCount.critical + alertCount.warning) > 0
            ? alertCount.critical + alertCount.warning : null;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
              {badge !== null && (
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${
                  alertCount.critical > 0 ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'
                }`}>{badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'revenue' && <RevenueTab />}
      {tab === 'customer' && <CustomerTab />}
      {tab === 'operational' && <OperationalTab />}
      {tab === 'inventory' && <InventoryTab />}
      {tab === 'financial' && <FinancialTab />}
      {tab === 'predictive' && <PredictiveTab />}
      {tab === 'alerts' && <AlertsTab />}
    </div>
  );
}

// ----------------------- Reusable cards -----------------------

function Card({ title, subtitle, children, className }: any) {
  return (
    <div className={`rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 ${className || ''}`}>
      {title && (
        <div className="mb-4">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
          {subtitle && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

function KpiCard({ label, value, sub, delta, icon: Icon }: any) {
  const positive = delta > 0;
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</p>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">{value}</p>
        </div>
        {Icon && <Icon className="w-5 h-5 text-zinc-400" />}
      </div>
      {sub && <p className="text-xs text-zinc-500 dark:text-zinc-400">{sub}</p>}
      {delta !== undefined && delta !== null && (
        <div className={`flex items-center gap-1 text-xs mt-2 ${positive ? 'text-emerald-600' : 'text-red-600'}`}>
          {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 bg-zinc-100 dark:bg-zinc-800 rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="text-sm text-zinc-500 dark:text-zinc-400 py-8 text-center">{message}</div>;
}

function useApi<T = any>(path: string): { data: T | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    apiFetch(path).then(d => { setData(d); setError(null); })
      .catch(e => setError(e.message || 'Failed'))
      .finally(() => setLoading(false));
  }, [path]);
  return { data, loading, error };
}

// ============================ TABS ============================

function OverviewTab() {
  const profit = useApi<any>('decision/revenue/profit-comparison');
  const sales = useApi<any>('decision/predictive/sales');
  const alerts = useApi<any>('decision/alerts');
  const churn = useApi<any>('decision/customer/churn');
  const dead = useApi<any>('decision/inventory/dead-stock');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Forecast tomorrow"
          value={sales.data ? formatCurrency(sales.data.forecastTomorrow) : '—'}
          sub={sales.data ? `Confidence: ${sales.data.confidence}` : 'Loading...'}
          delta={sales.data?.trendPct}
          icon={LineIcon}
        />
        <KpiCard
          label="Operating contribution (30d)"
          value={profit.data ? formatCurrency(profit.data.actualOperatingContribution) : '—'}
          sub={profit.data ? `Theoretical: ${formatCurrency(profit.data.theoreticalProfit)}` : 'Loading...'}
          icon={IndianRupee}
        />
        <KpiCard
          label="Active alerts"
          value={alerts.data ? `${alerts.data.counts.critical + alerts.data.counts.warning + alerts.data.counts.info}` : '—'}
          sub={alerts.data ? `${alerts.data.counts.critical} critical, ${alerts.data.counts.warning} warning` : 'Loading...'}
          icon={Bell}
        />
        <KpiCard
          label="Churn watch"
          value={churn.data ? `${churn.data.churnList.length}` : '—'}
          sub={churn.data ? `${churn.data.buckets.at_risk} at-risk + ${churn.data.buckets.churned} churned` : 'Loading...'}
          icon={Users}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="14-day sales forecast" subtitle="Last 28 days actual + next 7 days predicted">
          {sales.loading ? <Skeleton /> : sales.data && (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={[
                ...sales.data.last28Days.map((d: any) => ({ date: d.date.slice(5), actual: d.sales })),
                ...sales.data.next7Days.map((d: any) => ({ date: d.date.slice(5), forecast: d.forecast })),
              ]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="actual" stroke="#6750A4" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="forecast" stroke="#7D5260" strokeWidth={2} strokeDasharray="5 5" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Top alerts" subtitle="Most critical issues right now">
          {alerts.loading ? <Skeleton /> : alerts.data && alerts.data.alerts.length === 0 ? (
            <EmptyState message="No active alerts. Operations look healthy." />
          ) : (
            <div className="space-y-2">
              {alerts.data?.alerts.slice(0, 6).map((a: any) => (
                <AlertRow key={a.id} alert={a} />
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Profit drivers (30d)" subtitle="Where money is going">
        {profit.loading ? <Skeleton /> : profit.data && (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={profit.data.drivers} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={200} />
              <Tooltip formatter={(v: any) => formatCurrency(v)} />
              <Bar dataKey="amount" fill="#6750A4" radius={[0, 8, 8, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {dead.data && dead.data.deadCount > 0 && (
        <Card title="Dead stock summary" subtitle={`${dead.data.deadCount} ingredients with zero consumption in last 30 days`}>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Blocked value: <span className="font-semibold">{formatCurrency(dead.data.totalBlockedValue)}</span>
          </p>
        </Card>
      )}
    </div>
  );
}

// --- REVENUE ---
function RevenueTab() {
  const leak = useApi<any>('decision/revenue/leakage');
  const profit = useApi<any>('decision/revenue/profit-comparison');
  const matrix = useApi<any>('decision/revenue/item-matrix');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          label="Avg discount %"
          value={leak.data ? `${leak.data.summary.avgDiscountPct}%` : '—'}
          sub={leak.data ? `${leak.data.summary.highDiscountCount} high-discount invoice(s)` : '...'}
        />
        <KpiCard
          label="Theoretical profit"
          value={profit.data ? formatCurrency(profit.data.theoreticalProfit) : '—'}
          sub={profit.data ? `Op. contribution: ${formatCurrency(profit.data.actualOperatingContribution)}` : '...'}
        />
        <KpiCard
          label="Variance vs theoretical"
          value={profit.data ? formatCurrency(profit.data.variance) : '—'}
          sub="Driven by waste, discount, cost variance"
        />
      </div>

      <Card title="Revenue leakage" subtitle="High-discount invoices and items realized below standard price">
        {leak.loading ? <Skeleton /> : leak.data && (
          <div className="space-y-5">
            {leak.data.peakDiscountHour && (
              <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm">
                <strong>Peak discount window:</strong> {leak.data.peakDiscountHour.hour}:00 — {leak.data.peakDiscountHour.discountPct}% of gross
              </div>
            )}
            <div>
              <h4 className="text-sm font-semibold mb-2">Items realized below standard price</h4>
              {leak.data.belowPriceItems.length === 0 ? <EmptyState message="No price erosion detected." /> : (
                <Table headers={["Item", "Qty", "Std ₹", "Realized ₹", "Gap %", "Loss est."]}
                  rows={leak.data.belowPriceItems.map((x: any) => [
                    x.itemName, x.qty, formatCurrency(x.sellingPrice),
                    formatCurrency(x.avgRealizedPrice), `${x.priceGapPct}%`, formatCurrency(x.revenueLossEst)
                  ])} />
              )}
            </div>
          </div>
        )}
      </Card>

      <Card title="Real vs theoretical profit (30 days)">
        {profit.loading ? <Skeleton /> : profit.data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <Stat label="Net revenue" value={formatCurrency(profit.data.revenue.net)} />
              <Stat label="Theoretical COGS" value={formatCurrency(profit.data.cogs.theoretical)} />
              <Stat label="Actual COGS" value={formatCurrency(profit.data.cogs.actual)} />
              <Stat label="Waste cost" value={formatCurrency(profit.data.cogs.wasteCost)} />
            </div>
            {profit.data.note && <p className="text-xs text-zinc-500 italic">{profit.data.note}</p>}
          </>
        )}
      </Card>

      <Card title="Item performance matrix" subtitle="Volume × margin classification (median split)">
        {matrix.loading ? <Skeleton /> : matrix.data && matrix.data.items.length === 0 ? (
          <EmptyState message="No item sales in window." />
        ) : matrix.data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <QuadrantBadge label="Stars" count={matrix.data.counts.star} color="emerald" />
              <QuadrantBadge label="Workhorses" count={matrix.data.counts.workhorse} color="amber" />
              <QuadrantBadge label="Hidden gems" count={matrix.data.counts.hidden_gem} color="indigo" />
              <QuadrantBadge label="Underperformers" count={matrix.data.counts.low_vol_low_margin} color="zinc" />
            </div>
            <Table headers={["Item", "Qty", "Revenue", "Margin %", "Quadrant", "Action"]}
              rows={matrix.data.items.slice(0, 20).map((x: any) => [
                x.itemName, x.qty, formatCurrency(x.revenue), `${x.marginPct}%`,
                <QuadrantTag q={x.quadrant} />, x.action
              ])} />
          </>
        )}
      </Card>
    </div>
  );
}

function QuadrantBadge({ label, count, color }: any) {
  const c: any = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300',
    amber: 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300',
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-800 dark:bg-indigo-900/20 dark:border-indigo-800 dark:text-indigo-300',
    zinc: 'bg-zinc-50 border-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300',
  };
  return (
    <div className={`rounded-2xl border p-3 ${c[color]}`}>
      <p className="text-xs uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-xl font-bold mt-1">{count}</p>
    </div>
  );
}
function QuadrantTag({ q }: any) {
  const map: any = {
    star: ['bg-emerald-100 text-emerald-800', 'Star'],
    workhorse: ['bg-amber-100 text-amber-800', 'Workhorse'],
    hidden_gem: ['bg-indigo-100 text-indigo-800', 'Hidden gem'],
    low_vol_low_margin: ['bg-zinc-100 text-zinc-700', 'Underperform'],
  };
  const [cls, label] = map[q] || ['bg-zinc-100 text-zinc-700', q];
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>;
}

// --- CUSTOMER ---
function CustomerTab() {
  const clv = useApi<any>('decision/customer/clv');
  const churn = useApi<any>('decision/customer/churn');
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard label="Customers tracked" value={clv.data?.totalCustomers ?? '—'} />
        <KpiCard label="Total CLV" value={clv.data ? formatCurrency(clv.data.totalCLV) : '—'} />
        <KpiCard label="Top 10% concentration" value={clv.data ? `${clv.data.concentration.top10Pct}%` : '—'} sub="of total CLV" />
        <KpiCard label="At-risk + churned" value={churn.data ? `${churn.data.buckets.at_risk + churn.data.buckets.churned}` : '—'} />
      </div>

      <Card title="Top high-value customers" subtitle="Ranked by CLV score">
        {clv.loading ? <Skeleton /> : clv.data && clv.data.top.length === 0 ? (
          <EmptyState message="No customer data yet." />
        ) : clv.data && (
          <Table headers={["Customer", "Phone", "Visits", "Total spent", "Avg spend", "Visits/mo", "CLV score"]}
            rows={clv.data.top.map((c: any) => [
              c.name, c.phone, c.totalVisits, formatCurrency(c.totalSpent),
              formatCurrency(c.avgSpend), c.visitFreqPerMonth, formatCurrency(c.clvScore)
            ])} />
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Churn risk list" subtitle="Customers inactive > 30 days">
          {churn.loading ? <Skeleton /> : churn.data && churn.data.churnList.length === 0 ? (
            <EmptyState message="No customers in churn-risk window." />
          ) : churn.data && (
            <Table headers={["Customer", "Segment", "Days inactive", "Spent"]}
              rows={churn.data.churnList.slice(0, 12).map((c: any) => [
                c.name, <SegmentTag s={c.segment} />, c.daysSinceLastVisit, formatCurrency(c.totalSpent)
              ])} />
          )}
        </Card>
        <Card title="Visit prediction" subtitle="Customers due to visit in next 3 days">
          {churn.loading ? <Skeleton /> : churn.data && churn.data.dueSoon.length === 0 ? (
            <EmptyState message="No predicted visits in next 3 days." />
          ) : churn.data && (
            <Table headers={["Customer", "Avg interval", "Expected in"]}
              rows={churn.data.dueSoon.slice(0, 12).map((c: any) => [
                c.name, `${c.avgIntervalDays}d`, `${c.expectedNextVisitInDays}d`
              ])} />
          )}
        </Card>
      </div>
    </div>
  );
}
function SegmentTag({ s }: any) {
  const map: any = {
    high_value: ['bg-purple-100 text-purple-800', 'High-value'],
    frequent: ['bg-blue-100 text-blue-800', 'Frequent'],
    regular: ['bg-zinc-100 text-zinc-700', 'Regular'],
    new: ['bg-emerald-100 text-emerald-800', 'New'],
  };
  const [cls, label] = map[s] || ['bg-zinc-100', s];
  return <span className={`px-2 py-0.5 rounded-full text-xs ${cls}`}>{label}</span>;
}

// --- OPERATIONAL ---
function OperationalTab() {
  const staff = useApi<any>('decision/operational/staff-efficiency');
  const kitchen = useApi<any>('decision/operational/kitchen-load');
  return (
    <div className="space-y-6">
      <Card title="Staff efficiency (30d)" subtitle="Billing performance by user (cashier proxy via createdBy)">
        {staff.loading ? <Skeleton /> : staff.data && staff.data.staff.length === 0 ? (
          <EmptyState message="No invoices with attributed users in window." />
        ) : staff.data && (
          <>
            {staff.data.flags?.length > 0 && (
              <div className="mb-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm space-y-1">
                {staff.data.flags.map((f: any) => (
                  <div key={f.userId}>⚠ {f.name}: {f.reason}</div>
                ))}
              </div>
            )}
            <Table headers={["Staff", "Role", "Invoices", "Revenue", "Avg bill", "Discount %"]}
              rows={staff.data.staff.map((s: any) => [
                s.name, s.role, s.invoices, formatCurrency(s.revenue),
                formatCurrency(s.avgBill), `${s.discountPct}%`
              ])} />
          </>
        )}
      </Card>

      <Card title="Kitchen load by hour (14d)" subtitle="Order volume + complexity score per hour window">
        {kitchen.loading ? <Skeleton /> : kitchen.data && kitchen.data.totalOrders === 0 ? (
          <EmptyState message="No timed invoices in window." />
        ) : kitchen.data && (
          <>
            {kitchen.data.peakHour && (
              <p className="text-sm mb-3 text-zinc-600 dark:text-zinc-300">
                Busiest window: <strong>{kitchen.data.peakHour.hour}:00</strong> —
                {' '}{kitchen.data.peakHour.orders} orders, avg {kitchen.data.peakHour.avgItemsPerOrder} items each
              </p>
            )}
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={kitchen.data.hourly.filter((h: any) => h.orders > 0)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} tickFormatter={(h) => `${h}:00`} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="orders" fill="#6750A4" name="Orders" radius={[8, 8, 0, 0]} />
                <Bar dataKey="loadScore" fill="#7D5260" name="Load score" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4">
              <h4 className="text-sm font-semibold mb-2">Top kitchen-load items</h4>
              <Table headers={["Item", "Qty", "Orders"]}
                rows={kitchen.data.topLoadItems.map((x: any) => [x.itemName, x.qty, x.orderCount])} />
            </div>
          </>
        )}
      </Card>

      <Card title="Order handling delay" subtitle="Inactive">
        <EmptyState message="Order-placed and bill-closed timestamps are not captured. This view will activate once those fields exist." />
      </Card>

      <Card title="Table turnover" subtitle="Inactive">
        <EmptyState message="Table/session data is not captured. This view will activate once those fields exist." />
      </Card>
    </div>
  );
}

// --- INVENTORY ---
function InventoryTab() {
  const variance = useApi<any>('decision/inventory/consumption-variance');
  const dead = useApi<any>('decision/inventory/dead-stock');
  const cost = useApi<any>('decision/inventory/cost-impact');
  return (
    <div className="space-y-6">
      <Card title="Real vs expected consumption (30d)">
        {variance.loading ? <Skeleton /> : variance.data && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <Stat label="Theoretical cost" value={formatCurrency(variance.data.summary.totalTheoreticalCost)} />
              <Stat label="Actual cost" value={formatCurrency(variance.data.summary.totalActualCost)} />
              <Stat label="Variance cost" value={formatCurrency(variance.data.summary.totalVarianceCost)} />
            </div>
            {variance.data.note && <p className="text-xs text-amber-600 italic mb-3">{variance.data.note}</p>}
            {variance.data.significant.length === 0 ? <EmptyState message="No significant variances." /> : (
              <Table headers={["Ingredient", "Theoretical", "Actual", "Variance %", "Cost impact"]}
                rows={variance.data.significant.map((x: any) => [
                  x.name, `${x.theoretical} ${x.stockUom}`, `${x.actual} ${x.stockUom}`,
                  `${x.variancePct}%`, formatCurrency(x.costImpact)
                ])} />
            )}
          </>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Dead stock" subtitle={`Zero consumption in last 30 days`}>
          {dead.loading ? <Skeleton /> : dead.data && dead.data.dead.length === 0 ? (
            <EmptyState message="No dead stock." />
          ) : dead.data && (
            <>
              <p className="text-sm mb-3 text-zinc-600">Blocked value: <strong>{formatCurrency(dead.data.totalBlockedValue)}</strong></p>
              <Table headers={["Ingredient", "Stock", "Blocked ₹"]}
                rows={dead.data.dead.slice(0, 12).map((x: any) => [
                  x.name, `${x.currentStock} ${x.stockUom}`, formatCurrency(x.blockedValue)
                ])} />
            </>
          )}
        </Card>

        <Card title="Slow movers">
          {dead.loading ? <Skeleton /> : dead.data && dead.data.slow.length === 0 ? (
            <EmptyState message="No slow-moving items." />
          ) : dead.data && (
            <Table headers={["Ingredient", "Stock", "Turnover"]}
              rows={dead.data.slow.slice(0, 12).map((x: any) => [
                x.name, `${x.currentStock} ${x.stockUom}`, x.turnoverRatio
              ])} />
          )}
        </Card>
      </div>

      <Card title="Cost increase impact" subtitle="Vendor rate changes affecting menu margins">
        {cost.loading ? <Skeleton /> : cost.data && cost.data.changes.length === 0 ? (
          <EmptyState message="No significant cost changes." />
        ) : cost.data && (
          <>
            <h4 className="text-sm font-semibold mb-2">Ingredient rate changes</h4>
            <Table headers={["Ingredient", "Earlier rate", "Latest rate", "Change %"]}
              rows={cost.data.changes.slice(0, 10).map((x: any) => [
                x.name, formatCurrency(x.earliestRate), formatCurrency(x.latestRate),
                <span className={x.changePct > 0 ? 'text-red-600 font-semibold' : 'text-emerald-600 font-semibold'}>
                  {x.changePct > 0 ? '+' : ''}{x.changePct}%
                </span>
              ])} />
            {cost.data.itemsImpact.length > 0 && (
              <div className="mt-5">
                <h4 className="text-sm font-semibold mb-2">Affected menu items</h4>
                <Table headers={["Item", "Old margin %", "New margin %", "Drop", "Drivers"]}
                  rows={cost.data.itemsImpact.slice(0, 10).map((x: any) => [
                    x.itemName, `${x.oldMarginPct}%`, `${x.newMarginPct}%`,
                    `${x.marginDropPct}%`, <span className="text-xs">{x.drivers.slice(0, 2).join(', ')}</span>
                  ])} />
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

// --- FINANCIAL ---
function FinancialTab() {
  const pay = useApi<any>('decision/financial/payment-trend');
  const stl = useApi<any>('decision/financial/settlement-mismatch');
  const vendor = useApi<any>('decision/financial/vendor-risk');
  const exp = useApi<any>('decision/financial/expense-efficiency');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Cash vs digital trend" subtitle="Payment mode share over selected window">
          {pay.loading ? <Skeleton /> : pay.data && (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pay.data.share.filter((s: any) => s.amount > 0)} dataKey="amount" nameKey="mode"
                       cx="50%" cy="50%" outerRadius={70} label={(e: any) => `${e.mode}: ${e.pct}%`}>
                    {pay.data.share.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={pay.data.trend.map((d: any) => ({ ...d, date: d.date.slice(5) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="cash" stroke="#6750A4" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="digital" stroke="#7D5260" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </Card>

        <Card title="Settlement mismatch (60d)">
          {stl.loading ? <Skeleton /> : stl.data && (
            <>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <Stat label="Matched" value={stl.data.counts.matched || 0} />
                <Stat label="Short" value={stl.data.counts.short || 0} />
                <Stat label="Excess" value={stl.data.counts.excess || 0} />
              </div>
              <p className="text-xs text-zinc-500 mb-3">
                Mismatch rate: {stl.data.mismatchRate}% · Total short: {formatCurrency(stl.data.totalShort)} · Total excess: {formatCurrency(stl.data.totalExcess)}
              </p>
              {stl.data.mismatchDays.length === 0 ? <EmptyState message="All settlements matched." /> : (
                <Table headers={["Date", "Type", "Amount", "Status"]}
                  rows={stl.data.mismatchDays.slice(0, 10).map((s: any) => [
                    s.settlementDate,
                    <span className={s.type === 'short' ? 'text-red-600' : 'text-amber-600'}>{s.type}</span>,
                    formatCurrency(s.amount), s.status
                  ])} />
              )}
            </>
          )}
        </Card>
      </div>

      <Card title="Vendor risk" subtitle="Overdue payables, single-source dependency">
        {vendor.loading ? <Skeleton /> : vendor.data && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <Stat label="Total pending" value={formatCurrency(vendor.data.pendingTotal)} />
              <Stat label="Overdue" value={formatCurrency(vendor.data.overdueTotal)} />
              <Stat label="Single-source items" value={vendor.data.singleSourceIngredients} />
            </div>
            <Table headers={["Vendor", "Risk score", "Pending", "Overdue", "Sole supplier of", "Flags"]}
              rows={vendor.data.vendors.slice(0, 12).map((v: any) => [
                v.name,
                <span className={v.riskScore > 30 ? 'text-red-600 font-semibold' : v.riskScore > 10 ? 'text-amber-600' : 'text-emerald-600'}>
                  {v.riskScore}
                </span>,
                formatCurrency(v.pendingAmount),
                formatCurrency(v.overdueAmount),
                v.singleSourceCount,
                <span className="text-xs">{v.flags.join('; ')}</span>
              ])} />
          </>
        )}
      </Card>

      <Card title="Expense efficiency" subtitle="Category spend growth vs sales growth">
        {exp.loading ? <Skeleton /> : exp.data && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <Stat label="Sales growth" value={`${exp.data.sales.growthPct}%`} />
              <Stat label="Expense growth" value={`${exp.data.expenses.growthPct}%`} />
              <Stat label="Expense / sales" value={`${exp.data.expenseToSalesPct}%`} />
            </div>
            {exp.data.flag && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800 mb-3">
                ⚠ {exp.data.flag}
              </div>
            )}
            <Table headers={["Category", "Current", "Previous", "Growth %"]}
              rows={exp.data.cats.slice(0, 12).map((c: any) => [
                c.categoryName, formatCurrency(c.current), formatCurrency(c.previous),
                <span className={c.growthPct > 20 ? 'text-red-600' : c.growthPct < -10 ? 'text-emerald-600' : ''}>
                  {c.growthPct > 0 ? '+' : ''}{c.growthPct}%
                </span>
              ])} />
          </>
        )}
      </Card>
    </div>
  );
}

// --- PREDICTIVE ---
function PredictiveTab() {
  const sales = useApi<any>('decision/predictive/sales');
  const demand = useApi<any>('decision/predictive/demand');
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard label="Forecast tomorrow" value={sales.data ? formatCurrency(sales.data.forecastTomorrow) : '—'}
          sub={sales.data ? `Confidence: ${sales.data.confidence}` : ''} />
        <KpiCard label="Next 7 days" value={sales.data ? formatCurrency(sales.data.weekForecast) : '—'} />
        <KpiCard label="7d moving avg" value={sales.data ? formatCurrency(sales.data.movingAvg7) : '—'} />
        <KpiCard label="Trend" value={sales.data?.trendDirection || '—'} delta={sales.data?.trendPct} />
      </div>

      <Card title="Sales: actual + forecast">
        {sales.loading ? <Skeleton /> : sales.data && (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={[
              ...sales.data.last28Days.map((d: any) => ({ date: d.date.slice(5), actual: d.sales })),
              ...sales.data.next7Days.map((d: any) => ({ date: d.date.slice(5), forecast: d.forecast })),
            ]}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: any) => formatCurrency(v)} />
              <Legend />
              <Line type="monotone" dataKey="actual" stroke="#6750A4" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="forecast" stroke="#7D5260" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="Demand forecast" subtitle="Top ingredients needed in next 7 days">
        {demand.loading ? <Skeleton /> : demand.data && demand.data.topIngredients.length === 0 ? (
          <EmptyState message={demand.data.note || 'No demand forecast available.'} />
        ) : demand.data && (
          <>
            <Table headers={["Ingredient", "Tomorrow", "Next 7d", "Stock", "Days of stock"]}
              rows={demand.data.topIngredients.slice(0, 15).map((x: any) => [
                x.name, `${x.tomorrowNeed} ${x.stockUom}`, `${x.weekNeed} ${x.stockUom}`,
                `${x.currentStock} ${x.stockUom}`,
                <span className={x.daysOfStock < 3 ? 'text-red-600 font-semibold' : x.daysOfStock < 7 ? 'text-amber-600' : ''}>
                  {x.daysOfStock < 999 ? `${x.daysOfStock}d` : '∞'}
                </span>
              ])} />

            {demand.data.shortfalls.length > 0 && (
              <div className="mt-5">
                <h4 className="text-sm font-semibold text-red-700 mb-2">⚠ Stock shortfall warnings</h4>
                <Table headers={["Ingredient", "Stock", "Week need", "Shortfall"]}
                  rows={demand.data.shortfalls.map((x: any) => [
                    x.name, `${x.currentStock} ${x.stockUom}`, `${x.weekNeed} ${x.stockUom}`,
                    <span className="text-red-600 font-semibold">{x.shortfall} {x.stockUom}</span>
                  ])} />
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

// --- ALERTS ---
function AlertsTab() {
  const alerts = useApi<any>('decision/alerts');
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Critical" value={alerts.data?.counts.critical ?? '—'} />
        <KpiCard label="Warning" value={alerts.data?.counts.warning ?? '—'} />
        <KpiCard label="Info" value={alerts.data?.counts.info ?? '—'} />
      </div>
      <Card title="Active alerts" subtitle="Auto-detected from rules across all modules">
        {alerts.loading ? <Skeleton rows={6} /> : alerts.data && alerts.data.alerts.length === 0 ? (
          <EmptyState message="All clear. No active alerts." />
        ) : alerts.data && (
          <div className="space-y-2">
            {alerts.data.alerts.map((a: any) => <AlertRow key={a.id} alert={a} />)}
          </div>
        )}
      </Card>
    </div>
  );
}

function AlertRow({ alert }: any) {
  const sev: any = {
    critical: 'border-red-300 bg-red-50 text-red-900 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200',
    warning: 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-200',
    info: 'border-blue-300 bg-blue-50 text-blue-900 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-200',
  };
  const Icon = alert.severity === 'critical' ? AlertTriangle : Bell;
  return (
    <div className={`rounded-xl border p-3 flex items-start gap-3 ${sev[alert.severity]}`}>
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs uppercase font-semibold opacity-70">{alert.category}</span>
          <span className="text-sm font-semibold">{alert.title}</span>
        </div>
        <p className="text-xs mt-1 opacity-90">{alert.detail}</p>
      </div>
      {alert.link && (
        <a href={alert.link} className="text-xs flex items-center gap-1 hover:underline opacity-80">
          View <ArrowRight className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

// --- shared mini components ---
function Stat({ label, value }: any) {
  return (
    <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 p-3">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mt-1">{value}</p>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: any[][] }) {
  if (rows.length === 0) return <EmptyState message="No data." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800">
            {headers.map((h, i) => (
              <th key={i} className="text-left font-medium text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 pr-4">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800/50 last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="py-2 pr-4 text-zinc-800 dark:text-zinc-200">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
