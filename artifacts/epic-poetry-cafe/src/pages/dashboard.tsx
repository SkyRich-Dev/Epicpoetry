import React, { useState, useEffect, useCallback } from 'react';
import { customFetch } from '@workspace/api-client-react/custom-fetch';
import { PageHeader, StatCard, formatCurrency, Badge, cn } from '../components/ui-extras';
import { DollarSign, TrendingUp, TrendingDown, PackageMinus, AlertCircle, TrendingUpDown, Banknote, Wallet, ArrowUpRight, ArrowDownRight, Minus, CalendarDays, Calendar, FileText, CreditCard, AlertOctagon } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, PieChart, Pie, Cell } from 'recharts';

const BASE = import.meta.env.BASE_URL || '/';

function getToday() { return new Date().toISOString().split('T')[0]; }
function getWeekStart(d: string) {
  const dt = new Date(d);
  const day = dt.getDay();
  dt.setDate(dt.getDate() - (day === 0 ? 6 : day - 1));
  return dt.toISOString().split('T')[0];
}
function getWeekEnd(d: string) {
  const start = new Date(getWeekStart(d));
  start.setDate(start.getDate() + 6);
  return start.toISOString().split('T')[0];
}
function getMonthStart(d: string) { return d.substring(0, 7) + '-01'; }
function getMonthEnd(d: string) {
  const [y, m] = d.split('-').map(Number);
  return new Date(y, m, 0).toISOString().split('T')[0];
}
function formatDateLabel(from: string, to: string, mode: string) {
  if (mode === 'today') return new Date(from).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  if (mode === 'date') return new Date(from).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  if (from === to) return new Date(from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const f = new Date(from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const t = new Date(to).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${f} — ${t}`;
}

type FilterMode = 'today' | 'date' | 'range' | 'week' | 'month';

function DateFilterBar({ fromDate, toDate, mode, onChange }: {
  fromDate: string; toDate: string; mode: FilterMode;
  onChange: (from: string, to: string, mode: FilterMode) => void;
}) {
  const today = getToday();

  const setMode = (m: FilterMode) => {
    switch (m) {
      case 'today': onChange(today, today, 'today'); break;
      case 'date': onChange(fromDate, fromDate, 'date'); break;
      case 'range': onChange(fromDate, toDate, 'range'); break;
      case 'week': onChange(getWeekStart(today), getWeekEnd(today), 'week'); break;
      case 'month': onChange(getMonthStart(today), getMonthEnd(today), 'month'); break;
    }
  };

  const modes: { key: FilterMode; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'date', label: 'Date' },
    { key: 'range', label: 'Date Range' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-1 bg-muted/60 rounded-xl p-1">
        {modes.map(m => (
          <button key={m.key} onClick={() => setMode(m.key)}
            className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
              mode === m.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'date' && (
        <input type="date" max={today} value={fromDate} onChange={e => onChange(e.target.value, e.target.value, 'date')}
          className="rounded-xl border border-input bg-background px-3 py-1.5 text-sm transition-all focus:ring-2 focus:ring-ring/30 focus:border-ring" />
      )}

      {mode === 'range' && (
        <div className="flex items-center gap-2">
          <input type="date" max={today} value={fromDate} onChange={e => onChange(e.target.value, toDate, 'range')}
            className="rounded-xl border border-input bg-background px-3 py-1.5 text-sm transition-all focus:ring-2 focus:ring-ring/30 focus:border-ring" />
          <span className="text-muted-foreground text-sm">to</span>
          <input type="date" max={today} value={toDate} onChange={e => onChange(fromDate, e.target.value, 'range')}
            className="rounded-xl border border-input bg-background px-3 py-1.5 text-sm transition-all focus:ring-2 focus:ring-ring/30 focus:border-ring" />
        </div>
      )}

      {mode === 'week' && (
        <div className="flex items-center gap-2">
          <button onClick={() => {
            const d = new Date(fromDate); d.setDate(d.getDate() - 7);
            onChange(d.toISOString().split('T')[0], new Date(new Date(d).setDate(d.getDate() + 6)).toISOString().split('T')[0], 'week');
          }} className="px-2 py-1 rounded-lg border text-sm hover:bg-muted transition-colors">&larr;</button>
          <span className="text-sm font-medium">{formatDateLabel(fromDate, toDate, mode)}</span>
          <button onClick={() => {
            const d = new Date(fromDate); d.setDate(d.getDate() + 7);
            onChange(d.toISOString().split('T')[0], new Date(new Date(d).setDate(d.getDate() + 6)).toISOString().split('T')[0], 'week');
          }} className="px-2 py-1 rounded-lg border text-sm hover:bg-muted transition-colors">&rarr;</button>
        </div>
      )}

      {mode === 'month' && (
        <div className="flex items-center gap-2">
          <button onClick={() => {
            const d = new Date(fromDate); d.setMonth(d.getMonth() - 1);
            const ms = d.toISOString().split('T')[0].substring(0, 7) + '-01';
            const me = getMonthEnd(ms);
            onChange(ms, me, 'month');
          }} className="px-2 py-1 rounded-lg border text-sm hover:bg-muted transition-colors">&larr;</button>
          <span className="text-sm font-medium">{new Date(fromDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
          <button onClick={() => {
            const d = new Date(fromDate); d.setMonth(d.getMonth() + 1);
            const ms = d.toISOString().split('T')[0].substring(0, 7) + '-01';
            const me = getMonthEnd(ms);
            onChange(ms, me, 'month');
          }} className="px-2 py-1 rounded-lg border text-sm hover:bg-muted transition-colors">&rarr;</button>
        </div>
      )}
    </div>
  );
}

function ComparisonBadge({ current, previous, label }: { current: number; previous: number; label: string }) {
  if (previous === 0 && current === 0) return <span className="text-xs text-muted-foreground">{label}: No data</span>;
  const diff = previous > 0 ? ((current - previous) / previous) * 100 : current > 0 ? 100 : 0;
  const isUp = diff > 0;
  const isFlat = diff === 0;
  return (
    <div className="flex items-center gap-1.5">
      {isFlat ? <Minus size={12} className="text-muted-foreground" /> : isUp ? <ArrowUpRight size={12} className="text-emerald-600" /> : <ArrowDownRight size={12} className="text-rose-600" />}
      <span className={cn("text-xs font-medium", isFlat ? "text-muted-foreground" : isUp ? "text-emerald-600" : "text-rose-600")}>
        {isFlat ? "0%" : `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`}
      </span>
      <span className="text-xs text-muted-foreground">{label} ({formatCurrency(previous)})</span>
    </div>
  );
}

function getRangeLabel(mode: FilterMode, isSingleDay: boolean) {
  if (mode === 'today') return { sales: "Today's Sales", expenses: "Today's Expenses", waste: "Today's Waste", profit: "Est. Daily Profit", settlement: "Today's Settlement", pcSpent: "Petty Cash Spent Today" };
  if (isSingleDay) return { sales: "Day's Sales", expenses: "Day's Expenses", waste: "Day's Waste", profit: "Est. Daily Profit", settlement: "Day's Settlement", pcSpent: "Petty Cash Spent" };
  if (mode === 'week') return { sales: "Weekly Sales", expenses: "Weekly Expenses", waste: "Weekly Waste", profit: "Est. Weekly Profit", settlement: "Weekly Settlement", pcSpent: "Petty Cash Spent" };
  if (mode === 'month') return { sales: "Monthly Sales", expenses: "Monthly Expenses", waste: "Monthly Waste", profit: "Est. Monthly Profit", settlement: "Monthly Settlement", pcSpent: "Petty Cash Spent" };
  return { sales: "Total Sales", expenses: "Total Expenses", waste: "Total Waste", profit: "Est. Profit", settlement: "Settlement Total", pcSpent: "Petty Cash Spent" };
}

function getComparisonLabel(mode: FilterMode, isSingleDay: boolean) {
  if (isSingleDay) return { prev: "vs Yesterday", lastWeek: "vs Last Week Same Day" };
  return { prev: "vs Previous Period", lastWeek: "" };
}

function ManagerDashboard({ summary, mode }: { summary: any; mode: FilterMode }) {
  const isSingleDay = summary.isSingleDay;
  const labels = getRangeLabel(mode, isSingleDay);
  const compLabels = getComparisonLabel(mode, isSingleDay);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-card border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-xl text-emerald-600 bg-emerald-100">
              <DollarSign size={22} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground font-medium">{labels.sales}</p>
              <p className="text-3xl font-numbers font-bold tracking-tight tabular-nums text-foreground">{formatCurrency(summary.todaySales)}</p>
            </div>
          </div>
          <div className="space-y-2 pt-3 border-t border-border">
            <ComparisonBadge current={summary.todaySales} previous={summary.yesterdaySales || 0} label={compLabels.prev} />
            {isSingleDay && <ComparisonBadge current={summary.todaySales} previous={summary.lastWeekSameDaySales || 0} label={compLabels.lastWeek} />}
          </div>
        </div>

        <StatCard title={labels.expenses} value={formatCurrency(summary.todayExpenses)} icon={TrendingDown} colorClass="text-rose-600 bg-rose-100" />
        <StatCard title={labels.waste} value={formatCurrency(summary.todayWaste)} icon={PackageMinus} colorClass="text-amber-600 bg-amber-100" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <StatCard title="Petty Cash Balance" value={formatCurrency(summary.pettyCashBalance || 0)} icon={Wallet} colorClass="text-violet-600 bg-violet-100" />
        <StatCard title={labels.pcSpent} value={formatCurrency(summary.pettyCashSpentToday || 0)} icon={Wallet} colorClass="text-rose-500 bg-rose-100" />
      </div>
    </div>
  );
}

const CHART_COLORS = ['#10b981', '#f43f5e', '#f59e0b', '#6366f1', '#3b82f6', '#8b5cf6', '#ec4899'];

function TrendCharts() {
  const [trend, setTrend] = useState<any[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    customFetch(`${BASE}api/dashboard/trend?days=${days}`).then((data: any) => {
      setTrend(data.map((d: any) => ({
        ...d,
        label: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      })));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [days]);

  if (loading) return <div className="py-8 text-center text-muted-foreground">Loading charts...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-display font-semibold text-foreground">Revenue & Expense Trend</h3>
        <div className="flex gap-1 bg-muted/60 rounded-xl p-1">
          {[{ val: 7, label: '7D' }, { val: 14, label: '14D' }, { val: 30, label: '30D' }].map(opt => (
            <button key={opt.val} onClick={() => setDays(opt.val)}
              className={cn("px-3 py-1 rounded-lg text-xs font-medium transition-all",
                days === opt.val ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <h4 className="text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wider">Sales vs Expenses</h4>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{ borderRadius: '12px', border: '1px solid var(--border)', background: 'var(--card)' }} />
              <Legend />
              <Bar dataKey="sales" name="Sales" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expenses" name="Expenses" fill="#f43f5e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="waste" name="Waste" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <h4 className="text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wider">Profit Trend</h4>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{ borderRadius: '12px', border: '1px solid var(--border)', background: 'var(--card)' }} />
              <Legend />
              <Line type="monotone" dataKey="profit" name="Est. Profit" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="sales" name="Sales" stroke="#10b981" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function AdminDashboard({ summary, mode }: { summary: any; mode: FilterMode }) {
  const isSingleDay = summary.isSingleDay;
  const labels = getRangeLabel(mode, isSingleDay);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title={labels.sales} value={formatCurrency(summary.todaySales)} icon={DollarSign}
          trend={summary.yesterdaySales > 0 ? ((summary.todaySales - summary.yesterdaySales) / summary.yesterdaySales) * 100 : 0}
          trendLabel={isSingleDay ? "vs yesterday" : "vs prev period"}
          colorClass="text-emerald-600 bg-emerald-100"
        />
        <StatCard title={labels.profit} value={formatCurrency(summary.todayEstimatedProfit)} icon={TrendingUp} colorClass="text-primary bg-primary/10" />
        <StatCard title={labels.expenses} value={formatCurrency(summary.todayExpenses)} icon={TrendingDown} colorClass="text-rose-600 bg-rose-100" />
        <StatCard title={labels.waste} value={formatCurrency(summary.todayWaste)} icon={PackageMinus} colorClass="text-amber-600 bg-amber-100" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title={labels.settlement} value={formatCurrency(summary.todaySettlement || 0)} icon={Banknote} colorClass="text-blue-600 bg-blue-100" />
        <StatCard title="Settlement Difference" value={formatCurrency(Math.abs(summary.todaySettlementDiff || 0))} icon={Banknote} colorClass={(summary.todaySettlementDiff || 0) === 0 ? "text-emerald-600 bg-emerald-100" : "text-amber-600 bg-amber-100"} />
        <StatCard title="Petty Cash Balance" value={formatCurrency(summary.pettyCashBalance || 0)} icon={Wallet} colorClass="text-violet-600 bg-violet-100" />
        <StatCard title={labels.pcSpent} value={formatCurrency(summary.pettyCashSpentToday || 0)} icon={Wallet} colorClass="text-rose-500 bg-rose-100" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Vendor Payable" value={formatCurrency(summary.vendorPayable || 0)} icon={CreditCard} colorClass="text-orange-600 bg-orange-100" />
        <StatCard title="Vendor Overdue" value={formatCurrency(summary.vendorOverdue || 0)} icon={AlertOctagon} colorClass={(summary.vendorOverdue || 0) > 0 ? "text-red-600 bg-red-100" : "text-emerald-600 bg-emerald-100"} />
        <StatCard title="Invoices" value={`${summary.invoiceStats?.count || 0}`} icon={FileText} colorClass="text-indigo-600 bg-indigo-100" />
        <StatCard title="GST Collected" value={formatCurrency(summary.invoiceStats?.gstCollected || 0)} icon={FileText} colorClass="text-cyan-600 bg-cyan-100" />
      </div>

      <TrendCharts />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-display font-semibold mb-4 text-foreground">Insights</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {summary.insights?.length > 0 ? summary.insights.map((insight: string, i: number) => (
                <div key={i} className="flex items-start gap-3 p-4 bg-muted/50 rounded-xl border border-border/50">
                  <div className="mt-0.5 text-primary"><TrendingUpDown size={18} /></div>
                  <p className="text-sm text-foreground font-medium leading-relaxed">{insight}</p>
                </div>
              )) : (
                <div className="p-4 text-sm text-muted-foreground">No insights generated yet.</div>
              )}
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              <h3 className="text-lg font-display font-semibold mb-4">Top Items by Profit</h3>
              <div className="space-y-3">
                {summary.topItemsByProfit?.slice(0,5).map((item: any) => (
                  <div key={item.menuItemId} className="flex items-center justify-between pb-3 border-b border-border/50 last:border-0 last:pb-0">
                    <div>
                      <p className="font-medium text-sm text-foreground">{item.menuItemName}</p>
                      <p className="text-xs text-muted-foreground">{Number(item.quantitySold).toFixed(2)} sold</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-sm text-emerald-600">{formatCurrency(item.grossProfit)}</p>
                      <p className="text-xs text-muted-foreground">{Number(item.marginPercent).toFixed(2)}% margin</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              <h3 className="text-lg font-display font-semibold mb-4">Top Waste Drivers</h3>
              <div className="space-y-3">
                {summary.topWasteItems?.slice(0,5).map((item: any, i: number) => (
                  <div key={i} className="flex items-center justify-between pb-3 border-b border-border/50 last:border-0 last:pb-0">
                    <p className="font-medium text-sm text-foreground">{item.name}</p>
                    <p className="font-semibold text-sm text-rose-600">{formatCurrency(item.value)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-rose-50/50 dark:bg-rose-950/10 border border-rose-200 dark:border-rose-900/50 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-6">
            <AlertCircle className="text-rose-600" size={24} />
            <h3 className="text-lg font-display font-semibold text-rose-950 dark:text-rose-400">Action Required</h3>
          </div>
          
          <div className="space-y-5">
            {summary.lowStockCount > 0 && (
              <div className="bg-white dark:bg-card p-4 rounded-xl border border-rose-100 dark:border-border shadow-sm">
                <h4 className="font-semibold text-sm text-rose-700 dark:text-rose-400 mb-1">Low Stock Alert</h4>
                <p className="text-xs text-muted-foreground">{Number(summary.lowStockCount).toFixed(0)} ingredients are below reorder level.</p>
              </div>
            )}
            {summary.pendingRecurringExpenses > 0 && (
              <div className="bg-white dark:bg-card p-4 rounded-xl border border-amber-100 dark:border-border shadow-sm">
                <h4 className="font-semibold text-sm text-amber-700 dark:text-amber-500 mb-1">Pending Expenses</h4>
                <p className="text-xs text-muted-foreground">{Number(summary.pendingRecurringExpenses).toFixed(0)} recurring expenses due soon.</p>
              </div>
            )}
            
            {summary.alerts?.map((alert: any, i: number) => (
              <div key={i} className="bg-white dark:bg-card p-4 rounded-xl border border-border shadow-sm">
                <h4 className={cn("font-semibold text-sm mb-1 capitalize", alert.severity === 'high' ? 'text-rose-600' : 'text-amber-600')}>
                  {alert.type.replace('_', ' ')}
                </h4>
                <p className="text-xs text-muted-foreground">{alert.message}</p>
              </div>
            ))}
            
            {(!summary.alerts?.length && summary.lowStockCount === 0 && !summary.pendingRecurringExpenses) && (
              <p className="text-sm text-muted-foreground text-center py-8">All clear! No urgent alerts.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const today = getToday();

  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [mode, setMode] = useState<FilterMode>('today');
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await customFetch(`${BASE}api/dashboard/summary?fromDate=${fromDate}&toDate=${toDate}`);
      setSummary(res);
    } catch { }
    setLoading(false);
  }, [fromDate, toDate]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const handleFilterChange = (from: string, to: string, m: FilterMode) => {
    setFromDate(from);
    setToDate(to);
    setMode(m);
  };

  const title = isAdmin ? "Owner's Dashboard" : "Operations Dashboard";
  const subtitle = mode === 'today'
    ? formatDateLabel(fromDate, toDate, mode)
    : `${formatDateLabel(fromDate, toDate, mode)}`;

  return (
    <div className="space-y-6 pb-10">
      <PageHeader title={title} description={subtitle}>
        <Badge variant="neutral" className="px-4 py-1.5 text-sm font-medium">
          <CalendarDays size={14} className="mr-1.5" />
          {mode === 'today' ? 'Live' : mode.charAt(0).toUpperCase() + mode.slice(1)}
        </Badge>
      </PageHeader>

      <DateFilterBar fromDate={fromDate} toDate={toDate} mode={mode} onChange={handleFilterChange} />

      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>
      ) : !summary ? (
        <div className="text-destructive p-10">Failed to load dashboard data.</div>
      ) : isAdmin ? (
        <AdminDashboard summary={summary} mode={mode} />
      ) : (
        <ManagerDashboard summary={summary} mode={mode} />
      )}
    </div>
  );
}
