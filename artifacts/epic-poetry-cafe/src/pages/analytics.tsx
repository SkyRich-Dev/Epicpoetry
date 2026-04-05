import React, { useState, useEffect } from 'react';
import { PageHeader, Button, Select, Label, Input, formatCurrency, formatDate } from '../components/ui-extras';
import { BarChart3, TrendingUp, Trash2, Download, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

type Period = 'daily' | 'weekly' | 'monthly' | 'custom';
type ReportTab = 'profitability' | 'wastage';

interface ProfitabilityItem {
  menuItemId: number;
  menuItemName: string;
  sellingPrice: number;
  unitProductionCost: number;
  quantitySold: number;
  grossSales: number;
  totalDiscount: number;
  netRevenue: number;
  totalProductionCost: number;
  grossProfit: number;
  marginPercent: number;
  costToSaleRatio: number;
}

interface ProfitabilityReport {
  period: string;
  fromDate: string;
  toDate: string;
  items: ProfitabilityItem[];
  summary: {
    totalRevenue: number;
    totalProductionCost: number;
    totalGrossProfit: number;
    avgMarginPercent: number;
    totalItemsSold: number;
  };
}

interface WasteItem {
  type: string;
  id: number;
  name: string;
  entries: number;
  totalQuantity: number;
  uom: string;
  totalCostValue: number;
  topReasons: { reason: string; count: number }[];
}

interface WastageReport {
  period: string;
  fromDate: string;
  toDate: string;
  ingredientWaste: WasteItem[];
  menuItemWaste: WasteItem[];
  dailyTrend: { date: string; value: number }[];
  summary: {
    totalWasteEntries: number;
    totalWasteCost: number;
    totalSalesRevenue: number;
    wasteToSalesPercent: number;
    uniqueIngredientsWasted: number;
    uniqueMenuItemsWasted: number;
  };
}

function PeriodSelector({ period, setPeriod, date, setDate, fromDate, setFromDate, toDate, setToDate }: {
  period: Period; setPeriod: (p: Period) => void;
  date: string; setDate: (d: string) => void;
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex rounded-xl border border-border overflow-hidden">
        {(['daily', 'weekly', 'monthly', 'custom'] as Period[]).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`px-4 py-2 text-xs font-semibold capitalize transition-colors ${period === p ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
            {p}
          </button>
        ))}
      </div>
      {period === 'custom' ? (
        <>
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" max={new Date().toISOString().split('T')[0]} value={fromDate} onChange={(e: any) => setFromDate(e.target.value)} className="h-9 text-sm w-36" />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" max={new Date().toISOString().split('T')[0]} value={toDate} onChange={(e: any) => setToDate(e.target.value)} className="h-9 text-sm w-36" />
          </div>
        </>
      ) : (
        <div>
          <Label className="text-xs">{period === 'daily' ? 'Date' : period === 'weekly' ? 'Week of' : 'Month'}</Label>
          <Input type="date" max={new Date().toISOString().split('T')[0]} value={date} onChange={(e: any) => setDate(e.target.value)} className="h-9 text-sm w-36" />
        </div>
      )}
    </div>
  );
}

function SummaryCard({ title, value, subtitle, trend }: { title: string; value: string; subtitle?: string; trend?: 'up' | 'down' | 'neutral' }) {
  return (
    <div className="bg-card rounded-xl border border-border/50 p-4">
      <p className="text-xs font-medium text-muted-foreground mb-1">{title}</p>
      <p className="text-xl font-bold">{value}</p>
      {subtitle && (
        <p className={`text-xs mt-1 flex items-center gap-1 ${trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-muted-foreground'}`}>
          {trend === 'up' && <ArrowUpRight size={12} />}
          {trend === 'down' && <ArrowDownRight size={12} />}
          {trend === 'neutral' && <Minus size={12} />}
          {subtitle}
        </p>
      )}
    </div>
  );
}

function MarginBar({ percent }: { percent: number }) {
  const color = percent >= 70 ? 'bg-green-500' : percent >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
      <span className={`text-xs font-semibold ${percent >= 70 ? 'text-green-600' : percent >= 40 ? 'text-yellow-600' : 'text-red-600'}`}>{percent}%</span>
    </div>
  );
}

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>('profitability');
  const [period, setPeriod] = useState<Period>('monthly');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [fromDate, setFromDate] = useState(new Date().toISOString().split('T')[0]);
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profitData, setProfitData] = useState<ProfitabilityReport | null>(null);
  const [wasteData, setWasteData] = useState<WastageReport | null>(null);

  const fetchReport = async () => {
    setLoading(true);
    setError(null);
    const token = localStorage.getItem('token');
    const baseUrl = import.meta.env.BASE_URL || '/';
    const apiBase = `${window.location.origin}${baseUrl}api`.replace(/\/+/g, '/').replace(':/', '://');

    const params = new URLSearchParams({ period });
    if (period === 'custom') {
      params.set('fromDate', fromDate);
      params.set('toDate', toDate);
    } else {
      params.set('fromDate', date);
    }

    try {
      if (activeTab === 'profitability') {
        const resp = await fetch(`${apiBase}/reports/item-profitability?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) { const err = await resp.json().catch(() => ({})); setError(err.error || 'Failed to load report'); return; }
        setProfitData(await resp.json());
      } else {
        const resp = await fetch(`${apiBase}/reports/item-wastage?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) { const err = await resp.json().catch(() => ({})); setError(err.error || 'Failed to load report'); return; }
        setWasteData(await resp.json());
      }
    } catch (e: any) {
      console.error(e);
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReport(); }, [activeTab, period, date, fromDate, toDate]);

  const handleExportCSV = () => {
    let csv = '';
    if (activeTab === 'profitability' && profitData) {
      csv = 'Item,Selling Price,Unit Cost,Qty Sold,Net Revenue,Production Cost,Gross Profit,Margin %\n';
      csv += profitData.items.map(i =>
        `"${i.menuItemName}",${i.sellingPrice},${i.unitProductionCost},${i.quantitySold},${i.netRevenue},${i.totalProductionCost},${i.grossProfit},${i.marginPercent}`
      ).join('\n');
    } else if (activeTab === 'wastage' && wasteData) {
      csv = 'Type,Name,Entries,Quantity,UOM,Cost Value,Top Reason\n';
      const all = [...wasteData.ingredientWaste, ...wasteData.menuItemWaste];
      csv += all.map(i =>
        `${i.type},"${i.name}",${i.entries},${i.totalQuantity},${i.uom},${i.totalCostValue},"${i.topReasons[0]?.reason || ''}"`
      ).join('\n');
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${activeTab}_report.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics Reports" description="Item profitability and wastage analysis with flexible date ranges">
        <Button onClick={handleExportCSV} className="bg-secondary text-secondary-foreground hover:bg-secondary/80">
          <Download size={18} /> Export CSV
        </Button>
      </PageHeader>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex rounded-xl border border-border overflow-hidden">
          <button onClick={() => setActiveTab('profitability')}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-colors ${activeTab === 'profitability' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
            <TrendingUp size={16} /> Item Profitability
          </button>
          <button onClick={() => setActiveTab('wastage')}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-colors ${activeTab === 'wastage' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
            <Trash2 size={16} /> Item Wastage
          </button>
        </div>
        <PeriodSelector period={period} setPeriod={setPeriod} date={date} setDate={setDate} fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-center gap-3 animate-in fade-in duration-200">
          <div className="text-red-600 text-sm">{error}</div>
          <Button onClick={fetchReport} className="ml-auto text-xs h-8 px-3 bg-red-100 text-red-700 hover:bg-red-200">Retry</Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
        </div>
      ) : activeTab === 'profitability' && profitData ? (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="text-xs text-muted-foreground">
            {formatDate(profitData.fromDate)} — {formatDate(profitData.toDate)}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <SummaryCard title="Net Revenue" value={formatCurrency(profitData.summary.totalRevenue)} />
            <SummaryCard title="Production Cost" value={formatCurrency(profitData.summary.totalProductionCost)} />
            <SummaryCard title="Gross Profit" value={formatCurrency(profitData.summary.totalGrossProfit)}
              subtitle={`${Number(profitData.summary.avgMarginPercent).toFixed(2)}% margin`}
              trend={profitData.summary.avgMarginPercent >= 60 ? 'up' : profitData.summary.avgMarginPercent >= 30 ? 'neutral' : 'down'} />
            <SummaryCard title="Items Sold" value={Math.round(Number(profitData.summary.totalItemsSold)).toLocaleString()} />
            <SummaryCard title="Avg Margin" value={`${Number(profitData.summary.avgMarginPercent).toFixed(2)}%`}
              trend={profitData.summary.avgMarginPercent >= 60 ? 'up' : profitData.summary.avgMarginPercent >= 30 ? 'neutral' : 'down'} />
          </div>

          <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted text-muted-foreground text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3 text-left">Menu Item</th>
                    <th className="px-5 py-3 text-right">Sell Price</th>
                    <th className="px-5 py-3 text-right">Unit Cost</th>
                    <th className="px-5 py-3 text-right">Cost %</th>
                    <th className="px-5 py-3 text-right">Qty Sold</th>
                    <th className="px-5 py-3 text-right">Net Revenue</th>
                    <th className="px-5 py-3 text-right">Prod. Cost</th>
                    <th className="px-5 py-3 text-right">Gross Profit</th>
                    <th className="px-5 py-3 text-right">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {profitData.items.length === 0 ? (
                    <tr><td colSpan={9} className="px-5 py-8 text-center text-muted-foreground">No data for this period</td></tr>
                  ) : profitData.items.map(item => (
                    <tr key={item.menuItemId} className="hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-3 font-medium">{item.menuItemName}</td>
                      <td className="px-5 py-3 text-right text-muted-foreground">{formatCurrency(item.sellingPrice)}</td>
                      <td className="px-5 py-3 text-right text-muted-foreground">{formatCurrency(item.unitProductionCost)}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${item.costToSaleRatio <= 30 ? 'bg-green-100 text-green-700' : item.costToSaleRatio <= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                          {Number(item.costToSaleRatio).toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">{Math.round(Number(item.quantitySold)).toLocaleString()}</td>
                      <td className="px-5 py-3 text-right font-medium">{formatCurrency(item.netRevenue)}</td>
                      <td className="px-5 py-3 text-right text-muted-foreground">{formatCurrency(item.totalProductionCost)}</td>
                      <td className="px-5 py-3 text-right font-semibold">{formatCurrency(item.grossProfit)}</td>
                      <td className="px-5 py-3 text-right"><MarginBar percent={item.marginPercent} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : activeTab === 'wastage' && wasteData ? (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="text-xs text-muted-foreground">
            {formatDate(wasteData.fromDate)} — {formatDate(wasteData.toDate)}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard title="Total Waste Cost" value={formatCurrency(wasteData.summary.totalWasteCost)}
              subtitle={`${Number(wasteData.summary.wasteToSalesPercent).toFixed(2)}% of sales`}
              trend={wasteData.summary.wasteToSalesPercent <= 2 ? 'up' : wasteData.summary.wasteToSalesPercent <= 5 ? 'neutral' : 'down'} />
            <SummaryCard title="Waste Entries" value={Math.round(Number(wasteData.summary.totalWasteEntries)).toLocaleString()} />
            <SummaryCard title="Ingredients Wasted" value={Math.round(Number(wasteData.summary.uniqueIngredientsWasted)).toLocaleString()} />
            <SummaryCard title="Menu Items Wasted" value={Math.round(Number(wasteData.summary.uniqueMenuItemsWasted)).toLocaleString()} />
          </div>

          {wasteData.ingredientWaste.length > 0 && (
            <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
              <div className="px-5 py-3 border-b border-border/50 bg-transparent">
                <h3 className="font-semibold text-sm">Ingredient Wastage</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-muted-foreground text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-5 py-3 text-left">Ingredient</th>
                      <th className="px-5 py-3 text-right">Entries</th>
                      <th className="px-5 py-3 text-right">Qty Wasted</th>
                      <th className="px-5 py-3 text-left">UOM</th>
                      <th className="px-5 py-3 text-right">Cost Value</th>
                      <th className="px-5 py-3 text-left">Top Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {wasteData.ingredientWaste.map(item => (
                      <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-5 py-3 font-medium">{item.name}</td>
                        <td className="px-5 py-3 text-right">{Math.round(Number(item.entries))}</td>
                        <td className="px-5 py-3 text-right font-medium">{Number(item.totalQuantity).toFixed(2)}</td>
                        <td className="px-5 py-3 text-muted-foreground">{item.uom}</td>
                        <td className="px-5 py-3 text-right font-semibold text-red-600">{formatCurrency(item.totalCostValue)}</td>
                        <td className="px-5 py-3">
                          {item.topReasons.length > 0 && (
                            <span className="text-xs bg-muted px-2 py-1 rounded-full">{item.topReasons[0].reason} ({item.topReasons[0].count})</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {wasteData.menuItemWaste.length > 0 && (
            <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
              <div className="px-5 py-3 border-b border-border/50 bg-transparent">
                <h3 className="font-semibold text-sm">Menu Item Wastage</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-muted-foreground text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-5 py-3 text-left">Menu Item</th>
                      <th className="px-5 py-3 text-right">Entries</th>
                      <th className="px-5 py-3 text-right">Qty Wasted</th>
                      <th className="px-5 py-3 text-left">UOM</th>
                      <th className="px-5 py-3 text-right">Cost Value</th>
                      <th className="px-5 py-3 text-left">Top Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {wasteData.menuItemWaste.map(item => (
                      <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-5 py-3 font-medium">{item.name}</td>
                        <td className="px-5 py-3 text-right">{Math.round(Number(item.entries))}</td>
                        <td className="px-5 py-3 text-right font-medium">{Number(item.totalQuantity).toFixed(2)}</td>
                        <td className="px-5 py-3 text-muted-foreground">{item.uom}</td>
                        <td className="px-5 py-3 text-right font-semibold text-red-600">{formatCurrency(item.totalCostValue)}</td>
                        <td className="px-5 py-3">
                          {item.topReasons.length > 0 && (
                            <span className="text-xs bg-muted px-2 py-1 rounded-full">{item.topReasons[0].reason} ({item.topReasons[0].count})</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {wasteData.dailyTrend.length > 0 && (
            <div className="bg-card rounded-2xl border border-border/50 p-5">
              <h3 className="font-semibold text-sm mb-4">Daily Waste Cost Trend</h3>
              <div className="flex items-end gap-1 h-32">
                {wasteData.dailyTrend.map((d, idx) => {
                  const max = Math.max(...wasteData.dailyTrend.map(t => t.value));
                  const height = max > 0 ? (d.value / max) * 100 : 0;
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-1 group relative">
                      <div className="absolute -top-6 opacity-0 group-hover:opacity-100 bg-foreground text-background text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap transition-opacity">
                        {formatDate(d.date)}: {formatCurrency(d.value)}
                      </div>
                      <div className="w-full bg-red-400/80 rounded-t" style={{ height: `${height}%`, minHeight: d.value > 0 ? '4px' : '0' }} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {wasteData.ingredientWaste.length === 0 && wasteData.menuItemWaste.length === 0 && (
            <div className="bg-card rounded-2xl border border-border/50 p-12 text-center">
              <Trash2 size={40} className="mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground">No waste entries recorded for this period</p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
