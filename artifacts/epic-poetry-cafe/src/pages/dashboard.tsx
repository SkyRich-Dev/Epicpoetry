import React, { useState } from 'react';
import { useGetDashboardSummary } from '@workspace/api-client-react';
import { PageHeader, StatCard, formatCurrency, Badge, cn } from '../components/ui-extras';
import { DollarSign, TrendingUp, TrendingDown, PackageMinus, AlertCircle, TrendingUpDown, Banknote, Wallet } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';

export default function Dashboard() {
  const today = new Date().toISOString().split('T')[0];
  const { data: summary, isLoading, error } = useGetDashboardSummary({ date: today });

  if (isLoading) return <div className="p-10 flex justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>;
  if (error || !summary) return <div className="text-destructive p-10">Failed to load dashboard data. API might be incomplete.</div>;

  return (
    <div className="space-y-8 pb-10">
      <PageHeader 
        title="Owner's Dashboard" 
        description={`Overview for ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
      >
        <Badge variant="neutral" className="px-4 py-1.5 text-sm font-medium">Business Day Active</Badge>
      </PageHeader>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Today's Sales" 
          value={formatCurrency(summary.todaySales)} 
          icon={DollarSign}
          trend={+12.5}
          trendLabel="vs yesterday"
          colorClass="text-emerald-600 bg-emerald-100"
        />
        <StatCard 
          title="Est. Daily Profit" 
          value={formatCurrency(summary.todayEstimatedProfit)} 
          icon={TrendingUp}
          trend={+5.2}
          trendLabel="vs average"
          colorClass="text-primary bg-primary/10"
        />
        <StatCard 
          title="Today's Expenses" 
          value={formatCurrency(summary.todayExpenses)} 
          icon={TrendingDown}
          colorClass="text-rose-600 bg-rose-100"
        />
        <StatCard 
          title="Today's Waste" 
          value={formatCurrency(summary.todayWaste)} 
          icon={PackageMinus}
          colorClass="text-amber-600 bg-amber-100"
        />
      </div>

      {/* Finance Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Today's Settlement" 
          value={formatCurrency((summary as any).todaySettlement || 0)} 
          icon={Banknote}
          colorClass="text-blue-600 bg-blue-100"
        />
        <StatCard 
          title="Settlement Difference" 
          value={formatCurrency(Math.abs((summary as any).todaySettlementDiff || 0))} 
          icon={Banknote}
          colorClass={((summary as any).todaySettlementDiff || 0) === 0 ? "text-emerald-600 bg-emerald-100" : "text-amber-600 bg-amber-100"}
        />
        <StatCard 
          title="Petty Cash Balance" 
          value={formatCurrency((summary as any).pettyCashBalance || 0)} 
          icon={Wallet}
          colorClass="text-violet-600 bg-violet-100"
        />
        <StatCard 
          title="Petty Cash Spent Today" 
          value={formatCurrency((summary as any).pettyCashSpentToday || 0)} 
          icon={Wallet}
          colorClass="text-rose-500 bg-rose-100"
        />
      </div>

      {/* Alerts & Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-display font-semibold mb-4 text-foreground">Insights</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {summary.insights?.length > 0 ? summary.insights.map((insight, i) => (
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
                {summary.topItemsByProfit?.slice(0,5).map(item => (
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
                {summary.topWasteItems?.slice(0,5).map((item, i) => (
                  <div key={i} className="flex items-center justify-between pb-3 border-b border-border/50 last:border-0 last:pb-0">
                    <p className="font-medium text-sm text-foreground">{item.name}</p>
                    <p className="font-semibold text-sm text-rose-600">{formatCurrency(item.value)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Alerts Sidebar */}
        <div className="bg-rose-50/50 dark:bg-rose-950/10 border border-rose-200 dark:border-rose-900/50 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-6">
            <AlertCircle className="text-rose-600" size={24} />
            <h3 className="text-lg font-display font-semibold text-rose-950 dark:text-rose-400">Action Required</h3>
          </div>
          
          <div className="space-y-4">
            {summary.lowStockCount > 0 && (
              <div className="bg-white dark:bg-card p-4 rounded-xl border border-rose-100 dark:border-border shadow-sm">
                <h4 className="font-semibold text-sm text-rose-700 dark:text-rose-400 mb-1">Low Stock Alert</h4>
                <p className="text-xs text-muted-foreground">{Number(summary.lowStockCount).toFixed(2)} ingredients are below reorder level.</p>
              </div>
            )}
            {summary.pendingRecurringExpenses > 0 && (
              <div className="bg-white dark:bg-card p-4 rounded-xl border border-amber-100 dark:border-border shadow-sm">
                <h4 className="font-semibold text-sm text-amber-700 dark:text-amber-500 mb-1">Pending Expenses</h4>
                <p className="text-xs text-muted-foreground">{Number(summary.pendingRecurringExpenses).toFixed(2)} recurring expenses due soon.</p>
              </div>
            )}
            
            {summary.alerts?.map((alert, i) => (
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
