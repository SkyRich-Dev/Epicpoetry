import React, { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, apiFetch } from '../lib/api';
import { PageHeader, Button, Input, Label, formatCurrency, cn } from '../components/ui-extras';
import { useAuth } from '../lib/auth';
import { Plus, AlertTriangle, CheckCircle, TrendingUp } from 'lucide-react';
import { useToast } from '../hooks/use-toast';


function getMonthYear() { return new Date().toISOString().slice(0, 7); }
function fmtMonth(ym: string) {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
}

interface Budget {
  id: number; categoryName: string; monthYear: string;
  budgetAmount: number; actualSpend: number; spendPct: number; overBudget: boolean;
  alertAt80: boolean; alertAt100: boolean;
}

const EXPENSE_CATEGORIES = ['Utilities','Rent','Marketing','Maintenance','Salaries','Consumables','Food & Beverage','Packaging','Equipment','Cleaning','Other'];

export default function ExpenseBudgetsPage() {
  const { hasPerm } = useAuth();
  const { toast } = useToast();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthYear, setMonthYear] = useState(getMonthYear());
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ categoryName: '', monthYear: getMonthYear(), budgetAmount: '', alertAt80: true, alertAt100: true });
  const [editId, setEditId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/expense-budgets?monthYear=${monthYear}`).then((r: Response) => r.json());
      setBudgets(Array.isArray(data) ? data : []);
    } catch { toast({ title: 'Failed to load budgets', variant: 'destructive' }); }
    finally { setLoading(false); }
  }, [monthYear]);

  useEffect(() => { load(); }, [load]);

  const saveBudget = async () => {
    if (!form.categoryName || !form.budgetAmount) return;
    setSaving(true);
    try {
      const url = editId ? `/expense-budgets/${editId}` : '/expense-budgets';
      const method = editId ? 'PATCH' : 'POST';
      const r = await apiFetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, budgetAmount: Number(form.budgetAmount) }),
      });
      if (!r.ok) throw new Error(((await r.json()) as any).error);
      toast({ title: editId ? 'Budget updated' : 'Budget created' });
      setShowForm(false); setEditId(null);
      setForm({ categoryName: '', monthYear: getMonthYear(), budgetAmount: '', alertAt80: true, alertAt100: true });
      load();
    } catch (e: any) { toast({ title: e.message, variant: 'destructive' }); }
    setSaving(false);
  };

  const deleteBudget = async (id: number) => {
    try {
      await apiFetch(`/expense-budgets/${id}`, { method: 'DELETE' });
      toast({ title: 'Budget deleted' }); load();
    } catch { toast({ title: 'Failed to delete', variant: 'destructive' }); }
  };

  const startEdit = (b: Budget) => {
    setEditId(b.id);
    setForm({ categoryName: b.categoryName, monthYear: b.monthYear, budgetAmount: String(b.budgetAmount), alertAt80: b.alertAt80, alertAt100: b.alertAt100 });
    setShowForm(true);
  };

  const totalBudget = budgets.reduce((s, b) => s + b.budgetAmount, 0);
  const totalSpend = budgets.reduce((s, b) => s + b.actualSpend, 0);
  const overBudgetCount = budgets.filter(b => b.overBudget).length;

  return (
    <div className="space-y-6">
      <PageHeader title="Expense Budgets" description="Monthly budget vs actual tracking per category">
        <div className="flex items-center gap-3">
          <input type="month" value={monthYear} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setMonthYear(e.target.value)}
            className="rounded-xl border border-input bg-background px-3 py-2 text-sm" />
          {hasPerm('expenses.edit') && (
            <Button size="sm" onClick={() => { setShowForm(!showForm); setEditId(null); setForm({ categoryName: '', monthYear, budgetAmount: '', alertAt80: true, alertAt100: true }); }}>
              <Plus className="w-4 h-4 mr-1" />Set Budget
            </Button>
          )}
        </div>
      </PageHeader>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="rounded-2xl bg-card border p-4">
          <p className="text-sm text-muted-foreground">Total Budget</p>
          <p className="text-2xl font-bold">{formatCurrency(totalBudget)}</p>
        </div>
        <div className={cn('rounded-2xl border p-4', totalSpend > totalBudget ? 'bg-red-50 border-red-200' : 'bg-card')}>
          <p className="text-sm text-muted-foreground">Total Spent</p>
          <p className={cn('text-2xl font-bold', totalSpend > totalBudget ? 'text-red-600' : '')}>{formatCurrency(totalSpend)}</p>
          {totalBudget > 0 && <p className="text-xs text-muted-foreground mt-1">{Math.round((totalSpend/totalBudget)*100)}% of budget</p>}
        </div>
        <div className={cn('rounded-2xl border p-4', overBudgetCount > 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200')}>
          <p className="text-sm text-muted-foreground">Over Budget Categories</p>
          <p className={cn('text-2xl font-bold', overBudgetCount > 0 ? 'text-red-600' : 'text-emerald-600')}>{overBudgetCount}</p>
        </div>
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div className="rounded-2xl bg-card border p-5 space-y-4">
          <h3 className="font-semibold">{editId ? 'Edit Budget' : 'Set Budget'} — {fmtMonth(form.monthYear)}</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Category *</Label>
              <select value={form.categoryName} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, categoryName: e.target.value }))}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm">
                <option value="">Select category…</option>
                {EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div><Label>Month *</Label><input type="month" value={form.monthYear} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, monthYear: e.target.value }))}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" /></div>
            <div><Label>Budget Amount (RM) *</Label><Input type="number" min={0} step="0.01" placeholder="0.00"
              value={form.budgetAmount} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, budgetAmount: e.target.value }))} /></div>
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.alertAt80} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, alertAt80: e.target.checked }))} />
              Alert at 80%
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.alertAt100} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, alertAt100: e.target.checked }))} />
              Alert at 100%
            </label>
          </div>
          <div className="flex gap-2">
            <Button onClick={saveBudget} disabled={saving}>{saving ? 'Saving…' : editId ? 'Update Budget' : 'Create Budget'}</Button>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditId(null); }}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Budget cards */}
      {loading ? <div className="text-center py-12 text-muted-foreground">Loading…</div> :
        budgets.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No budgets set for {fmtMonth(monthYear)}</p>
            <p className="text-sm">Set category budgets to track overspend proactively</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {budgets.map(b => {
              const pct = Math.min(b.spendPct, 100);
              const isOver = b.overBudget;
              const is80 = b.spendPct >= 80 && !isOver;
              return (
                <div key={b.id} className={cn('rounded-2xl border-2 p-5 space-y-3',
                  isOver ? 'bg-red-50 border-red-300' : is80 ? 'bg-amber-50 border-amber-300' : 'bg-card border-border')}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{b.categoryName}</p>
                      <p className="text-xs text-muted-foreground">{fmtMonth(b.monthYear)}</p>
                    </div>
                    {isOver ? <AlertTriangle className="w-5 h-5 text-red-500" /> :
                      is80 ? <AlertTriangle className="w-5 h-5 text-amber-500" /> :
                      <CheckCircle className="w-5 h-5 text-emerald-500" />}
                  </div>

                  {/* Progress bar */}
                  <div>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span>{formatCurrency(b.actualSpend)} spent</span>
                      <span className={cn('font-medium', isOver ? 'text-red-600' : is80 ? 'text-amber-600' : 'text-emerald-600')}>
                        {Math.round(b.spendPct)}%
                      </span>
                    </div>
                    <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                      <div className={cn('h-full rounded-full transition-all', isOver ? 'bg-red-500' : is80 ? 'bg-amber-500' : 'bg-emerald-500')}
                        style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex justify-between text-xs mt-1 text-muted-foreground">
                      <span>Budget: {formatCurrency(b.budgetAmount)}</span>
                      <span>{isOver ? `Over by ${formatCurrency(b.actualSpend - b.budgetAmount)}` : `${formatCurrency(b.budgetAmount - b.actualSpend)} remaining`}</span>
                    </div>
                  </div>

                  {hasPerm('expenses.edit') && (
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="outline" onClick={() => startEdit(b)} className="text-xs">Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteBudget(b.id)} className="text-xs text-red-600 hover:text-red-700">Delete</Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      }
    </div>
  );
}
