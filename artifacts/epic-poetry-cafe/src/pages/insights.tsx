import React, { useState, useEffect } from 'react';
import { PageHeader, Button, formatCurrency } from '../components/ui-extras';
import { TrendingUp, TrendingDown, Users, Receipt, IndianRupee, Repeat, UserPlus, Clock, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';

const BASE = import.meta.env.BASE_URL || '/';
async function apiFetch(path: string, opts?: any) {
  const token = localStorage.getItem('token');
  const headers: any = { 'Authorization': `Bearer ${token}` };
  if (opts?.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}api/${path}`, { ...opts, headers: { ...headers, ...opts?.headers } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const SEG_COLORS = ['#a855f7', '#3b82f6', '#10b981', '#f59e0b', '#9ca3af'];

export default function InsightsPage() {
  const { toast } = useToast();
  const [comparisons, setComparisons] = useState<any>(null);
  const [trend, setTrend] = useState<any[]>([]);
  const [peakHours, setPeakHours] = useState<any>(null);
  const [repeatNew, setRepeatNew] = useState<any>(null);
  const [topItems, setTopItems] = useState<{ top: any[]; bottom: any[] }>({ top: [], bottom: [] });
  const [seg, setSeg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const load = async () => {
    setLoading(true);
    try {
      const [c, t, p, rn, ti, sg] = await Promise.all([
        apiFetch('insights/comparisons'),
        apiFetch(`insights/daily-trend?days=${days}`),
        apiFetch('insights/peak-hours'),
        apiFetch('insights/repeat-vs-new'),
        apiFetch('insights/top-items?limit=10'),
        apiFetch('insights/segmentation'),
      ]);
      setComparisons(c); setTrend(t); setPeakHours(p); setRepeatNew(rn); setTopItems(ti); setSeg(sg);
    } catch (e: any) { toast({ title: 'Failed to load insights', description: e.message, variant: 'destructive' }); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [days]);

  const today = comparisons?.todayVsYesterday?.current;

  return (
    <div className="space-y-6">
      <PageHeader title="Insights" description="Customer intelligence & business analytics">
        <select value={days} onChange={e => setDays(Number(e.target.value))} className="rounded-xl border px-3 py-2 text-sm bg-background">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </PageHeader>

      {loading && <div className="text-center py-12 text-muted-foreground">Loading insights…</div>}

      {!loading && (
        <>
          {/* Top cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              icon={IndianRupee} title="Today Sales"
              value={formatCurrency(today?.totalSales || 0)}
              growth={comparisons?.todayVsYesterday?.salesGrowthPct}
              subtitle="vs yesterday"
            />
            <KpiCard
              icon={Users} title="Today Customers"
              value={String(today?.totalCustomers || 0)}
              growth={comparisons?.todayVsYesterday?.customerGrowthPct}
              subtitle="vs yesterday"
            />
            <KpiCard
              icon={Receipt} title="Today Avg Bill"
              value={formatCurrency(today?.avgBill || 0)}
              subtitle={`${today?.totalInvoices || 0} invoices`}
            />
            <KpiCard
              icon={Repeat} title="Repeat %"
              value={`${repeatNew?.repeatPct || 0}%`}
              subtitle={`${repeatNew?.repeatCount || 0} repeat / ${repeatNew?.newCount || 0} new`}
            />
          </div>

          {/* Comparisons */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ComparisonCard
              title="Today vs Same Day Last Week"
              current={comparisons?.todayVsSameDayLastWeek?.current?.totalSales}
              previous={comparisons?.todayVsSameDayLastWeek?.previous?.totalSales}
              pct={comparisons?.todayVsSameDayLastWeek?.salesGrowthPct}
            />
            <ComparisonCard
              title="This Week vs Last Week"
              current={comparisons?.weekVsLastWeek?.current?.totalSales}
              previous={comparisons?.weekVsLastWeek?.previous?.totalSales}
              pct={comparisons?.weekVsLastWeek?.salesGrowthPct}
              extra={`${comparisons?.weekVsLastWeek?.current?.totalCustomers || 0} customers · ${comparisons?.weekVsLastWeek?.customerGrowthPct >= 0 ? '+' : ''}${comparisons?.weekVsLastWeek?.customerGrowthPct}% WoW`}
            />
            <ComparisonCard
              title="This Month vs Last Month"
              current={comparisons?.monthVsLastMonth?.current?.totalSales}
              previous={comparisons?.monthVsLastMonth?.previous?.totalSales}
              pct={comparisons?.monthVsLastMonth?.salesGrowthPct}
              extra={`${comparisons?.monthVsLastMonth?.current?.totalCustomers || 0} customers`}
            />
          </div>

          {/* Daily trend */}
          <div className="rounded-2xl border bg-card p-5">
            <div className="font-semibold mb-3">Daily Sales Trend ({days} days)</div>
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <LineChart data={trend} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={Math.max(0, Math.floor(trend.length / 10) - 1)} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any, k: string) => k === 'sales' ? formatCurrency(v) : v} />
                  <Line type="monotone" dataKey="sales" stroke="#3b82f6" strokeWidth={2} dot={false} name="Sales (₹)" />
                  <Line type="monotone" dataKey="customers" stroke="#10b981" strokeWidth={2} dot={false} name="Customers" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Peak hours + segmentation */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border bg-card p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold flex items-center gap-2"><Clock className="w-4 h-4" /> Peak Hours</div>
                <div className="text-xs text-muted-foreground">
                  Peak: {peakHours?.peakHour !== null ? `${peakHours.peakHour}:00` : '—'} · Quiet: {peakHours?.leastHour !== null ? `${peakHours.leastHour}:00` : '—'}
                </div>
              </div>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={peakHours?.hours || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any) => v} labelFormatter={(h: any) => `${h}:00`} />
                    <Bar dataKey="visits" fill="#a855f7" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border bg-card p-5">
              <div className="font-semibold flex items-center gap-2 mb-3"><Sparkles className="w-4 h-4" /> Customer Segmentation</div>
              {seg && seg.total > 0 ? (
                <div style={{ width: '100%', height: 240 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'High Value', value: seg.high_value },
                          { name: 'Frequent', value: seg.frequent },
                          { name: 'Regular', value: seg.regular },
                          { name: 'New', value: seg.new },
                          { name: 'Inactive', value: seg.inactive },
                        ].filter(d => d.value > 0)}
                        dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label
                      >
                        {SEG_COLORS.map((c, i) => <Cell key={i} fill={c} />)}
                      </Pie>
                      <Legend />
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground py-12 text-center">No customer profiles yet. Capture phone numbers on invoices.</div>
              )}
              {seg && <div className="text-xs text-muted-foreground mt-2">{seg.total} total customer profiles</div>}
            </div>
          </div>

          {/* Top & bottom items */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ItemList title="Top Selling Items" items={topItems.top} accent="text-emerald-700" />
            <ItemList title="Least Selling Items" items={topItems.bottom} accent="text-rose-700" />
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ icon: Icon, title, value, growth, subtitle }: any) {
  const isUp = growth !== undefined && growth >= 0;
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{title}</div>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="text-2xl font-semibold mt-2">{value}</div>
      {growth !== undefined && (
        <div className={`text-xs mt-1 flex items-center gap-1 ${isUp ? 'text-emerald-600' : 'text-rose-600'}`}>
          {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {growth >= 0 ? '+' : ''}{growth}% {subtitle}
        </div>
      )}
      {growth === undefined && subtitle && <div className="text-xs mt-1 text-muted-foreground">{subtitle}</div>}
    </div>
  );
}

function ComparisonCard({ title, current, previous, pct, extra }: any) {
  const isUp = pct >= 0;
  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="text-sm font-semibold">{title}</div>
      <div className="flex items-baseline gap-3 mt-3">
        <div className="text-2xl font-semibold">{formatCurrency(current || 0)}</div>
        <div className={`text-sm ${isUp ? 'text-emerald-600' : 'text-rose-600'}`}>
          {pct >= 0 ? '+' : ''}{pct}%
        </div>
      </div>
      <div className="text-xs text-muted-foreground mt-1">prev: {formatCurrency(previous || 0)}</div>
      {extra && <div className="text-xs text-muted-foreground mt-2">{extra}</div>}
    </div>
  );
}

function ItemList({ title, items, accent }: { title: string; items: any[]; accent: string }) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className={`font-semibold mb-3 ${accent}`}>{title}</div>
      {items.length === 0 ? <div className="text-sm text-muted-foreground">No data</div> :
        <div className="space-y-2">
          {items.map((i, idx) => (
            <div key={i.itemId} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-5">{idx + 1}.</span>
                <span>{i.itemName}</span>
              </div>
              <div className="text-muted-foreground text-xs">{i.qty} × · {formatCurrency(i.sales)}</div>
            </div>
          ))}
        </div>}
    </div>
  );
}
